import "server-only";
import {
  db,
  type DmCharacter,
  type InventoryItem,
  type NpcAttitude,
} from "@/lib/db";

/** Result of a single tool invocation. The shape is what we send back to
 *  Claude as the tool_result content AND what we emit to the client as a
 *  UI event. */
export type SceneMood = "calm" | "tense" | "combat" | "mysterious" | "festive";

export type ToolEvent =
  | {
      kind: "roll_dice";
      reason: string;
      sides: number;
      count: number;
      rolls: number[];
      total: number;
    }
  | {
      kind: "update_hp";
      reason: string;
      delta: number;
      hp: number;
      max_hp: number;
    }
  | { kind: "add_item"; item: string; quantity: number }
  | { kind: "remove_item"; item: string; quantity: number; remaining: number }
  | {
      kind: "set_scene";
      location: string;
      mood: SceneMood;
      image_prompt: string;
      image_url: string;
    }
  | {
      kind: "record_npc";
      name: string;
      description: string;
      attitude: NpcAttitude;
      relationship: number;
      isNew: boolean;
    }
  | {
      kind: "record_location";
      name: string;
      description: string;
      isNew: boolean;
    }
  | {
      kind: "advance_time";
      minutes: number;
      time_minutes: number;
      day_count: number;
      weather: string;
    }
  | { kind: "record_lore"; fact: string };

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

