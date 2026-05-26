import { createAdminClient } from "@/lib/supabase/admin";

export type DmCampaign = {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

export type DmMessageRow = {
  id: number;
  campaign_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

export type InventoryItem = { item: string; quantity: number };

export type DmCharacter = {
  id: string;
  campaign_id: string;
  name: string;
  class: string;
  hp: number;
  max_hp: number;
  attributes: { strength: number; dexterity: number; wits: number };
  inventory: InventoryItem[];
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
    blurb: "More comfortable in the trees than indoors.",
  },
};

export function db() {
  return createAdminClient();
}
