import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import {
  anthropic,
  buildStaticSystemPrompt,
  buildDynamicStateBlock,
  DM_MODEL,
  DM_TOOLS,
} from "@/lib/dm";
import { executeTool, type ToolEvent } from "@/lib/tools";
type SceneEvent = Extract<ToolEvent, { kind: "set_scene" }>;
import { db, type DmCharacter, type DmMessageRow } from "@/lib/db";
import { loadDmContext, summarizeCampaignIfNeeded } from "@/lib/summarize";
import { loadWorld } from "@/lib/world";
import { getUserId } from "@/lib/user";
import { checkRate, rateLimitResponse } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const maxDuration = 60;

// Stop runaway bots from torching Anthropic + Together credits. Generous
// enough that a real player won't notice.
const STREAM_LIMIT = 40;
const STREAM_WINDOW_MS = 60 * 60 * 1000;

const Body = z.object({
  campaignId: z.string().uuid(),
  action: z.string().min(1).max(2000),
});

export async function POST(req: Request) {
  const userId = await getUserId();
  const rl = checkRate(`stream:${userId}`, STREAM_LIMIT, STREAM_WINDOW_MS);
  if (!rl.allowed) {
    return rateLimitResponse(
      rl,
      "You've hit the per-hour turn limit on the public demo. Try again later.",
    );
  }
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

  // Ownership check.
  const { data: campaign, error: ownErr } = await admin
    .from("dm_campaigns")
    .select("id, title, scenario")
    .eq("id", campaignId)
    .eq("user_id", userId)
    .single();
  if (ownErr || !campaign) {
    return new Response(JSON.stringify({ error: "Campaign not found." }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Character sheet for system context.
  const { data: charRow } = await admin
    .from("dm_characters")
    .select(
      "id, campaign_id, name, class, hp, max_hp, attributes, inventory, skills, backstory, portrait_url, portrait_hash, created_at, updated_at",
    )
    .eq("campaign_id", campaignId)
    .single();
  const character = (charRow ?? null) as DmCharacter | null;

  // Count prior user turns for the title heuristic.
  const { count: priorUserCount } = await admin
    .from("dm_messages")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId)
    .eq("role", "user");

  // Persist the player turn immediately.
  await admin
    .from("dm_messages")
    .insert({ campaign_id: campaignId, role: "user", content: action });

  // Auto-title on first action.
  let nextTitle: string | null = null;
  if ((priorUserCount ?? 0) === 0) {
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

  // Compress old turns into a recap if the campaign has gotten long. This
  // runs before generation, so the DM uses the compacted context.
  let summarizedCount: number | undefined;
  try {
    const r = await summarizeCampaignIfNeeded(campaignId);
    if (r?.summarized) summarizedCount = r.messagesCollapsed;
  } catch {
    // Non-fatal — just send the full history.
  }

  const { recap, recent } = await loadDmContext(campaignId);
  // World state — loaded once per turn. Tools that mutate world state
  // (record_npc, advance_time, etc.) feed their effects back to Claude
  // via tool_results, which is sufficient mid-turn coherence.
  const world = await loadWorld(campaignId);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: object) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
        );
      };

      const totals = {
        input_tokens: 0,
        output_tokens: 0,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
      };

      try {
        if (nextTitle) send({ type: "title", title: nextTitle });
        if (summarizedCount)
          send({ type: "summarized", messagesCollapsed: summarizedCount });

        // Build messages. The recap, if present, becomes a fake assistant
        // turn at the very start ("Previously…") so Claude treats it as
        // canon without thinking it's a player utterance.
        const messages: Anthropic.MessageParam[] = [];
        if (recap) {
          messages.push({
            role: "assistant",
            content: `[Previously…]\n${recap}`,
          });
        }
        for (const m of recent) {
          messages.push({ role: m.role, content: m.content });
        }

        // Split: cache the static instructions block (stable), then
        // append the dynamic state without a cache_control so it doesn't
        // poison the cache when HP / NPCs / time change between turns.
        const dynamic = buildDynamicStateBlock(
          character,
          world,
          (campaign as { scenario?: string | null }).scenario ?? null,
        );
        const system: Anthropic.TextBlockParam[] = [
          {
            type: "text",
            text: buildStaticSystemPrompt(),
            cache_control: { type: "ephemeral" },
          },
          ...(dynamic ? [{ type: "text" as const, text: dynamic }] : []),
        ];

        const client = anthropic();

        let accumulatedText = "";
        let lastScene: SceneEvent | null = null;
        const maxIterations = 6;
        for (let i = 0; i < maxIterations; i++) {
          const resp = await client.messages.create({
            model: DM_MODEL,
            max_tokens: 700,
            system,
            tools: DM_TOOLS,
            messages,
          });

          totals.input_tokens += resp.usage.input_tokens ?? 0;
          totals.output_tokens += resp.usage.output_tokens ?? 0;
          totals.cache_read_tokens +=
            resp.usage.cache_read_input_tokens ?? 0;
          totals.cache_creation_tokens +=
            resp.usage.cache_creation_input_tokens ?? 0;

          for (const block of resp.content) {
            if (block.type === "text" && block.text) {
              send({ type: "token", text: block.text });
              accumulatedText += block.text;
            }
          }

          if (resp.stop_reason !== "tool_use") break;

          const toolUseBlocks = resp.content.filter(
            (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
          );
          const toolResultContent: Anthropic.ToolResultBlockParam[] = [];
          for (const block of toolUseBlocks) {
            let event: ToolEvent;
            try {
              event = await executeTool(
                block.name,
                block.input,
                campaignId,
              );
              if (event.kind === "set_scene") lastScene = event;
              send({ type: "tool", event });
              toolResultContent.push({
                type: "tool_result",
                tool_use_id: block.id,
                content: JSON.stringify(event),
              });
            } catch (e) {
              toolResultContent.push({
                type: "tool_result",
                tool_use_id: block.id,
                is_error: true,
                content:
                  e instanceof Error ? e.message : "tool error",
              });
            }
          }

          messages.push({ role: "assistant", content: resp.content });
          messages.push({ role: "user", content: toolResultContent });
        }

        if (accumulatedText.length > 0) {
          await admin.from("dm_messages").insert({
            campaign_id: campaignId,
            role: "assistant",
            content: accumulatedText,
            scene: lastScene
              ? {
                  location: lastScene.location,
                  mood: lastScene.mood,
                  image_prompt: lastScene.image_prompt,
                  image_url: lastScene.image_url,
                }
              : null,
            input_tokens: totals.input_tokens,
            output_tokens: totals.output_tokens,
            cache_read_tokens: totals.cache_read_tokens,
            cache_creation_tokens: totals.cache_creation_tokens,
          });
        }

        send({ type: "usage", usage: totals });
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
