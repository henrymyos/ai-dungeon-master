import "server-only";
import { db } from "@/lib/db";

const TOGETHER_ENDPOINT = "https://api.together.xyz/v1/images/generations";
// Together's serverless FLUX.1-schnell — ~$0.003/image, ~1–3s.
// The "FLUX.1-schnell-Free" variant exists but is no longer
// serverless (requires a dedicated endpoint), so we use the standard
// paid serverless one. $5 of credits lasts ~1,600 images.
const TOGETHER_MODEL = "black-forest-labs/FLUX.1-schnell";
const WIDTH = 768;
const HEIGHT = 432;
const STEPS = 4;

const STYLE_SUFFIX =
  ", dark fantasy concept art, painterly, atmospheric, cinematic lighting, no text, no watermark";

/** Cheap, stable, URL-safe hash of a string. Used to make the storage
 *  key deterministic so identical prompts cache instead of regenerating. */
function hashPrompt(prompt: string): string {
  let h = 7;
  for (const ch of prompt) h = ((h << 5) - h + ch.charCodeAt(0)) >>> 0;
  return h.toString(36);
}

function pollinationsFallback(prompt: string): string {
  const styled = prompt + STYLE_SUFFIX;
  const seed = Number.parseInt(hashPrompt(prompt), 36) % 1_000_000;
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(styled)}?width=${WIDTH}&height=${HEIGHT}&model=flux&nologo=true&private=true&seed=${seed}`;
}

type TogetherResponse = {
  data?: { url?: string; b64_json?: string }[];
  error?: { message?: string };
};

/**
 * Generate (or fetch from cache) a scene illustration. Returns a permanent
 * URL that survives campaign reloads.
 *
 * Flow:
 *   1. If TOGETHER_API_KEY is missing, return a Pollinations URL and bail
 *      (60–90s in-browser, but at least it works).
 *   2. Check Supabase Storage for a previously-generated image with the
 *      same prompt hash. If present, return the cached public URL.
 *   3. Otherwise call Together's FLUX.1-schnell endpoint (~1–3s), download
 *      the result, upload to Supabase Storage, return the public URL.
 *   4. On any error along the way, fall back to Pollinations so something
 *      shows up.
 */
export async function generateScene(
  prompt: string,
  campaignId: string,
): Promise<string> {
  const apiKey = process.env.TOGETHER_API_KEY;
  const path = `${campaignId}/${hashPrompt(prompt)}.jpg`;
  const admin = db();
  const bucket = admin.storage.from("scenes");

  // 1. Cached?
  try {
    const folder = campaignId;
    const filename = `${hashPrompt(prompt)}.jpg`;
    const { data: existing } = await bucket.list(folder, {
      search: filename,
      limit: 1,
    });
    if (existing && existing.some((f) => f.name === filename)) {
      return bucket.getPublicUrl(path).data.publicUrl;
    }
  } catch {
    // Non-fatal; carry on.
  }

  if (!apiKey) return pollinationsFallback(prompt);

  // 2. Generate via Together.
  let tempUrl: string | null = null;
  try {
    const res = await fetch(TOGETHER_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: TOGETHER_MODEL,
        prompt: prompt + STYLE_SUFFIX,
        width: WIDTH,
        height: HEIGHT,
        steps: STEPS,
        n: 1,
        response_format: "url",
      }),
    });
    if (!res.ok) {
      console.warn("Together image gen non-OK", res.status, await res.text().catch(() => ""));
      return pollinationsFallback(prompt);
    }
    const json = (await res.json()) as TogetherResponse;
    tempUrl = json.data?.[0]?.url ?? null;
    if (!tempUrl) {
      console.warn("Together returned no URL", json.error?.message);
      return pollinationsFallback(prompt);
    }
  } catch (err) {
    console.warn("Together fetch failed", err);
    return pollinationsFallback(prompt);
  }

  // 3. Download + upload to Supabase Storage so the URL is permanent.
  try {
    const imgRes = await fetch(tempUrl);
    if (!imgRes.ok) return tempUrl;
    const buf = new Uint8Array(await imgRes.arrayBuffer());
    const { error } = await bucket.upload(path, buf as unknown as ArrayBuffer, {
      contentType: "image/jpeg",
      upsert: true,
    });
    if (error) {
      console.warn("Supabase scene upload failed, using temp URL", error.message);
      return tempUrl;
    }
    return bucket.getPublicUrl(path).data.publicUrl;
  } catch (err) {
    console.warn("Scene storage step failed, using temp URL", err);
    return tempUrl;
  }
}
