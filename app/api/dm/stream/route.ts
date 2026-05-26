import { z } from "zod";
import { streamDmResponse, type DmMessage } from "@/lib/dm";
import { db, type DmMessageRow } from "@/lib/db";
import { getUserId } from "@/lib/user";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  campaignId: z.string().uuid(),
  action: z.string().min(1).max(2000),
});

export async function POST(req: Request) {
  const userId = await getUserId();
  const raw = await req.json().catch(() => null);
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: "Invalid request body." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  const { campaignId, action } = parsed.data;
  const admin = db();

  // Confirm the caller owns this campaign.
  const { data: campaign, error: ownErr } = await admin
    .from("dm_campaigns")
    .select("id, title")
    .eq("id", campaignId)
    .eq("user_id", userId)
    .single();
  if (ownErr || !campaign) {
    return new Response(JSON.stringify({ error: "Campaign not found." }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Pull existing history so the DM sees the running narrative.
  const { data: priorRows } = await admin
    .from("dm_messages")
    .select("role, content")
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: true });
  const prior = (priorRows ?? []) as Pick<DmMessageRow, "role" | "content">[];

  // Persist the player's action immediately so it survives even if streaming
  // dies midway.
  await admin
    .from("dm_messages")
    .insert({ campaign_id: campaignId, role: "user", content: action });

  // Auto-title the campaign from the first player action (max 60 chars) so
  // the sidebar doesn't stay "A new adventure" forever.
  const userTurnCount = prior.filter((p) => p.role === "user").length;
  let nextTitle: string | null = null;
  if (userTurnCount === 0) {
    const titled = action.trim().replace(/\s+/g, " ").slice(0, 60);
    if (titled.length > 0) nextTitle = titled;
  }
  await admin
    .from("dm_campaigns")
    .update({
      updated_at: new Date().toISOString(),
      ...(nextTitle ? { title: nextTitle } : {}),
    })
    .eq("id", campaignId);

  const history: DmMessage[] = [
    ...prior.map((p) => ({ role: p.role, content: p.content })),
    { role: "user", content: action },
  ];

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: object) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
        );
      };
      let full = "";
      try {
        if (nextTitle) send({ type: "title", title: nextTitle });
        for await (const text of streamDmResponse(history)) {
          full += text;
          send({ type: "token", text });
        }
        if (full.length > 0) {
          await admin.from("dm_messages").insert({
            campaign_id: campaignId,
            role: "assistant",
            content: full,
          });
        }
        send({ type: "done" });
      } catch (err) {
        send({
          type: "error",
          message: err instanceof Error ? err.message : "DM call failed.",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
