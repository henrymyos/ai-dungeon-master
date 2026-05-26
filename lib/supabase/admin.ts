import { createClient } from "@supabase/supabase-js";

/**
 * Service-role client. Bypasses RLS — only use server-side, never from the
 * browser. Useful in CLI scripts and trusted server actions where you've
 * already verified the caller's identity.
 */
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}
