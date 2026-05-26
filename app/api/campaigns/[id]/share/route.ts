import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUserId } from "@/lib/user";

export const runtime = "nodejs";

async function ownsCampaign(id: string, userId: string) {
  const { data } = await db()
    .from("dm_campaigns")
    .select("id, share_token")
    .eq("id", id)
    .eq("user_id", userId)
    .single();
  return data;
}

// Lazily mints a share_token for the campaign (or returns the existing one).
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const userId = await getUserId();
  const owned = await ownsCampaign(id, userId);
  if (!owned)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (owned.share_token) {
    return NextResponse.json({ token: owned.share_token });
  }

  const token = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const { error } = await db()
    .from("dm_campaigns")
    .update({ share_token: token })
    .eq("id", id);
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ token });
}

// Revoke the share link.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const userId = await getUserId();
  const owned = await ownsCampaign(id, userId);
  if (!owned)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db()
    .from("dm_campaigns")
    .update({ share_token: null })
    .eq("id", id);
  return NextResponse.json({ success: true });
}
