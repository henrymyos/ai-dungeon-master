import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { DmCharacter, DmWorld } from "@/lib/db";
import { worldStateForPrompt } from "@/lib/world";

const MODEL = "claude-haiku-4-5-20251001";

const BASE_SYSTEM_PROMPT = `You are the Dungeon Master of an evocative dark-fantasy world. The player has just begun their adventure in a fog-shrouded forest at dusk, where ancient trees lean close together and the air smells of moss and woodsmoke from somewhere unseen.

Respond to the player's stated actions in vivid second-person prose. Keep responses to 2–4 sentences — enough to set a scene or describe a consequence, never enough to railroad the player. Always end with a beat that invites the next action: a sound from beyond the trees, a glint of something half-buried in the leaves, a door slowly opening.

Stay grounded in the player's choices. Never narrate their inner thoughts or feelings — only the world's response. Don't editorialize. Don't break the fourth wall. If the player attempts something impossible, let the world push back diegetically.`;

const TOOL_INSTRUCTIONS = `You have access to tools that mutate the player's state and the world. Use them whenever the situation genuinely warrants it:

Player state:
- roll_dice — for skill checks, attacks, saves, or any moment where chance matters. Narrate what's being rolled BEFORE calling, then describe the outcome AFTER.
- update_hp — when the player takes damage or recovers. Use negative deltas for damage, positive for healing. Reference the new HP in your narration.
- add_item / remove_item — when the player picks something up, loses something, uses a consumable, gives a gift, etc.

Scene:
- set_scene — when the scene meaningfully changes: a new location, dramatic reveal, arrival of a notable figure, shift from peace to combat. Call AT THE START of the turn with a vivid 1–2 sentence image_prompt.

Status effects (conditions, buffs, debuffs, lasting injuries):
- apply_status_effect — when something has happened that should linger past this turn: poisoned, blessed, exhausted, blinded, drunk, OR a lasting injury from a critical failure ("Twisted Ankle", "Cracked Rib"). Set kind='injury' for things that need a healer; kind='condition' for things that persist until a clear narrative change; kind='buff' or 'debuff' for timed effects (provide duration_minutes).
- clear_status_effect — when the player rests, drinks an antidote, sees a healer, or otherwise gets rid of an effect. Reference it by exact name.

Story:
- record_quest — when the player commits to a goal worth tracking (a deal struck, a stolen object to recover, a place to reach). Don't track every minor errand. Persists across turns; reference by name later.
- update_quest_status — mark a quest completed / failed / abandoned when the narrative resolves it.
- advance_arc — the campaign has a hidden 3-act plan. When the player reaches the goal of the CURRENT beat, advance to the next one. You see the next beat's goal in the world state. Don't railroad — let the player approach it naturally; this tool just tells the system to move on.

Combat encounters:
- start_encounter — only when real combat begins (not every tense moment). Lists the enemies and their HP. Set the mood to "combat" via set_scene at the same time.
- damage_enemy — when a player attack lands. Reference the enemy by name.
- defeat_enemy — when an enemy is killed, knocked out, or flees.
- end_encounter — when combat is resolved. Provide an outcome string (e.g. "victory", "fled", "negotiated").

World state (use these to keep long campaigns coherent):
- record_npc — the first time the player learns a notable character's name, OR when an existing NPC's attitude/relationship has meaningfully shifted. Don't record every random villager — only people the player might encounter again.
- record_location — when the player visits a distinct, notable place worth remembering (a town, dungeon, landmark, shop). Not every clearing.
- advance_time — after meaningful time-passing actions: walking somewhere significant, resting, sleeping, having a real conversation. Use realistic durations (a brief search = 5–10 min, walking through a forest = 30–60 min, a night's rest = 480 min). Optionally update the weather if it has shifted.
- record_lore — when the player learns a worldbuilding fact worth keeping: a faction name, magical rule, historical event, secret about a place. One concrete fact per call.

Do NOT call tools for fluff. A whispering wind doesn't need a die roll. Only call tools for moments where the result will change what you say next. Always describe a beat of narration around each tool call so the world feels alive, not transactional.`;

