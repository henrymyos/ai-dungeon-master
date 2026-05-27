import { NextResponse } from "next/server";
import { z } from "zod";
import {
  CLASS_PRESETS,
  db,
  type ClassKey,
  type DmCharacter,
} from "@/lib/db";
import { getUserId } from "@/lib/user";

export const runtime = "nodejs";

async function ownsCampaign(id: string, userId: string) {
  const { data } = await db()
    .from("dm_campaigns")
    .select("id")
    .eq("id", id)
    .eq("user_id", userId)
    .single();
  return !!data;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const userId = await getUserId();
  if (!(await ownsCampaign(id, userId)))
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data, error } = await db()
    .from("dm_characters")
    .select(
      "id, campaign_id, name, class, hp, max_hp, attributes, inventory, skills, created_at, updated_at",
    )
    .eq("campaign_id", id)
    .single();
  if (error || !data)
    return NextResponse.json({ error: "Character missing" }, { status: 404 });
  return NextResponse.json({ character: data as DmCharacter });
}

const Patch = z.object({
  name: z.string().min(1).max(40).optional(),
  class: z.enum(["Wanderer", "Fighter", "Rogue", "Mage", "Ranger"]).optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const userId = await getUserId();
  if (!(await ownsCampaign(id, userId)))
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const raw = await req.json().catch(() => null);
  const parsed = Patch.safeParse(raw);
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const update: Partial<DmCharacter> & { updated_at: string } = {
    updated_at: new Date().toISOString(),
  };
  if (parsed.data.name) update.name = parsed.data.name;
  if (parsed.data.class) {
    const cls = parsed.data.class as ClassKey;
    const preset = CLASS_PRESETS[cls];
    update.class = cls;
    update.hp = preset.hp;
    update.max_hp = preset.hp;
    update.attributes = preset.attributes;
    update.inventory = preset.inventory;
    update.skills = preset.skills;
  }

  const { data, error } = await db()
    .from("dm_characters")
    .update(update)
    .eq("campaign_id", id)
    .select()
    .single();
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ character: data as DmCharacter });
}
