import { createAdminClient } from "@/lib/supabase/admin";

export type ArcBeat = { title: string; goal: string };
export type ArcAct = { name: string; beats: ArcBeat[] };
export type StoryArc = { acts: ArcAct[] };

export type DmCampaign = {
  id: string;
  user_id: string;
  title: string;
  summary: string | null;
  summary_through_message_id: number | null;
  share_token: string | null;
  time_minutes: number;
  day_count: number;
  weather: string;
  story_arc: StoryArc | null;
  current_beat: number;
  created_at: string;
  updated_at: string;
};

export type QuestStatus = "active" | "completed" | "failed" | "abandoned";

export type DmQuest = {
  id: string;
  campaign_id: string;
  name: string;
  description: string;
  status: QuestStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type NpcAttitude =
  | "friendly"
  | "hostile"
  | "neutral"
  | "suspicious"
  | "allied"
  | "fearful";

export type DmNpc = {
  id: string;
  campaign_id: string;
  name: string;
  description: string;
  attitude: NpcAttitude;
  relationship: number;
  notes: string | null;
  first_seen_at: string;
  last_seen_at: string;
};

export type DmLocation = {
  id: string;
  campaign_id: string;
  name: string;
  description: string;
  notes: string | null;
  first_visited_at: string;
  last_visited_at: string;
};

export type DmLore = {
  id: number;
  campaign_id: string;
  fact: string;
  created_at: string;
};

export type StatusKind = "debuff" | "buff" | "condition" | "injury";

export type DmStatus = {
  id: string;
  character_id: string;
  name: string;
  kind: StatusKind;
  description: string;
  expires_at_minutes: number | null;
  created_at: string;
};

export type DmEnemy = {
  id: string;
  encounter_id: string;
  name: string;
  description: string | null;
  hp: number;
  max_hp: number;
  is_active: boolean;
  created_at: string;
};

export type DmEncounter = {
  id: string;
  campaign_id: string;
  name: string;
  description: string | null;
  status: "active" | "resolved";
  outcome: string | null;
  started_at: string;
  ended_at: string | null;
  enemies: DmEnemy[];
};

export type DmWorld = {
  time_minutes: number;
  day_count: number;
  weather: string;
  npcs: DmNpc[];
  locations: DmLocation[];
  lore: DmLore[];
  statuses: DmStatus[];
  encounter: DmEncounter | null;
  quests: DmQuest[];
  arc: StoryArc | null;
  current_beat: number;
};

export type DmScene = {
  location: string;
  mood: "calm" | "tense" | "combat" | "mysterious" | "festive";
  image_prompt: string;
  image_url: string;
};

export type DmMessageRow = {
  id: number;
  campaign_id: string;
  role: "user" | "assistant";
  content: string;
  scene: DmScene | null;
  created_at: string;
};

export type InventoryItem = { item: string; quantity: number };

export type Skill = { name: string; level: number };

export type DmCharacter = {
  id: string;
  campaign_id: string;
  name: string;
  class: string;
  hp: number;
  max_hp: number;
  attributes: { strength: number; dexterity: number; wits: number };
  inventory: InventoryItem[];
  skills: Skill[];
  portrait_url: string | null;
  portrait_hash: string | null;
  created_at: string;
  updated_at: string;
};

export const OPENING_NARRATION =
  "Fog pools knee-deep between the trees. The path you've been walking is gone — somewhere behind you, lost in the gloaming. A single lantern hangs from a low branch ahead, its flame steady despite the windless air. You hear something move, just out of sight.";

export type ClassKey = "Wanderer" | "Fighter" | "Rogue" | "Mage" | "Ranger";

export const CLASS_PRESETS: Record<
  ClassKey,
  {
    hp: number;
    attributes: DmCharacter["attributes"];
    inventory: InventoryItem[];
    skills: Skill[];
    blurb: string;
  }
> = {
  Wanderer: {
    hp: 20,
    attributes: { strength: 10, dexterity: 10, wits: 10 },
    inventory: [
      { item: "Worn cloak", quantity: 1 },
      { item: "Belt knife", quantity: 1 },
      { item: "Half a candle", quantity: 1 },
    ],
    skills: [
      { name: "Survival", level: 2 },
      { name: "Persuasion", level: 1 },
    ],
    blurb: "A traveller with no allegiance to anywhere in particular.",
  },
  Fighter: {
    hp: 28,
    attributes: { strength: 14, dexterity: 10, wits: 8 },
    inventory: [
      { item: "Iron sword", quantity: 1 },
      { item: "Leather armor", quantity: 1 },
      { item: "Whetstone", quantity: 1 },
    ],
    skills: [
      { name: "Athletics", level: 3 },
      { name: "Intimidation", level: 2 },
      { name: "Swordplay", level: 3 },
    ],
    blurb: "Trained to make problems bleed.",
  },
  Rogue: {
    hp: 20,
    attributes: { strength: 9, dexterity: 14, wits: 11 },
    inventory: [
      { item: "Dagger", quantity: 2 },
      { item: "Lockpicks", quantity: 1 },
      { item: "Smoke pellet", quantity: 2 },
    ],
    skills: [
      { name: "Stealth", level: 3 },
      { name: "Lockpicking", level: 3 },
      { name: "Sleight of Hand", level: 2 },
    ],
    blurb: "Quiet, fast, and missing a moral here or there.",
  },
  Mage: {
    hp: 16,
    attributes: { strength: 7, dexterity: 10, wits: 15 },
    inventory: [
      { item: "Oak staff", quantity: 1 },
      { item: "Spellbook (battered)", quantity: 1 },
      { item: "Vial of inkroot", quantity: 1 },
    ],
    skills: [
      { name: "Arcana", level: 3 },
      { name: "Investigation", level: 2 },
      { name: "Spellcasting", level: 3 },
    ],
    blurb: "Reads more than she sleeps.",
  },
  Ranger: {
    hp: 24,
    attributes: { strength: 11, dexterity: 13, wits: 11 },
    inventory: [
      { item: "Longbow", quantity: 1 },
      { item: "Arrow", quantity: 20 },
      { item: "Hunting knife", quantity: 1 },
      { item: "Trail rations", quantity: 3 },
    ],
    skills: [
      { name: "Archery", level: 3 },
      { name: "Tracking", level: 3 },
      { name: "Survival", level: 2 },
    ],
    blurb: "More comfortable in the trees than indoors.",
  },
};

export function db() {
  return createAdminClient();
}
