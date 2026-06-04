import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { anthropic, DM_MODEL } from "@/lib/dm";

const SYSTEM = `You write the opening narration of a text adventure. Convert the player's scenario sketch into exactly 2–3 sentences of vivid second-person present-tense narration that drops the player into the scene.

Rules:
- Second person ("you").
- Present tense.
- 2 to 3 sentences, no more.
- Concrete sensory details: a sound, a smell, a half-seen shape.
- End on a beat that invites the player to act — something just at the edge of their perception, a door, a footstep, a question.
- Don't name the player or assign them a goal.
- Don't editorialize.
- Output the narration only, no preamble.`;

/**
 * Convert a player's free-text scenario into 2–3 sentences of opening
 * narration. Falls back to the original text if generation fails.
 */
export async function generateOpeningNarration(
  scenario: string,
): Promise<string> {
  const client = anthropic();
  try {
    const res = await client.messages.create({
      model: DM_MODEL,
      max_tokens: 200,
      system: SYSTEM,
      messages: [{ role: "user", content: scenario.trim() }],
    });
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    return text || scenario.trim();
  } catch {
    return scenario.trim();
  }
}
