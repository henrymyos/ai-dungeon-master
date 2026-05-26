import { createAdminClient } from "@/lib/supabase/admin";

export type DmCampaign = {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

export type DmMessageRow = {
  id: number;
  campaign_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

export const OPENING_NARRATION =
  "Fog pools knee-deep between the trees. The path you've been walking is gone — somewhere behind you, lost in the gloaming. A single lantern hangs from a low branch ahead, its flame steady despite the windless air. You hear something move, just out of sight.";

/**
 * Convenience wrapper — the admin client bypasses RLS, so every helper
 * here also takes a user_id and filters by it for ownership enforcement
 * at the API layer.
 */
export function db() {
  return createAdminClient();
}
