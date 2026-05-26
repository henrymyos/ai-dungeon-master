import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { anthropic, DM_MODEL } from "@/lib/dm";
import { db, type DmCampaign } from "@/lib/db";

/** After how many unsummarized turns we kick off summarization. A "turn"
 *  here is one row in dm_messages — a user action OR a DM response.
 *  Setting this to 16 means we summarize roughly every ~8 player turns. */
const SUMMARIZE_THRESHOLD = 16;
/** How many unsummarized messages to leave verbatim after compression.
 *  Recent context preserves voice and continuity better than a summary. */
const KEEP_RECENT = 6;

const SUMMARY_SYSTEM = `You compress an ongoing fantasy-adventure transcript into a short "Previously…" recap.

Rules:
- 3–5 sentences total. Past tense. Third person referring to "the player" / "you".
- Preserve characters met, places visited, decisions made, injuries sustained, items acquired, and unresolved threads.
- Drop tone, atmosphere, weather, and incidental description.
- Do NOT add anything not present in the transcript. Do NOT speculate.
- Output the recap text only — no header, no quotes, no commentary.`;

type MessageRow = {
  id: number;
  role: "user" | "assistant";
  content: string;
};

/**
 * If a campaign has more unsummarized messages than the threshold,
 * collapse the oldest portion into a short recap and advance the cursor.
 *
 * Idempotent — safe to call before every turn.
 */
export async function summarizeCampaignIfNeeded(
  campaignId: string,
): Promise<{ summarized: boolean; messagesCollapsed?: number } | null> {
  const admin = db();

  const { data: c } = await admin
    .from("dm_campaigns")
    .select("id, summary, summary_through_message_id")
    .eq("id", campaignId)
    .single();
  if (!c) return null;
  const campaign = c as Pick<
    DmCampaign,
    "id" | "summary" | "summary_through_message_id"
  >;

  // Fetch unsummarized messages.
  let q = admin
    .from("dm_messages")
    .select("id, role, content")
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: true });
  if (campaign.summary_through_message_id != null) {
    q = q.gt("id", campaign.summary_through_message_id);
  }
  const { data: rows } = await q;
  const msgs = (rows ?? []) as MessageRow[];

  if (msgs.length < SUMMARIZE_THRESHOLD)
    return { summarized: false };

  const toCompress = msgs.slice(0, msgs.length - KEEP_RECENT);
  if (toCompress.length === 0) return { summarized: false };

  const transcript = toCompress
    .map(
      (m) =>
        `${m.role === "user" ? "PLAYER" : "DM"}: ${m.content.replace(/\s+/g, " ")}`,
    )
    .join("\n");
  const preface = campaign.summary
    ? `Earlier recap (consolidate with the new transcript):\n${campaign.summary}\n\n`
    : "";

  const res = await anthropic().messages.create({
    model: DM_MODEL,
    max_tokens: 400,
    system: SUMMARY_SYSTEM,
    messages: [
      {
        role: "user",
        content: `${preface}New transcript to fold in:\n${transcript}`,
      },
    ],
  });
  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  if (!text) return { summarized: false };

  const cursor = toCompress[toCompress.length - 1].id;
  await admin
    .from("dm_campaigns")
    .update({ summary: text, summary_through_message_id: cursor })
    .eq("id", campaignId);

  return { summarized: true, messagesCollapsed: toCompress.length };
}

export type DmContext = {
  /** Pseudo-system prefix capturing summarized older turns. Empty if none. */
  recap: string | null;
  /** Verbatim recent messages — what we send to Claude as message turns. */
  recent: { role: "user" | "assistant"; content: string }[];
};

/** Load the context for a turn: existing summary + post-cursor messages.
 *  Centralized so /api/dm/stream and any other caller stay consistent. */
export async function loadDmContext(campaignId: string): Promise<DmContext> {
  const admin = db();
  const { data: c } = await admin
    .from("dm_campaigns")
    .select("summary, summary_through_message_id")
    .eq("id", campaignId)
    .single();
  const summary = (c?.summary as string | null) ?? null;
  const cursor = (c?.summary_through_message_id as number | null) ?? null;

  let q = admin
    .from("dm_messages")
    .select("role, content, id")
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: true });
  if (cursor != null) q = q.gt("id", cursor);

  const { data: rows } = await q;
  const recent = (rows ?? []).map((r) => ({
    role: r.role as "user" | "assistant",
    content: r.content as string,
  }));
  return { recap: summary, recent };
}
