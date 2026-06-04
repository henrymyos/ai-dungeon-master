import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { anthropic, DM_MODEL } from "@/lib/dm";

const SYSTEM = `You translate a snippet of dark-fantasy narration into the parameters of a single scene illustration. Return STRICT JSON, no prose:

{
  "location": "short label (max 6 words) of where this is happening",
  "mood": "calm" | "tense" | "combat" | "mysterious" | "festive",
  "image_prompt": "Vivid 1–2 sentence visual description for an image generator. Concrete: lighting, key objects, atmosphere. Describe figures by appearance, never name them. No text in the image."
}

Rules:
- Pick the mood that best matches the moment.
- If the narration is just dialogue or thought without movement, anchor the image on the existing setting context provided.
- Don't invent locations not implied by the narration.
- Output the JSON only.`;

type SceneSpec = {
  location: string;
  mood: "calm" | "tense" | "combat" | "mysterious" | "festive";
  image_prompt: string;
};

/**
 * Distill a chunk of streamed narration (+ continuity context) into the
 * three fields that drive scene illustration. Used by the stream route
 * as a fallback when the DM didn't fire set_scene itself.
 *
 * Returns null if the model output can't be parsed — caller should skip
 * image generation in that case rather than putting garbage on screen.
 */
export async function sceneFromNarration(
  narration: string,
  context: { lastLocation?: string | null; lastMood?: string | null } = {},
): Promise<SceneSpec | null> {
  const client = anthropic();
  const ctxLines: string[] = [];
  if (context.lastLocation)
    ctxLines.push(`Current location: ${context.lastLocation}`);
  if (context.lastMood) ctxLines.push(`Current mood: ${context.lastMood}`);
  const ctx = ctxLines.length > 0 ? `${ctxLines.join("\n")}\n\n` : "";

  try {
    const res = await client.messages.create({
      model: DM_MODEL,
      max_tokens: 220,
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `${ctx}Narration:\n${narration.trim()}`,
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
    const parsed = JSON.parse(raw) as Partial<SceneSpec>;
    const validMoods: SceneSpec["mood"][] = [
      "calm",
      "tense",
      "combat",
      "mysterious",
      "festive",
    ];
    const mood: SceneSpec["mood"] = validMoods.includes(
      parsed.mood as SceneSpec["mood"],
    )
      ? (parsed.mood as SceneSpec["mood"])
      : "calm";
    const location = String(parsed.location ?? "").trim();
    const image_prompt = String(parsed.image_prompt ?? "").trim();
    if (!location || !image_prompt) return null;
    return { location, mood, image_prompt };
  } catch {
    return null;
  }
}
