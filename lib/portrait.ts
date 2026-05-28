import "server-only";
import { db, type DmCharacter, type DmStatus, type InventoryItem } from "@/lib/db";

const TOGETHER_ENDPOINT = "https://api.together.xyz/v1/images/generations";
const TOGETHER_MODEL = "black-forest-labs/FLUX.1-schnell";
const WIDTH = 512;
const HEIGHT = 640;
const STEPS = 4;

const STYLE_SUFFIX =
  ", dark fantasy character portrait, painterly, soft moody rim light, head-and-shoulders, neutral dark background, no text, no watermark";

const CLASS_FRAME: Record<string, string> = {
  Wanderer: "a weary traveller in a hooded cloak",
  Fighter: "a battle-hardened warrior",
  Rogue: "a sharp-eyed rogue in dark leathers",
  Mage: "a robed mage with sigil-marked sleeves",
  Ranger: "a green-cloaked ranger with a longbow slung over one shoulder",
};

function hash(s: string): string {
  let h = 7;
  for (const ch of s) h = ((h << 5) - h + ch.charCodeAt(0)) >>> 0;
  return h.toString(36);
}

/** A stable signature of everything that would change the portrait. Two
 *  characters with the same signature can share an image. */
export function portraitSignature(
  character: Pick<DmCharacter, "name" | "class" | "inventory">,
  statuses: Pick<DmStatus, "name" | "kind">[],
): string {
  const inv = [...character.inventory]
    .map((i) => i.item.toLowerCase())
    .sort()
    .join("|");
  const st = [...statuses]
    .map((s) => `${s.kind}:${s.name.toLowerCase()}`)
    .sort()
    .join("|");
  return hash(`${character.class}::${character.name}::${inv}::${st}`);
}

function buildPrompt(
  character: Pick<DmCharacter, "name" | "class" | "inventory">,
  statuses: Pick<DmStatus, "name" | "kind" | "description">[],
): string {
  const frame = CLASS_FRAME[character.class] ?? "an adventurer";
  const gear = character.inventory
    .filter((i) => looksWearableOrCarried(i))
    .slice(0, 6)
    .map((i) => i.item)
    .join(", ");
  const injuries = statuses
    .filter((s) => s.kind === "injury")
    .slice(0, 2)
    .map((s) => s.name.toLowerCase());
  const buffs = statuses
    .filter((s) => s.kind === "buff")
    .slice(0, 2)
    .map((s) => s.name.toLowerCase());

  const parts = [`${frame} named ${character.name}`];
  if (gear) parts.push(`carrying ${gear}`);
  if (injuries.length) parts.push(`visibly ${injuries.join(" and ")}`);
  if (buffs.length) parts.push(`a faint ${buffs.join(", ")} aura`);
  return parts.join(", ");
}

/** Items we'll bias toward including in the prompt. Skips abstract things
 *  like "memory of a friend" or single-use consumables. */
function looksWearableOrCarried(i: InventoryItem): boolean {
  const t = i.item.toLowerCase();
  if (t.length > 32) return false;
  return /sword|dagger|knife|axe|bow|staff|wand|shield|armor|armour|cloak|robe|hood|hat|helmet|amulet|ring|pendant|book|spellbook|lantern|torch|lockpick|arrow|quiver|coin|pouch|satchel|backpack|gem|orb/.test(
    t,
  );
}

type TogetherResponse = { data?: { url?: string }[]; error?: { message?: string } };

/**
 * Regenerate the character's portrait if the signature of their current
 * gear/state has changed. Returns the public URL of the (possibly new)
 * portrait, or null if generation is unavailable. Best-effort — on any
 * failure we leave the existing portrait_url alone.
 */
export async function refreshPortraitIfStale(
  campaignId: string,
): Promise<string | null> {
  const apiKey = process.env.TOGETHER_API_KEY;
  if (!apiKey) return null;
  const admin = db();

  const { data: ch } = await admin
    .from("dm_characters")
    .select("id, name, class, inventory, portrait_url, portrait_hash")
    .eq("campaign_id", campaignId)
    .single();
  if (!ch) return null;

  const { data: statusRows } = await admin
    .from("dm_statuses")
    .select("name, kind, description")
    .eq("character_id", ch.id);
  const statuses = (statusRows ?? []) as Pick<
    DmStatus,
    "name" | "kind" | "description"
  >[];

  const character = {
    name: ch.name as string,
    class: ch.class as string,
    inventory: (ch.inventory as InventoryItem[]) ?? [],
  };
  const sig = portraitSignature(character, statuses);
  if (sig === ch.portrait_hash && ch.portrait_url) return ch.portrait_url as string;

  const prompt = buildPrompt(character, statuses);
  const bucket = admin.storage.from("portraits");
  const path = `${campaignId}/${sig}.jpg`;

  // Cached image for this exact signature?
  try {
    const { data: existing } = await bucket.list(campaignId, {
      search: `${sig}.jpg`,
      limit: 1,
    });
    if (existing && existing.some((f) => f.name === `${sig}.jpg`)) {
      const url = bucket.getPublicUrl(path).data.publicUrl;
      await admin
        .from("dm_characters")
        .update({ portrait_url: url, portrait_hash: sig })
        .eq("id", ch.id);
      return url;
    }
  } catch {}

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
      console.warn("Portrait Together non-OK", res.status, await res.text().catch(() => ""));
      return ch.portrait_url ?? null;
    }
    const json = (await res.json()) as TogetherResponse;
    tempUrl = json.data?.[0]?.url ?? null;
  } catch (err) {
    console.warn("Portrait Together fetch failed", err);
    return ch.portrait_url ?? null;
  }
  if (!tempUrl) return ch.portrait_url ?? null;

  try {
    const imgRes = await fetch(tempUrl);
    if (!imgRes.ok) return tempUrl;
    const buf = new Uint8Array(await imgRes.arrayBuffer());
    const { error } = await bucket.upload(path, buf as unknown as ArrayBuffer, {
      contentType: "image/jpeg",
      upsert: true,
    });
    if (error) {
      console.warn("Portrait upload failed", error.message);
      return tempUrl;
    }
    const url = bucket.getPublicUrl(path).data.publicUrl;
    await admin
      .from("dm_characters")
      .update({ portrait_url: url, portrait_hash: sig })
      .eq("id", ch.id);
    return url;
  } catch (err) {
    console.warn("Portrait storage step failed", err);
    return tempUrl;
  }
}

/** Fire-and-forget wrapper: never awaited from request paths, so the
 *  stream isn't blocked on FLUX. Errors are swallowed. */
export function refreshPortraitInBackground(campaignId: string): void {
  refreshPortraitIfStale(campaignId).catch((e) =>
    console.warn("portrait bg refresh failed", e),
  );
}
