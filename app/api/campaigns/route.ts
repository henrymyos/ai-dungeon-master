import { NextResponse } from "next/server";
import { z } from "zod";
import {
  CLASS_PRESETS,
  db,
  OPENING_NARRATION,
  type ClassKey,
  type DmCampaign,
} from "@/lib/db";
import { generateStoryArc } from "@/lib/arc";
import { generateOpeningNarration } from "@/lib/opening";
import { getUserId } from "@/lib/user";
import { refreshPortraitInBackground } from "@/lib/portrait";
import { checkRate, rateLimitResponse } from "@/lib/ratelimit";

export const runtime = "nodejs";

// Campaign creation kicks off an arc generation + portrait — pricier
// than a turn, so the cap is lower.
const CREATE_LIMIT = 12;
const CREATE_WINDOW_MS = 60 * 60 * 1000;

const NewCampaignBody = z.object({
  scenario: z.string().trim().max(1000).optional(),
  characterName: z.string().trim().min(1).max(40).optional(),
  characterClass: z
    .enum(["Wanderer", "Fighter", "Rogue", "Mage", "Ranger"])
    .optional(),
  backstory: z.string().trim().max(1000).optional(),
});

export async function GET() {
  const userId = await getUserId();
  const { data, error } = await db()
    .from("dm_campaigns")
    .select(
      "id, user_id, title, summary, summary_through_message_id, share_token, time_minutes, day_count, weather, story_arc, current_beat, scenario, created_at, updated_at",
    )
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ campaigns: (data ?? []) as DmCampaign[] });
}

export async function POST(req: Request) {
  const userId = await getUserId();
  const rl = checkRate(`create:${userId}`, CREATE_LIMIT, CREATE_WINDOW_MS);
  if (!rl.allowed) {
    return rateLimitResponse(
      rl,
      "You've hit the per-hour new-adventure limit on the public demo.",
    );
  }
  const admin = db();

  // Body is optional — empty/no body means the legacy fog-forest default.
  const raw = await req.json().catch(() => null);
  const parsed = NewCampaignBody.safeParse(raw ?? {});
  const body = parsed.success ? parsed.data : {};
  const scenario = body.scenario || null;
  const cls = (body.characterClass ?? "Wanderer") as ClassKey;
  const preset = CLASS_PRESETS[cls];

  // Custom scenario → bespoke opening narration via Claude. Falls back
  // gracefully if generation fails or no scenario is provided.
  const opening = scenario
    ? await generateOpeningNarration(scenario).catch(() => OPENING_NARRATION)
    : OPENING_NARRATION;

  const { data: campaign, error: cErr } = await admin
    .from("dm_campaigns")
    .insert({
      user_id: userId,
      title: "A new adventure",
      scenario,
    })
    .select()
    .single();
  if (cErr || !campaign) {
    return NextResponse.json(
      { error: cErr?.message ?? "create failed" },
      { status: 500 },
    );
  }

  // Arc + opening message + character all in parallel.
  const arcPromise = generateStoryArc(
    scenario ? `${scenario}\n\nOpening:\n${opening}` : opening,
  ).catch(() => null);
  await Promise.all([
    admin.from("dm_messages").insert({
      campaign_id: campaign.id,
      role: "assistant",
      content: opening,
    }),
    admin.from("dm_characters").insert({
      campaign_id: campaign.id,
      name: body.characterName ?? "Wanderer",
      class: cls,
      hp: preset.hp,
      max_hp: preset.hp,
      attributes: preset.attributes,
      inventory: preset.inventory,
      skills: preset.skills,
      backstory: body.backstory ?? null,
    }),
  ]);
  const arc = await arcPromise;
  if (arc) {
    await admin
      .from("dm_campaigns")
      .update({ story_arc: arc })
      .eq("id", campaign.id);
  }

  refreshPortraitInBackground(campaign.id);

  return NextResponse.json({ campaign: { ...campaign, story_arc: arc } });
}
