import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import {
  anthropic,
  buildSystemPrompt,
  DM_MODEL,
  DM_TOOLS,
} from "@/lib/dm";
import { executeTool, type ToolEvent } from "@/lib/tools";
import { db, type DmCharacter, type DmMessageRow } from "@/lib/db";
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

  // Ownership check.
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

  // Pull character + history.
  const [{ data: charRow }, { data: priorRows }] = await Promise.all([
    admin
      .from("dm_characters")
      .select(
        "id, campaign_id, name, class, hp, max_hp, attributes, inventory, created_at, updated_at",
      )
      .eq("campaign_id", campaignId)
      .single(),
    admin
      .from("dm_messages")
      .select("role, content")
      .eq("campaign_id", campaignId)
      .order("created_at", { ascending: true }),
  ]);
  const character = (charRow ?? null) as DmCharacter | null;
  const prior = (priorRows ?? []) as Pick<DmMessageRow, "role" | "content">[];

  // Persist the player turn immediately.
  await admin
    .from("dm_messages")
    .insert({ campaign_id: campaignId, role: "user", content: action });

  // Auto-title campaign on first action.
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

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: object) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
        );
      };

      try {
        if (nextTitle) send({ type: "title", title: nextTitle });

        // Build the working message list. Claude gets text turns from prior
        // chat plus the new user action.
        const messages: Anthropic.MessageParam[] = [
          ...prior.map((p) => ({ role: p.role, content: p.content })),
          { role: "user", content: action },
        ];

        const system = [
          {
            type: "text" as const,
            text: buildSystemPrompt(character),
            cache_control: { type: "ephemeral" as const },
          },
        ];

        const client = anthropic();

        // Tool-use loop. Keep calling Claude until stop_reason !== 'tool_use'.
        // We accumulate the text the DM emits along the way so we can persist
        // the final assistant turn and emit it to the client.
        let accumulatedText = "";
        const maxIterations = 6;
        for (let i = 0; i < maxIterations; i++) {
          const resp = await client.messages.create({
            model: DM_MODEL,
            max_tokens: 700,
            system,
            tools: DM_TOOLS,
            messages,
          });

          // Drain text blocks straight to the client.
          for (const block of resp.content) {
            if (block.type === "text" && block.text) {
              send({ type: "token", text: block.text });
              accumulatedText += block.text;
            }
          }

          if (resp.stop_reason !== "tool_use") break;

          // Execute each tool_use block, build tool_result messages.
          const toolUseBlocks = resp.content.filter(
            (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
          );
          const toolResultContent: Anthropic.ToolResultBlockParam[] = [];
          for (const block of toolUseBlocks) {
            let event: ToolEvent;
            try {
              event = await executeTool(block.name, block.input, campaignId);
              send({ type: "tool", event });
              toolResultContent.push({
                type: "tool_result",
                tool_use_id: block.id,
                content: JSON.stringify(event),
              });
            } catch (e) {
              const message = e instanceof Error ? e.message : "tool error";
              toolResultContent.push({
                type: "tool_result",
                tool_use_id: block.id,
                is_error: true,
                content: message,
              });
            }
          }

          // Append the assistant's tool_use turn + the tool_result turn so
          // Claude can keep going.
          messages.push({ role: "assistant", content: resp.content });
          messages.push({ role: "user", content: toolResultContent });
        }

        if (accumulatedText.length > 0) {
          await admin.from("dm_messages").insert({
            campaign_id: campaignId,
            role: "assistant",
            content: accumulatedText,
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
