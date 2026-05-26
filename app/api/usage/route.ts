import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { costFor } from "@/lib/pricing";
import { getUserId } from "@/lib/user";

export const runtime = "nodejs";

export async function GET() {
  const userId = await getUserId();
  const admin = db();

  // Join dm_messages → dm_campaigns to filter to this visitor.
  const { data: campaigns } = await admin
    .from("dm_campaigns")
    .select("id")
    .eq("user_id", userId);
  const ids = (campaigns ?? []).map((c) => c.id);
  if (ids.length === 0) {
    return NextResponse.json({
      turns: 0,
      tokens: {
        input_tokens: 0,
        output_tokens: 0,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
      },
      estimatedCostUsd: 0,
    });
  }

  const { data, error } = await admin
    .from("dm_messages")
    .select(
      "input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens",
    )
    .in("campaign_id", ids)
    .eq("role", "assistant");
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  const totals = (data ?? []).reduce(
    (acc, r) => ({
      input_tokens: acc.input_tokens + (r.input_tokens ?? 0),
      output_tokens: acc.output_tokens + (r.output_tokens ?? 0),
      cache_read_tokens: acc.cache_read_tokens + (r.cache_read_tokens ?? 0),
      cache_creation_tokens:
        acc.cache_creation_tokens + (r.cache_creation_tokens ?? 0),
    }),
    {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_tokens: 0,
      cache_creation_tokens: 0,
    },
  );

  return NextResponse.json({
    turns: (data ?? []).filter((r) => (r.output_tokens ?? 0) > 0).length,
    tokens: totals,
    estimatedCostUsd: costFor(totals),
  });
}
