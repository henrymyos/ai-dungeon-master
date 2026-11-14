import "server-only";

/**
 * Tiny in-memory sliding-window rate limiter. Keyed by visitor cookie.
 *
 * NOTE: Vercel serverless functions don't share memory across instances,
 * so this is best-effort — a burst across cold starts can leak past the
 * cap. For a portfolio demo that's fine; the goal is to stop a single
 * bot from racking up $50 of Anthropic + Together credits overnight, not
 * to enforce a strict per-second SLA. Swap to a Supabase-backed counter
 * if you need real durability.
 */

const buckets = new Map<string, { hits: number[]; windowMs: number }>();
// Drop keys whose last hit has left its window, so one-off visitors don't pile up
// on a warm instance. Amortized: the next sweep waits until the map doubles.
let pruneAt = 1000;

function prune(now: number) {
  for (const [k, b] of buckets) if (b.hits[b.hits.length - 1] <= now - b.windowMs) buckets.delete(k);
  pruneAt = Math.max(1000, buckets.size * 2);
}

export const bucketCount = () => buckets.size;

export type RateResult = {
  allowed: boolean;
  remaining: number;
  resetAt: number;
};

export function checkRate(
  key: string,
  limit: number,
  windowMs: number,
): RateResult {
  const now = Date.now();
  const cutoff = now - windowMs;
  const arr = (buckets.get(key)?.hits ?? []).filter((t) => t > cutoff);
  if (arr.length >= limit) {
    return { allowed: false, remaining: 0, resetAt: arr[0] + windowMs };
  }
  arr.push(now);
  if (buckets.size >= pruneAt) prune(now);
  buckets.set(key, { hits: arr, windowMs });
  return { allowed: true, remaining: limit - arr.length, resetAt: now + windowMs };
}

export function rateLimitResponse(result: RateResult, message: string): Response {
  const retryAfterSec = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
  return new Response(JSON.stringify({ error: message, retryAfterSec }), {
    status: 429,
    headers: {
      "Content-Type": "application/json",
      "Retry-After": String(retryAfterSec),
    },
  });
}
