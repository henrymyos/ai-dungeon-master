import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUserId } from "@/lib/user";

export const runtime = "nodejs";

/**
 * Fork a campaign at a specific message. The new campaign:
 *   - inherits the source's title (prefixed "Fork of "), summary, time,
 *     weather, story arc, current beat
 *   - copies the player's character and skills/inventory exactly
 *   - copies all NPCs, locations, lore, statuses, quests
 *   - copies messages up to and INCLUDING the fork point
 *   - skips the source's active encounter (if any) — combat doesn't
 *     reset on a save point
 *   - clears the share_token (each branch gets its own)
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; msgId: string }> },
) {
  const { id, msgId } = await params;
  const userId = await getUserId();
  const admin = db();

  // 1. Ownership + source row.
  const { data: source } = await admin
    .from("dm_campaigns")
    .select(
      "id, title, summary, summary_through_message_id, time_minutes, day_count, weather, story_arc, current_beat",
    )
    .eq("id", id)
    .eq("user_id", userId)
    .single();
  if (!source)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  // 2. Make sure the fork point belongs to this campaign.
  const msgIdNum = Number(msgId);
  if (!Number.isFinite(msgIdNum))
    return NextResponse.json({ error: "Invalid message id" }, { status: 400 });
  const { data: fork } = await admin
    .from("dm_messages")
    .select("id, created_at")
    .eq("id", msgIdNum)
    .eq("campaign_id", id)
    .single();
  if (!fork)
    return NextResponse.json({ error: "Fork point not found" }, { status: 404 });

  // 3. Create the new campaign.
  const newTitle = source.title.startsWith("Fork of ")
    ? source.title
    : `Fork of ${source.title}`;
  const { data: cloned, error: cErr } = await admin
    .from("dm_campaigns")
    .insert({
      user_id: userId,
      title: newTitle.slice(0, 120),
      summary: source.summary,
      summary_through_message_id: source.summary_through_message_id,
      time_minutes: source.time_minutes,
      day_count: source.day_count,
      weather: source.weather,
      story_arc: source.story_arc,
      current_beat: source.current_beat,
    })
    .select()
    .single();
  if (cErr || !cloned)
    return NextResponse.json({ error: "Fork failed" }, { status: 500 });
  const newId = cloned.id as string;

  // 4. Clone the character row.
  const { data: ch } = await admin
    .from("dm_characters")
    .select(
      "name, class, hp, max_hp, attributes, inventory, skills, portrait_url, portrait_hash",
    )
    .eq("campaign_id", id)
    .single();
  if (ch) {
    await admin
      .from("dm_characters")
      .insert({ campaign_id: newId, ...ch });
  } else {
    await admin.from("dm_characters").insert({ campaign_id: newId });
  }

  // 5. Copy messages up to and including the fork point.
  const { data: msgs } = await admin
    .from("dm_messages")
    .select(
      "role, content, scene, created_at, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens",
    )
    .eq("campaign_id", id)
    .lte("id", msgIdNum)
    .order("created_at", { ascending: true });
  if (msgs && msgs.length > 0) {
    const rows = msgs.map((m) => ({ campaign_id: newId, ...m }));
    await admin.from("dm_messages").insert(rows);
  }

  // 6. Copy NPCs / locations / lore / quests.
  const childCopiers: { from: string; cols: string[] }[] = [
    {
      from: "dm_npcs",
      cols: [
        "name",
        "description",
        "attitude",
        "relationship",
        "notes",
        "first_seen_at",
        "last_seen_at",
      ],
    },
    {
      from: "dm_locations",
      cols: [
        "name",
        "description",
        "notes",
        "first_visited_at",
        "last_visited_at",
      ],
    },
    { from: "dm_lore", cols: ["fact", "created_at"] },
    {
      from: "dm_quests",
      cols: ["name", "description", "status", "notes", "created_at", "updated_at"],
    },
  ];
  for (const { from, cols } of childCopiers) {
    const { data } = await admin
      .from(from)
      .select(cols.join(", "))
      .eq("campaign_id", id);
    const rows = (data as Record<string, unknown>[] | null) ?? [];
    if (rows.length > 0) {
      const scoped = rows.map((row) => ({ ...row, campaign_id: newId }));
      await admin.from(from).insert(scoped);
    }
  }

  // 7. Copy statuses (scoped to the new character).
  const { data: newChar } = await admin
    .from("dm_characters")
    .select("id")
    .eq("campaign_id", newId)
    .single();
  const { data: oldChar } = await admin
    .from("dm_characters")
    .select("id")
    .eq("campaign_id", id)
    .single();
  if (newChar && oldChar) {
    const { data: statuses } = await admin
      .from("dm_statuses")
      .select("name, kind, description, expires_at_minutes, created_at")
      .eq("character_id", oldChar.id);
    if (statuses && statuses.length > 0) {
      const rows = statuses.map((s) => ({ ...s, character_id: newChar.id }));
      await admin.from("dm_statuses").insert(rows);
    }
  }

  return NextResponse.json({ campaign: cloned });
}
