import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { loadWorld } from "@/lib/world";
import { getUserId } from "@/lib/user";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const userId = await getUserId();
  const { data: own } = await db()
    .from("dm_campaigns")
    .select("id")
    .eq("id", id)
    .eq("user_id", userId)
    .single();
  if (!own) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const world = await loadWorld(id);
  if (!world)
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ world });
}
