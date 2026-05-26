import { NextResponse } from "next/server";
import { db, OPENING_NARRATION, type DmCampaign } from "@/lib/db";
import { getUserId } from "@/lib/user";

export const runtime = "nodejs";

export async function GET() {
  const userId = await getUserId();
  const { data, error } = await db()
    .from("dm_campaigns")
    .select("id, user_id, title, created_at, updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ campaigns: (data ?? []) as DmCampaign[] });
}

export async function POST() {
  const userId = await getUserId();
  const admin = db();

  const { data: campaign, error: cErr } = await admin
    .from("dm_campaigns")
    .insert({ user_id: userId, title: "A new adventure" })
    .select()
    .single();
  if (cErr || !campaign) {
    return NextResponse.json(
      { error: cErr?.message ?? "create failed" },
      { status: 500 },
    );
  }

  // Seed the opening narration and the default character sheet in parallel.
  await Promise.all([
    admin.from("dm_messages").insert({
      campaign_id: campaign.id,
      role: "assistant",
      content: OPENING_NARRATION,
    }),
    admin.from("dm_characters").insert({ campaign_id: campaign.id }),
  ]);

  return NextResponse.json({ campaign });
}
