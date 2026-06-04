import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUserId } from "@/lib/user";

export const runtime = "nodejs";

/**
 * Rewind the last turn: delete the most recent user + assistant pair.
 * Returns the deleted user message's content so the client can replay
 * (retry), modify (edit), or just refresh (undo).
 *
 * Caveat baked into the UX: we do NOT roll back character HP / inventory
 * / world state. Tool mutations were already persisted and could have
 * downstream effects; trying to reverse them would tangle the state
 * machine. The narration rewinds; the consequences linger.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const userId = await getUserId();

  const admin = db();
  const { data: own } = await admin
    .from("dm_campaigns")
    .select("id")
    .eq("id", id)
    .eq("user_id", userId)
    .single();
  if (!own)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Pull the most recent few rows in descending id order.
  const { data: recent, error } = await admin
    .from("dm_messages")
    .select("id, role, content")
    .eq("campaign_id", id)
    .order("id", { ascending: false })
    .limit(6);
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  const rows = (recent ?? []) as { id: number; role: string; content: string }[];
  if (rows.length === 0)
    return NextResponse.json({ deleted: [], lastUserAction: null });

  // Walk from the top: collect trailing assistant rows (one tool turn can
  // leave multiple), then the user that prompted them.
  const toDelete: number[] = [];
  let lastUserAction: string | null = null;
  for (const r of rows) {
    if (r.role === "assistant" && lastUserAction === null) {
      toDelete.push(r.id);
      continue;
    }
    if (r.role === "user") {
      toDelete.push(r.id);
      lastUserAction = r.content;
      break;
    }
  }

  // Nothing to rewind (only the opening narration exists, no user turn yet).
  if (lastUserAction === null) {
    return NextResponse.json({ deleted: [], lastUserAction: null });
  }

  await admin.from("dm_messages").delete().in("id", toDelete);
  await admin
    .from("dm_campaigns")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", id);

  return NextResponse.json({ deleted: toDelete, lastUserAction });
}
