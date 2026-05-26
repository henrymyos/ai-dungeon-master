import { NextResponse } from "next/server";
import { db, type DmMessageRow } from "@/lib/db";
import { getUserId } from "@/lib/user";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const userId = await getUserId();
  const admin = db();

  // Confirm ownership first; otherwise a cookie change would let you read
  // someone else's chronicle.
  const { data: campaign, error: cErr } = await admin
    .from("dm_campaigns")
    .select("id")
    .eq("id", id)
    .eq("user_id", userId)
    .single();
  if (cErr || !campaign) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data, error } = await admin
    .from("dm_messages")
    .select("id, campaign_id, role, content, scene, created_at")
    .eq("campaign_id", id)
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ messages: (data ?? []) as DmMessageRow[] });
}
