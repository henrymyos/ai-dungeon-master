import { cookies } from "next/headers";

const COOKIE = "visitor_id";

/**
 * Returns the per-visitor user id, taken from the `visitor_id` cookie
 * set by middleware. Falls back to DEFAULT_USER_ID for the CLI scripts
 * (which run outside the request cycle).
 */
export async function getUserId(): Promise<string> {
  try {
    const store = await cookies();
    const fromCookie = store.get(COOKIE)?.value;
    if (fromCookie && isUuid(fromCookie)) return fromCookie;
  } catch {
    // cookies() throws outside a request context — CLI path falls through.
  }
  const fromEnv = process.env.DEFAULT_USER_ID;
  if (fromEnv) return fromEnv;
  throw new Error(
    "No visitor_id cookie and DEFAULT_USER_ID is not set. See .env.example.",
  );
}

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}
