import "server-only";
import { db, type DmWorld, type DmNpc, type DmLocation, type DmLore } from "@/lib/db";

const RECENT_LORE_LIMIT = 12;

export async function loadWorld(campaignId: string): Promise<DmWorld | null> {
  const admin = db();
  const [{ data: campaign }, { data: npcs }, { data: locations }, { data: lore }] =
    await Promise.all([
      admin
        .from("dm_campaigns")
        .select("time_minutes, day_count, weather")
        .eq("id", campaignId)
        .single(),
      admin
        .from("dm_npcs")
        .select(
          "id, campaign_id, name, description, attitude, relationship, notes, first_seen_at, last_seen_at",
        )
        .eq("campaign_id", campaignId)
        .order("last_seen_at", { ascending: false }),
      admin
        .from("dm_locations")
        .select(
          "id, campaign_id, name, description, notes, first_visited_at, last_visited_at",
        )
        .eq("campaign_id", campaignId)
        .order("last_visited_at", { ascending: false }),
      admin
        .from("dm_lore")
        .select("id, campaign_id, fact, created_at")
        .eq("campaign_id", campaignId)
        .order("created_at", { ascending: false })
        .limit(RECENT_LORE_LIMIT),
    ]);
  if (!campaign) return null;

  return {
    time_minutes: campaign.time_minutes ?? 1080,
    day_count: campaign.day_count ?? 1,
    weather: campaign.weather ?? "clear",
    npcs: (npcs ?? []) as DmNpc[],
    locations: (locations ?? []) as DmLocation[],
    lore: (lore ?? []) as DmLore[],
  };
}

export function formatTime(minutes: number): string {
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function describeTimeOfDay(minutes: number): string {
  const h = Math.floor((minutes % 1440) / 60);
  if (h < 5) return "deep night";
  if (h < 7) return "predawn";
  if (h < 9) return "early morning";
  if (h < 12) return "midmorning";
  if (h < 14) return "midday";
  if (h < 17) return "afternoon";
  if (h < 19) return "evening";
  if (h < 22) return "night";
  return "late night";
}

/** Format the world state as a compact block to feed the DM each turn. */
export function worldStateForPrompt(world: DmWorld): string {
  const lines: string[] = ["## Current world state"];
  lines.push(
    `Time: Day ${world.day_count}, ${formatTime(world.time_minutes)} (${describeTimeOfDay(world.time_minutes)})`,
  );
  lines.push(`Weather: ${world.weather}`);

  if (world.npcs.length > 0) {
    lines.push("");
    lines.push("Known NPCs (refer to them by name when they reappear):");
    for (const n of world.npcs.slice(0, 12)) {
      lines.push(
        `- ${n.name} (${n.attitude}, relationship ${n.relationship}): ${n.description}`,
      );
    }
  }

  if (world.locations.length > 0) {
    lines.push("");
    lines.push("Known locations:");
    for (const l of world.locations.slice(0, 12)) {
      lines.push(`- ${l.name}: ${l.description}`);
    }
  }

  if (world.lore.length > 0) {
    lines.push("");
    lines.push("Established lore (don't contradict):");
    for (const f of world.lore.slice(0, RECENT_LORE_LIMIT)) {
      lines.push(`- ${f.fact}`);
    }
  }

  return lines.join("\n");
}