export async function executeTool(
  name: string,
  input: unknown,
  campaignId: string,
): Promise<ToolEvent> {
  const args = (input ?? {}) as Record<string, unknown>;
  switch (name) {
    case "roll_dice": {
      const sides = clamp(Number(args.sides ?? 20) | 0, 2, 100);
      const count = clamp(Number(args.count ?? 1) | 0, 1, 10);
      const reason = String(args.reason ?? "");
      const rolls = Array.from(
        { length: count },
        () => 1 + Math.floor(Math.random() * sides),
      );
      const total = rolls.reduce((a, b) => a + b, 0);
      return { kind: "roll_dice", reason, sides, count, rolls, total };
    }
    case "update_hp": {
      const delta = Number(args.delta ?? 0) | 0;
      const reason = String(args.reason ?? "");
      const admin = db();
      const { data: ch } = await admin
        .from("dm_characters")
        .select("hp, max_hp")
        .eq("campaign_id", campaignId)
        .single();
      if (!ch) throw new Error("Character not found");
      const next = clamp(ch.hp + delta, 0, ch.max_hp);
      await admin
        .from("dm_characters")
        .update({ hp: next, updated_at: new Date().toISOString() })
        .eq("campaign_id", campaignId);
      return {
        kind: "update_hp",
        delta,
        reason,
        hp: next,
        max_hp: ch.max_hp,
      };
    }
    case "add_item": {
      const item = String(args.item ?? "").trim();
      const quantity = clamp(Number(args.quantity ?? 1) | 0, 1, 999);
      if (!item) throw new Error("Empty item name");
      const admin = db();
      const { data: ch } = await admin
        .from("dm_characters")
        .select("inventory")
        .eq("campaign_id", campaignId)
        .single();
      const inv: InventoryItem[] = (ch?.inventory as InventoryItem[]) ?? [];
      const idx = inv.findIndex(
        (i) => i.item.toLowerCase() === item.toLowerCase(),
      );
      if (idx >= 0) inv[idx].quantity += quantity;
      else inv.push({ item, quantity });
      await admin
        .from("dm_characters")
        .update({ inventory: inv, updated_at: new Date().toISOString() })
        .eq("campaign_id", campaignId);
      return { kind: "add_item", item, quantity };
    }
    case "set_scene": {
      const location = String(args.location ?? "").trim();
      const mood = String(args.mood ?? "calm").trim() as SceneMood;
      const validMoods: SceneMood[] = [
        "calm",
        "tense",
        "combat",
        "mysterious",
        "festive",
      ];
      const safeMood: SceneMood = validMoods.includes(mood) ? mood : "calm";
      const prompt = String(args.image_prompt ?? "").trim();
      // Pollinations.ai — free, no auth, supports flux. We add stylistic
      // suffixes for a consistent dark-fantasy painterly look and a fixed
      // seed seeded by the prompt so reload renders the same image.
      const styled = `${prompt}, dark fantasy concept art, painterly, atmospheric, cinematic lighting, no text, no watermark`;
      const seed = Array.from(prompt).reduce(
        (a, c) => (a * 31 + c.charCodeAt(0)) >>> 0,
        7,
      );
      const image_url = `https://image.pollinations.ai/prompt/${encodeURIComponent(
        styled,
      )}?width=768&height=432&model=flux&nologo=true&private=true&seed=${seed}`;
      return {
        kind: "set_scene",
        location,
        mood: safeMood,
        image_prompt: prompt,
        image_url,
      };
    }
    case "remove_item": {
      const item = String(args.item ?? "").trim();
      const quantity = clamp(Number(args.quantity ?? 1) | 0, 1, 999);
      const admin = db();
      const { data: ch } = await admin
        .from("dm_characters")
        .select("inventory")
        .eq("campaign_id", campaignId)
        .single();
      const inv: InventoryItem[] = (ch?.inventory as InventoryItem[]) ?? [];
      const idx = inv.findIndex(
        (i) => i.item.toLowerCase() === item.toLowerCase(),
      );
      let remaining = 0;
      if (idx >= 0) {
        inv[idx].quantity -= quantity;
        if (inv[idx].quantity <= 0) inv.splice(idx, 1);
        else remaining = inv[idx].quantity;
      }
      await admin
        .from("dm_characters")
        .update({ inventory: inv, updated_at: new Date().toISOString() })
        .eq("campaign_id", campaignId);
      return { kind: "remove_item", item, quantity, remaining };
    }
    case "record_npc": {
      const npcName = String(args.name ?? "").trim();
      const description = String(args.description ?? "").trim();
      const attitudeRaw = String(args.attitude ?? "neutral");
      const validAttitudes: NpcAttitude[] = [
        "friendly",
        "hostile",
        "neutral",
        "suspicious",
        "allied",
        "fearful",
      ];
      const attitude: NpcAttitude = validAttitudes.includes(
        attitudeRaw as NpcAttitude,
      )
        ? (attitudeRaw as NpcAttitude)
        : "neutral";
      const relationship = clamp(Number(args.relationship ?? 0) | 0, -100, 100);
      const notes =
        typeof args.notes === "string" ? args.notes.trim() : null;
      if (!npcName) throw new Error("NPC name required");

      const admin = db();
      const { data: existing } = await admin
        .from("dm_npcs")
        .select("id, relationship")
        .eq("campaign_id", campaignId)
        .ilike("name", npcName)
        .maybeSingle();

      if (existing) {
        await admin
          .from("dm_npcs")
          .update({
            description,
            attitude,
            relationship:
              args.relationship === undefined
                ? existing.relationship
                : relationship,
            notes: notes ?? undefined,
            last_seen_at: new Date().toISOString(),
          })
          .eq("id", existing.id);
        return {
          kind: "record_npc",
          name: npcName,
          description,
          attitude,
          relationship:
            args.relationship === undefined
              ? existing.relationship
              : relationship,
          isNew: false,
        };
      }

      await admin.from("dm_npcs").insert({
        campaign_id: campaignId,
        name: npcName,
        description,
        attitude,
        relationship,
        notes,
      });
      return {
        kind: "record_npc",
        name: npcName,
        description,
        attitude,
        relationship,
        isNew: true,
      };
    }
    case "record_location": {
      const locName = String(args.name ?? "").trim();
      const description = String(args.description ?? "").trim();
      const notes =
        typeof args.notes === "string" ? args.notes.trim() : null;
      if (!locName) throw new Error("Location name required");

      const admin = db();
      const { data: existing } = await admin
        .from("dm_locations")
        .select("id")
        .eq("campaign_id", campaignId)
        .ilike("name", locName)
        .maybeSingle();

      if (existing) {
        await admin
          .from("dm_locations")
          .update({
            description,
            notes: notes ?? undefined,
            last_visited_at: new Date().toISOString(),
          })
          .eq("id", existing.id);
        return {
          kind: "record_location",
          name: locName,
          description,
          isNew: false,
        };
      }

      await admin.from("dm_locations").insert({
        campaign_id: campaignId,
        name: locName,
        description,
        notes,
      });
      return {
        kind: "record_location",
        name: locName,
        description,
        isNew: true,
      };
    }
    case "advance_time": {
      const mins = Math.max(1, Math.min(60 * 24 * 30, Number(args.minutes ?? 0) | 0));
      const newWeather =
        typeof args.weather === "string"
          ? String(args.weather).trim().toLowerCase()
          : null;

      const admin = db();
      const { data: cam } = await admin
        .from("dm_campaigns")
        .select("time_minutes, day_count, weather")
        .eq("id", campaignId)
        .single();
      if (!cam) throw new Error("Campaign missing");

      const totalMins = (cam.time_minutes ?? 0) + mins;
      const daysAdvanced = Math.floor(totalMins / 1440);
      const time_minutes = totalMins % 1440;
      const day_count = (cam.day_count ?? 1) + daysAdvanced;
      const weather = newWeather ?? cam.weather ?? "clear";

      await admin
        .from("dm_campaigns")
        .update({
          time_minutes,
          day_count,
          weather,
          updated_at: new Date().toISOString(),
        })
        .eq("id", campaignId);

      return {
        kind: "advance_time",
        minutes: mins,
        time_minutes,
        day_count,
        weather,
      };
    }
    case "record_lore": {
      const fact = String(args.fact ?? "").trim();
      if (!fact) throw new Error("Lore fact required");
      const admin = db();
      await admin
        .from("dm_lore")
        .insert({ campaign_id: campaignId, fact });
      return { kind: "record_lore", fact };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