/**
 * The static instructions Claude needs every turn. Stable so Anthropic's
 * prompt cache can ride on it across turns.
 */
export function buildStaticSystemPrompt(): string {
  return `${BASE_SYSTEM_PROMPT}\n\n${TOOL_INSTRUCTIONS}`;
}

/**
 * The dynamic state — character sheet, current time / weather, known
 * NPCs / locations / lore. Appended AFTER the cache breakpoint so it
 * doesn't invalidate the cache when state changes.
 */
export function buildDynamicStateBlock(
  character: DmCharacter | null,
  world: DmWorld | null,
): string {
  const parts: string[] = [];

  if (character) {
    const inv =
      character.inventory
        .map((i) => `${i.item}${i.quantity > 1 ? ` (×${i.quantity})` : ""}`)
        .join(", ") || "nothing";
    const attrs = character.attributes;
    const skills =
      character.skills && character.skills.length > 0
        ? character.skills.map((s) => `${s.name} ${s.level}`).join(", ")
        : "none yet";
    parts.push(
      [
        "## Player character (live state — keep narration consistent with this)",
        `Name: ${character.name}`,
        `Class: ${character.class}`,
        `HP: ${character.hp} / ${character.max_hp}`,
        `Attributes: STR ${attrs.strength} · DEX ${attrs.dexterity} · WITS ${attrs.wits}`,
        `Trained skills (pass skill_name to roll_dice when relevant): ${skills}`,
        `Carrying: ${inv}`,
      ].join("\n"),
    );
  }

  if (world) {
    parts.push(worldStateForPrompt(world));
  }

  return parts.join("\n\n");
}

/** Back-compat: callers still using buildSystemPrompt get the combined
 *  text. New callers should use the split variants for cacheability. */
