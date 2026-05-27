import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { anthropic, DM_MODEL } from "@/lib/dm";
import type { StoryArc } from "@/lib/db";

const SYSTEM = `You are designing a hidden 3-act story arc for a dark-fantasy text adventure. Return STRICT JSON, no prose:

{
  "acts": [
    { "name": "Act I — Setup",      "beats": [{"title": "...", "goal": "..."}, ...] },
    { "name": "Act II — Complication","beats": [{"title": "...", "goal": "..."}, ...] },
    { "name": "Act III — Resolution","beats": [{"title": "...", "goal": "..."}, ...] }
  ]
}

Rules:
- Exactly three acts.
- Each act has 2 or 3 beats; total of 6–9 beats.
- Each beat's "title" is a short label (max 6 words).
- Each beat's "goal" is one sentence: what should happen for the story to progress.
- The arc must be specific to the opening scene given. Don't reuse generic fantasy plots.
- Stay open-ended: don't dictate the player's exact actions, just the events they should encounter.
- Output the JSON only.`;

export async function generateStoryArc(
  opening: string,
): Promise<StoryArc | null> {
  const client = anthropic();
  const res = await client.messages.create({
    model: DM_MODEL,
    max_tokens: 900,
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `Opening narration:\n\n${opening}\n\nDesign the hidden arc.`,
      },
    ],
  });

  const raw = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoryArc;
    if (!Array.isArray(parsed?.acts)) return null;
    // Defensive coercion.
    const acts = parsed.acts.slice(0, 3).map((a) => ({
      name: String(a.name ?? ""),
      beats: (Array.isArray(a.beats) ? a.beats : [])
        .slice(0, 3)
        .map((b) => ({
          title: String(b.title ?? ""),
          goal: String(b.goal ?? ""),
        })),
    }));
    if (acts.length === 0) return null;
    return { acts };
  } catch {
    return null;
  }
}
