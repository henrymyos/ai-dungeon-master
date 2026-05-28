/**
 * One-shot backfill: find every dm_messages row whose scene.image_url
 * points at the slow Pollinations endpoint and re-generate the image
 * through Together AI (fast), uploading to Supabase Storage. Updates
 * the row to point at the new permanent URL.
 *
 *   npx tsx scripts/backfill-scenes.ts
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();

import { createClient } from "@supabase/supabase-js";

const TOGETHER_ENDPOINT = "https://api.together.xyz/v1/images/generations";
const TOGETHER_MODEL = "black-forest-labs/FLUX.1-schnell";
const STYLE_SUFFIX =
  ", dark fantasy concept art, painterly, atmospheric, cinematic lighting, no text, no watermark";

function hashPrompt(prompt: string): string {
  let h = 7;
  for (const ch of prompt) h = ((h << 5) - h + ch.charCodeAt(0)) >>> 0;
  return h.toString(36);
}

async function generate(prompt: string): Promise<string | null> {
  const res = await fetch(TOGETHER_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.TOGETHER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: TOGETHER_MODEL,
      prompt: prompt + STYLE_SUFFIX,
      width: 768,
      height: 432,
      steps: 4,
      n: 1,
      response_format: "url",
    }),
  });
  if (!res.ok) {
    console.error(" together call failed", res.status, await res.text());
    return null;
  }
  const json = (await res.json()) as {
    data?: { url?: string }[];
  };
  return json.data?.[0]?.url ?? null;
}

async function main() {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  // Find every assistant message with a Pollinations scene URL.
  const { data, error } = await admin
    .from("dm_messages")
    .select("id, campaign_id, scene")
    .like("scene->>image_url", "%image.pollinations.ai%");
  if (error) throw error;
  const rows = data ?? [];
  console.log(`Found ${rows.length} message(s) with Pollinations scene URLs.`);

  for (const row of rows) {
    const scene = row.scene as {
      location: string;
      mood: string;
      image_prompt: string;
      image_url: string;
    };
    console.log(`→ msg ${row.id} · ${scene.location} (${scene.mood})`);
    const tempUrl = await generate(scene.image_prompt);
    if (!tempUrl) {
      console.log("  ✗ generation failed, skipping");
      continue;
    }
    // Download + upload to Storage.
    const imgRes = await fetch(tempUrl);
    if (!imgRes.ok) {
      console.log("  ✗ download failed, skipping");
      continue;
    }
    const buf = new Uint8Array(await imgRes.arrayBuffer());
    const path = `${row.campaign_id}/${hashPrompt(scene.image_prompt)}.jpg`;
    const { error: upErr } = await admin.storage
      .from("scenes")
      .upload(path, buf, { contentType: "image/jpeg", upsert: true });
    if (upErr) {
      console.log("  ✗ upload failed", upErr.message);
      continue;
    }
    const publicUrl = admin.storage.from("scenes").getPublicUrl(path)
      .data.publicUrl;
    const { error: updErr } = await admin
      .from("dm_messages")
      .update({ scene: { ...scene, image_url: publicUrl } })
      .eq("id", row.id);
    if (updErr) {
      console.log("  ✗ DB update failed", updErr.message);
      continue;
    }
    console.log(`  ✓ ${publicUrl}`);
  }
  console.log("\nDone.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