export function buildSystemPrompt(
  character: DmCharacter | null,
  world: DmWorld | null = null,
): string {
  const dyn = buildDynamicStateBlock(character, world);
  return dyn
    ? `${buildStaticSystemPrompt()}\n\n${dyn}`
    : buildStaticSystemPrompt();
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
        advantage: {
          type: "string",
          enum: ["normal", "advantage", "disadvantage"],
          description:
            "For d20 single rolls: 'advantage' rolls 2d20 and keeps the higher; 'disadvantage' keeps the lower. Use advantage when the player has a favorable angle (a sneak attack, a held weapon at the ready, an NPC who likes them), disadvantage when conditions hurt (poisoned, blinded, fighting uphill). Default 'normal'.",
        },
        skill_name: {
          type: "string",
          description:
            "If this roll uses a skill the player has trained, pass its exact name (e.g. 'Stealth', 'Lockpicking'). The skill's level is added to the roll automatically.",
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
    name: "record_quest",
    description:
      "Start tracking a goal the player has taken on. Use only for goals worth remembering, not micro-errands.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Short label." },
        description: {
          type: "string",
          description: "1–2 sentence summary of what success looks like.",
        },
      },
      required: ["name", "description"],
    },
  },
  {
    name: "update_quest_status",
    description: "Mark an existing quest completed / failed / abandoned.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        status: {
          type: "string",
          enum: ["active", "completed", "failed", "abandoned"],
        },
        notes: {
          type: "string",
          description: "Optional: what happened.",
        },
      },
      required: ["name", "status"],
    },
  },
  {
    name: "advance_arc",
    description:
      "Move the campaign to the next beat in its hidden 3-act story arc. Call only when the current beat's goal has been meaningfully achieved.",
    input_schema: {
      type: "object",
      properties: {
        note: {
          type: "string",
          description: "Optional: a line of internal DM note about how it happened.",
        },
      },
    },
  },
  {
    name: "apply_status_effect",
    description:
      "Attach a status effect to the player — a condition, buff, debuff, or lasting injury. Replaces an existing status with the same name.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Short label, e.g. 'Poisoned', 'Twisted Ankle', 'Blessed'." },
        kind: {
          type: "string",
          enum: ["debuff", "buff", "condition", "injury"],
          description:
            "'debuff' / 'buff' are timed effects; 'condition' persists until a narrative reason ends it; 'injury' is a lasting scar that needs healing.",
        },
        description: {
          type: "string",
          description:
            "1 sentence: what it does mechanically + narratively, e.g. '-2 to DEX rolls; the wound throbs when you run.'",
        },
        duration_minutes: {
          type: "integer",
          description:
            "Optional: in-game minutes before the effect expires automatically. Omit for conditions/injuries that need explicit removal.",
        },
      },
      required: ["name", "kind", "description"],
    },
  },
  {
    name: "clear_status_effect",
    description: "Remove an active status by exact name.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
      },
      required: ["name"],
    },
  },
  {
    name: "start_encounter",
    description:
      "Begin a combat encounter. Use only when real combat starts — not every tense moment. Lists each enemy with starting HP.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Short label, e.g. 'Goblin ambush'." },
        description: { type: "string" },
        enemies: {
          type: "array",
          description: "Each enemy: { name, hp, description? }.",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              hp: { type: "integer" },
              description: { type: "string" },
            },
            required: ["name", "hp"],
          },
        },
      },
      required: ["name", "enemies"],
    },
  },
  {
    name: "damage_enemy",
    description:
      "Deal damage to a named enemy in the active encounter. Negative amounts heal (rare). Reference enemies by the names you assigned in start_encounter; case insensitive substring match.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        amount: { type: "integer", description: "Damage to deal. Use positive numbers." },
        reason: { type: "string" },
      },
      required: ["name", "amount", "reason"],
    },
  },
  {
    name: "defeat_enemy",
    description:
      "Mark an enemy as no longer active (killed, knocked out, fled). Use when the result is decisive — for a brief stagger, just call damage_enemy.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        reason: { type: "string" },
      },
      required: ["name"],
    },
  },
  {
    name: "end_encounter",
    description:
      "Close the active encounter. Provide an outcome (victory / fled / negotiated / etc.).",
    input_schema: {
      type: "object",
      properties: {
        outcome: { type: "string" },
      },
      required: ["outcome"],
    },
  },
  {
    name: "record_npc",
    description:
      "Record a notable NPC the player has met (or update an existing one). Identifies people by name — if an NPC with this name exists, the row is updated.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        description: {
          type: "string",
          description: "1–2 sentence appearance + role + manner.",
        },
        attitude: {
          type: "string",
          enum: ["friendly", "hostile", "neutral", "suspicious", "allied", "fearful"],
        },
        relationship: {
          type: "integer",
          description:
            "Relationship score, -100 (sworn enemy) to 100 (devoted ally). Only set when the relationship has meaningfully changed.",
        },
        notes: {
          type: "string",
          description:
            "Optional running notes about this NPC — what they want, what they know, what they're hiding.",
        },
      },
      required: ["name", "description", "attitude"],
    },
  },
  {
    name: "record_location",
    description:
      "Record a notable place the player has visited or learned of. Identifies locations by name; existing rows update.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        description: {
          type: "string",
          description: "1–2 sentence physical + atmosphere description.",
        },
        notes: {
          type: "string",
          description:
            "Optional notes: who's there, what's hidden, why it matters.",
        },
      },
      required: ["name", "description"],
    },
  },
  {
    name: "advance_time",
    description:
      "Advance the in-game clock. Call after meaningful time-passing actions. Use realistic durations.",
    input_schema: {
      type: "object",
      properties: {
        minutes: {
          type: "integer",
          description: "Minutes to advance (positive integer).",
        },
        weather: {
          type: "string",
          enum: ["clear", "cloudy", "fog", "rain", "storm", "snow", "wind"],
          description:
            "Optional: update the weather. Only when it has genuinely shifted in-fiction.",
        },
      },
      required: ["minutes"],
    },
  },
  {
    name: "record_lore",
    description:
      "Record a worldbuilding fact worth remembering long-term: faction names, magical rules, history, secrets about places.",
    input_schema: {
      type: "object",
      properties: {
        fact: {
          type: "string",
          description: "One concrete fact, 1–2 sentences.",
        },
      },
      required: ["fact"],
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
