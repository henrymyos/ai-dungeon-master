import "server-only";
import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-haiku-4-5-20251001";

export const DM_SYSTEM_PROMPT = `You are the Dungeon Master of an evocative dark-fantasy world. The player has just begun their adventure in a fog-shrouded forest at dusk, where ancient trees lean close together and the air smells of moss and woodsmoke from somewhere unseen.

Respond to the player's stated actions in vivid second-person prose. Keep responses to 2–4 sentences — enough to set a scene or describe a consequence, never enough to railroad the player. Always end with a beat that invites the next action: a sound from beyond the trees, a glint of something half-buried in the leaves, a door slowly opening.

Stay grounded in the player's choices. Never narrate their inner thoughts or feelings — only the world's response. Don't editorialize. Don't break the fourth wall. If the player attempts something impossible, let the world push back diegetically.`;

export type DmMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string };

/**
 * Stream a DM response. The caller is responsible for accumulating the
 * full text if it wants to persist the turn. Phase 1 keeps everything in
 * React state on the client — no DB writes yet.
 */
export async function* streamDmResponse(
  history: DmMessage[],
): AsyncGenerator<string, void, void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  const client = new Anthropic({ apiKey });

  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 512,
    system: [
      {
        type: "text",
        text: DM_SYSTEM_PROMPT,
        // The system prompt never changes within a session — cache it so
        // subsequent turns pay ~10% of base input cost for those tokens.
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: history.map((m) => ({ role: m.role, content: m.content })),
  });

  for await (const event of stream) {
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    ) {
      yield event.delta.text;
    }
  }
}
