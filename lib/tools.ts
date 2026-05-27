import "server-only";
import {
  db,
  type DmCharacter,
  type InventoryItem,
  type NpcAttitude,
  type StatusKind,
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
      advantage: "normal" | "advantage" | "disadvantage";
      skill_name?: string;
      skill_bonus?: number;
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
  | { kind: "record_lore"; fact: string }
  | {
      kind: "apply_status_effect";
      name: string;
      effect_kind: StatusKind;
      description: string;
      duration_minutes: number | null;
    }
  | { kind: "clear_status_effect"; name: string; cleared: boolean }
  | {
      kind: "start_encounter";
      encounter: string;
      description: string;
      enemies: { name: string; hp: number; max_hp: number; description: string | null }[];
    }
  | {
      kind: "damage_enemy";
      name: string;
      amount: number;
      reason: string;
      hp: number;
      max_hp: number;
      defeated: boolean;
    }
  | { kind: "defeat_enemy"; name: string; reason: string }
  | { kind: "end_encounter"; outcome: string; remaining: number };

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
      const advantageRaw = String(args.advantage ?? "normal");
      const advantage: "normal" | "advantage" | "disadvantage" =
        advantageRaw === "advantage" || advantageRaw === "disadvantage"
          ? advantageRaw
          : "normal";
      const skillName =
        typeof args.skill_name === "string" && args.skill_name.trim()
          ? args.skill_name.trim()
          : undefined;

      // Advantage/disadvantage only applies to a single d20.
      const useAdv = advantage !== "normal" && sides === 20 && count === 1;
      const rolls = useAdv
        ? [
            1 + Math.floor(Math.random() * sides),
            1 + Math.floor(Math.random() * sides),
          ]
        : Array.from(
            { length: count },
            () => 1 + Math.floor(Math.random() * sides),
          );

      let baseTotal: number;
      let displayRolls: number[];
      if (useAdv) {
        baseTotal =
          advantage === "advantage"
            ? Math.max(rolls[0], rolls[1])
            : Math.min(rolls[0], rolls[1]);
        displayRolls = rolls; // show both
      } else {
        baseTotal = rolls.reduce((a, b) => a + b, 0);
        displayRolls = rolls;
      }

      // Skill bonus: look up the trained skill level on the character.
      let skillBonus = 0;
      if (skillName) {
        const { data: ch } = await db()
          .from("dm_characters")
          .select("skills")
          .eq("campaign_id", campaignId)
          .single();
        if (ch?.skills) {
          const match = (ch.skills as { name: string; level: number }[]).find(
            (s) => s.name.toLowerCase() === skillName.toLowerCase(),
          );
          if (match) skillBonus = match.level;
        }
      }

      return {
        kind: "roll_dice",
        reason,
        sides,
        count: useAdv ? 1 : count,
        rolls: displayRolls,
        total: baseTotal + skillBonus,
        advantage,
        skill_name: skillName,
        skill_bonus: skillBonus,
      };
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
    case "apply_status_effect": {
      const statusName = String(args.name ?? "").trim();
      const kindRaw = String(args.kind ?? "condition");
      const validKinds: StatusKind[] = ["debuff", "buff", "condition", "injury"];
      const effectKind: StatusKind = validKinds.includes(kindRaw as StatusKind)
        ? (kindRaw as StatusKind)
        : "condition";
      const description = String(args.description ?? "").trim();
      const duration =
        typeof args.duration_minutes === "number" && args.duration_minutes > 0
          ? (args.duration_minutes as number) | 0
          : null;
      if (!statusName || !description)
        throw new Error("Status name + description required");

      const admin = db();
      const { data: ch } = await admin
        .from("dm_characters")
        .select("id")
        .eq("campaign_id", campaignId)
        .single();
      if (!ch) throw new Error("Character not found");

      let expires_at_minutes: number | null = null;
      if (duration != null) {
        const { data: cam } = await admin
          .from("dm_campaigns")
          .select("time_minutes, day_count")
          .eq("id", campaignId)
          .single();
        const dayMins = ((cam?.day_count ?? 1) - 1) * 1440 + (cam?.time_minutes ?? 0);
        expires_at_minutes = dayMins + duration;
      }

      // Upsert by case-insensitive name.
      const { data: existing } = await admin
        .from("dm_statuses")
        .select("id")
        .eq("character_id", ch.id)
        .ilike("name", statusName)
        .maybeSingle();

      if (existing) {
        await admin
          .from("dm_statuses")
          .update({ kind: effectKind, description, expires_at_minutes })
          .eq("id", existing.id);
      } else {
        await admin.from("dm_statuses").insert({
          character_id: ch.id,
          name: statusName,
          kind: effectKind,
          description,
          expires_at_minutes,
        });
      }
      return {
        kind: "apply_status_effect",
        name: statusName,
        effect_kind: effectKind,
        description,
        duration_minutes: duration,
      };
    }
    case "clear_status_effect": {
      const statusName = String(args.name ?? "").trim();
      const admin = db();
      const { data: ch } = await admin
        .from("dm_characters")
        .select("id")
        .eq("campaign_id", campaignId)
        .single();
      if (!ch) throw new Error("Character not found");
      const { data: existing } = await admin
        .from("dm_statuses")
        .select("id")
        .eq("character_id", ch.id)
        .ilike("name", statusName)
        .maybeSingle();
      if (existing) {
        await admin.from("dm_statuses").delete().eq("id", existing.id);
      }
      return {
        kind: "clear_status_effect",
        name: statusName,
        cleared: Boolean(existing),
      };
    }
    case "start_encounter": {
      const encName = String(args.name ?? "").trim();
      const description = String(args.description ?? "").trim();
      const enemiesIn = Array.isArray(args.enemies) ? args.enemies : [];
      if (!encName) throw new Error("Encounter name required");
      if (enemiesIn.length === 0) throw new Error("At least one enemy required");

      const admin = db();
      // Resolve any prior active encounter — only one can be active at a time.
      await admin
        .from("dm_encounters")
        .update({ status: "resolved", ended_at: new Date().toISOString() })
        .eq("campaign_id", campaignId)
        .eq("status", "active");

      const { data: enc, error } = await admin
        .from("dm_encounters")
        .insert({
          campaign_id: campaignId,
          name: encName,
          description: description || null,
          status: "active",
        })
        .select()
        .single();
      if (error || !enc) throw new Error("Couldn't start encounter");

      const enemyRows = enemiesIn
        .filter((e): e is Record<string, unknown> => typeof e === "object" && e !== null)
        .map((e) => ({
          encounter_id: enc.id,
          name: String(e.name ?? "").trim() || "Enemy",
          hp: clamp(Number(e.hp ?? 10) | 0, 1, 999),
          max_hp: clamp(Number(e.hp ?? 10) | 0, 1, 999),
          description:
            typeof e.description === "string" ? e.description : null,
        }));
      if (enemyRows.length > 0) {
        await admin.from("dm_enemies").insert(enemyRows);
      }

      return {
        kind: "start_encounter",
        encounter: encName,
        description,
        enemies: enemyRows.map((e) => ({
          name: e.name,
          hp: e.hp,
          max_hp: e.max_hp,
          description: e.description,
        })),
      };
    }
    case "damage_enemy": {
      const targetName = String(args.name ?? "").trim();
      const amount = Math.max(0, Number(args.amount ?? 0) | 0);
      const reason = String(args.reason ?? "");
      if (!targetName) throw new Error("Enemy name required");

      const admin = db();
      const { data: enc } = await admin
        .from("dm_encounters")
        .select("id")
        .eq("campaign_id", campaignId)
        .eq("status", "active")
        .maybeSingle();
      if (!enc) throw new Error("No active encounter");

      // Fuzzy match: case-insensitive substring.
      const { data: enemies } = await admin
        .from("dm_enemies")
        .select("id, name, hp, max_hp, is_active")
        .eq("encounter_id", enc.id);
      const enemy = (enemies ?? []).find(
        (e) =>
          e.is_active &&
          (e.name.toLowerCase() === targetName.toLowerCase() ||
            e.name.toLowerCase().includes(targetName.toLowerCase()) ||
            targetName.toLowerCase().includes(e.name.toLowerCase())),
      );
      if (!enemy) throw new Error(`Enemy "${targetName}" not found`);

      const nextHp = Math.max(0, enemy.hp - amount);
      const defeated = nextHp === 0;
      await admin
        .from("dm_enemies")
        .update({
          hp: nextHp,
          is_active: !defeated,
        })
        .eq("id", enemy.id);

      return {
        kind: "damage_enemy",
        name: enemy.name,
        amount,
        reason,
        hp: nextHp,
        max_hp: enemy.max_hp,
        defeated,
      };
    }
    case "defeat_enemy": {
      const targetName = String(args.name ?? "").trim();
      const reason = String(args.reason ?? "");
      const admin = db();
      const { data: enc } = await admin
        .from("dm_encounters")
        .select("id")
        .eq("campaign_id", campaignId)
        .eq("status", "active")
        .maybeSingle();
      if (!enc) throw new Error("No active encounter");
      const { data: enemies } = await admin
        .from("dm_enemies")
        .select("id, name, is_active")
        .eq("encounter_id", enc.id);
      const enemy = (enemies ?? []).find(
        (e) =>
          e.is_active &&
          (e.name.toLowerCase() === targetName.toLowerCase() ||
            e.name.toLowerCase().includes(targetName.toLowerCase()) ||
            targetName.toLowerCase().includes(e.name.toLowerCase())),
      );
      if (!enemy) throw new Error(`Enemy "${targetName}" not found`);
      await admin
        .from("dm_enemies")
        .update({ is_active: false, hp: 0 })
        .eq("id", enemy.id);
      return { kind: "defeat_enemy", name: enemy.name, reason };
    }
    case "end_encounter": {
      const outcome = String(args.outcome ?? "resolved").trim() || "resolved";
      const admin = db();
      const { data: enc } = await admin
        .from("dm_encounters")
        .select("id")
        .eq("campaign_id", campaignId)
        .eq("status", "active")
        .maybeSingle();
      if (!enc) {
        return { kind: "end_encounter", outcome, remaining: 0 };
      }
      const { data: enemies } = await admin
        .from("dm_enemies")
        .select("id")
        .eq("encounter_id", enc.id)
        .eq("is_active", true);
      const remaining = enemies?.length ?? 0;
      await admin
        .from("dm_encounters")
        .update({
          status: "resolved",
          outcome,
          ended_at: new Date().toISOString(),
        })
        .eq("id", enc.id);
      return { kind: "end_encounter", outcome, remaining };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
