import { NextResponse } from "next/server";
import { db, OPENING_NARRATION, type DmCampaign } from "@/lib/db";
import { generateStoryArc } from "@/lib/arc";
import { getUserId } from "@/lib/user";
import { refreshPortraitInBackground } from "@/lib/portrait";
import { checkRate, rateLimitResponse } from "@/lib/ratelimit";

export const runtime = "nodejs";

// Campaign creation kicks off an arc generation + portrait — pricier
// than a turn, so the cap is lower.
const CREATE_LIMIT = 12;
const CREATE_WINDOW_MS = 60 * 60 * 1000;

export async function GET() {
  const userId = await getUserId();
  const { data, error } = await db()
    .from("dm_campaigns")
    .select(
      "id, user_id, title, summary, summary_through_message_id, share_token, time_minutes, day_count, weather, story_arc, current_beat, created_at, updated_at",
    )
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ campaigns: (data ?? []) as DmCampaign[] });
}

export async function POST() {
  const userId = await getUserId();
  const rl = checkRate(`create:${userId}`, CREATE_LIMIT, CREATE_WINDOW_MS);
  if (!rl.allowed) {
    return rateLimitResponse(
      rl,
      "You've hit the per-hour new-adventure limit on the public demo.",
    );
  }
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

  // Seed opening + character, and generate the hidden story arc in
  // parallel. Arc generation is best-effort — if it fails the campaign
  // still runs without one.
  const arcPromise = generateStoryArc(OPENING_NARRATION).catch(() => null);
  await Promise.all([
    admin.from("dm_messages").insert({
      campaign_id: campaign.id,
      role: "assistant",
      content: OPENING_NARRATION,
    }),
    admin.from("dm_characters").insert({ campaign_id: campaign.id }),
  ]);
  const arc = await arcPromise;
  if (arc) {
    await admin
      .from("dm_campaigns")
      .update({ story_arc: arc })
      .eq("id", campaign.id);
  }

  // Kick off the initial portrait in the background so the response
  // returns immediately; the next character refetch will pick it up.
  refreshPortraitInBackground(campaign.id);

  return NextResponse.json({ campaign: { ...campaign, story_arc: arc } });
}
