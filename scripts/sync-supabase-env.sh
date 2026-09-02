#!/usr/bin/env bash
# Push the three Supabase env vars from .env.local to Vercel (production),
# replacing any existing values. Run from the repo root after updating
# .env.local with the new project's URL and keys.
set -euo pipefail

cd "$(dirname "$0")/.."

for key in NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY; do
  value=$(grep -E "^${key}=" .env.local | head -1 | cut -d= -f2-)
  if [ -z "$value" ]; then
    echo "MISSING ${key} in .env.local — aborting" >&2
    exit 1
  fi
  vercel env rm "$key" production --yes 2>/dev/null || true
  printf '%s' "$value" | vercel env add "$key" production
  echo "synced ${key}"
done

echo "Done. Now redeploy: vercel --prod"
