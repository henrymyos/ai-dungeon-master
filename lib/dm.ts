import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { DmCharacter } from "@/lib/db";

const MODEL = "claude-haiku-4-5-20251001";

const BASE_SYSTEM_PROMPT = `You are the Dungeon Master of an evocative dark-fantasy world. The player has just begun their adventure in a fog-shrouded forest at dusk, where ancient trees lean close together and the air smells of moss and woodsmoke from somewhere unseen.

Respond to the player's stated actions in vivid second-person prose. Keep responses to 2–4 sentences — enough to set a scene or describe a consequence, never enough to railroad the player. Always end with a beat that invites the next action: a sound from beyond the trees, a glint of something half-buried in the leaves, a door slowly opening.

Stay grounded in the player's choices. Never narrate their inner thoughts or feelings — only the world's response. Don't editorialize. Don't break the fourth wall. If the player attempts something impossible, let the world push back diegetically.`;

const TOOL_INSTRUCTIONS = `You have access to tools that mutate the player's state. Use them whenever the situation genuinely warrants it:

- roll_dice — for skill checks, attacks, saves, or any moment where chance matters. Narrate what's being rolled BEFORE calling, then describe the outcome AFTER.
- update_hp — when the player takes damage or recovers. Use negative deltas for damage, positive for healing. Reference the new HP in your narration.
- add_item / remove_item — when the player picks something up, loses something, uses a consumable, gives a gift, etc.
- set_scene — when the scene meaningfully changes: a new location, a dramatic reveal, the arrival of a notable figure, a shift from peace to combat. Call this AT THE START of the turn (before any narration of the change) with a vivid 1–2 sentence image_prompt that captures the visual. Don't call it every turn — only when the change is large enough that a fresh picture and soundscape would help the player.

Do NOT call tools for fluff. A whispering wind doesn't need a die roll. Only call tools for moments where the result of the tool will change what you say next. Always describe a beat of narration around each tool call so the world feels alive, not transactional.`;

export function buildSystemPrompt(character: DmCharacter | null): string {
  if (!character) return BASE_SYSTEM_PROMPT + "\n\n" + TOOL_INSTRUCTIONS;
  const inv = character.inventory
    .map(
      (i) => `${i.item}${i.quantity > 1 ? ` (×${i.quantity})` : ""}`,
    )
    .join(", ") || "nothing";
  const attrs = character.attributes;
  const sheet = `
## Player character (live state — keep narration consistent with this)
Name: ${character.name}
Class: ${character.class}
HP: ${character.hp} / ${character.max_hp}
Attributes: STR ${attrs.strength} · DEX ${attrs.dexterity} · WITS ${attrs.wits}
Carrying: ${inv}`.trim();
  return `${BASE_SYSTEM_PROMPT}\n\n${TOOL_INSTRUCTIONS}\n\n${sheet}`;
}

export type DmMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string };

// ─── Tools ─────────────────────────────────────────────────────────────────
export const DM_TOOLS: Anthropic.Tool[] = [
  {
    name: "roll_dice",
    description:
      "Roll one or more dice. Use for skill checks, attacks, saves, or any random event whose outcome should be unpredictable to both you and the player. Always narrate what you're rolling and why before calling.",
    input_schema: {
      type: "object",
      properties: {
        sides: {
          type: "integer",
          description: "Sides per die (e.g. 20 for d20, 6 for d6).",
        },
        count: {
          type: "integer",
          description: "Number of dice to roll (default 1).",
        },
        reason: {
          type: "string",
          description: "Short label for what this roll is for, e.g. 'stealth check' or 'sword attack'.",
        },
      },
      required: ["sides", "reason"],
    },
  },
  {
    name: "update_hp",
    description:
      "Apply damage or healing to the player. Negative delta for damage, positive for healing. The result will be clamped to 0..max_hp.",
    input_schema: {
      type: "object",
      properties: {
        delta: {
          type: "integer",
          description: "Change in HP. Negative = damage; positive = healing.",
        },
        reason: {
          type: "string",
          description: "Short label, e.g. 'goblin slash' or 'healing potion'.",
        },
      },
      required: ["delta", "reason"],
    },
  },
  {
    name: "add_item",
    description: "Add an item to the player's inventory.",
    input_schema: {
      type: "object",
      properties: {
        item: { type: "string", description: "Name of the item." },
        quantity: {
          type: "integer",
          description: "Quantity to add (default 1).",
        },
      },
      required: ["item"],
    },
  },
  {
    name: "remove_item",
    description:
      "Remove an item from the player's inventory (consumed, lost, given away).",
    input_schema: {
      type: "object",
      properties: {
        item: { type: "string", description: "Name of the item." },
        quantity: {
          type: "integer",
          description: "Quantity to remove (default 1).",
        },
      },
      required: ["item"],
    },
  },
  {
    name: "set_scene",
    description:
      "Call when the scene meaningfully changes — a new location, dramatic reveal, or shift from peace to combat. Generates a fresh illustration and ambient soundscape for the player.",
    input_schema: {
      type: "object",
      properties: {
        location: {
          type: "string",
          description: "Short label, e.g. 'Foggy forest clearing' or 'The Wayfarer's Rest tavern'.",
        },
        mood: {
          type: "string",
          enum: ["calm", "tense", "combat", "mysterious", "festive"],
          description: "Which ambient soundscape to play.",
        },
        image_prompt: {
          type: "string",
          description:
            "Vivid 1–2 sentence visual description for an image generator. Be concrete: lighting, key objects, atmosphere. No characters' names; describe figures by appearance.",
        },
      },
      required: ["location", "mood", "image_prompt"],
    },
  },
];

export const anthropic = () => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  return new Anthropic({ apiKey });
};

export const DM_MODEL = MODEL;
