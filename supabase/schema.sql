-- AI Dungeon Master — full schema for a fresh Supabase project.
-- Reconstructed from lib/db.ts types and query sites after the original
-- project was deleted. Run this once in the SQL Editor (or psql) of a new
-- project, then set NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY /
-- SUPABASE_SERVICE_ROLE_KEY and redeploy.
--
-- All app access goes through the service-role key on the server, which
-- bypasses RLS. RLS is enabled on every table with NO policies so the anon
-- key (exposed in the browser) can read nothing.

create table if not exists dm_campaigns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  title text not null,
  summary text,
  summary_through_message_id bigint,
  share_token text unique,
  time_minutes integer not null default 1080,
  day_count integer not null default 1,
  weather text not null default 'clear',
  story_arc jsonb,
  current_beat integer not null default 0,
  scenario text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists dm_campaigns_user_id_idx on dm_campaigns (user_id);

create table if not exists dm_messages (
  id bigint generated always as identity primary key,
  campaign_id uuid not null references dm_campaigns (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  scene jsonb,
  created_at timestamptz not null default now()
);
create index if not exists dm_messages_campaign_idx on dm_messages (campaign_id, id);

create table if not exists dm_characters (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references dm_campaigns (id) on delete cascade,
  name text not null,
  class text not null,
  hp integer not null,
  max_hp integer not null,
  attributes jsonb not null default '{}'::jsonb,
  inventory jsonb not null default '[]'::jsonb,
  skills jsonb not null default '[]'::jsonb,
  portrait_url text,
  portrait_hash text,
  backstory text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists dm_characters_campaign_idx on dm_characters (campaign_id);

create table if not exists dm_npcs (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references dm_campaigns (id) on delete cascade,
  name text not null,
  description text default '',
  attitude text not null default 'neutral'
    check (attitude in ('friendly', 'hostile', 'neutral', 'suspicious', 'allied', 'fearful')),
  relationship integer not null default 0,
  notes text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists dm_npcs_campaign_idx on dm_npcs (campaign_id);

create table if not exists dm_locations (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references dm_campaigns (id) on delete cascade,
  name text not null,
  description text default '',
  notes text,
  first_visited_at timestamptz not null default now(),
  last_visited_at timestamptz not null default now()
);
create index if not exists dm_locations_campaign_idx on dm_locations (campaign_id);

create table if not exists dm_lore (
  id bigint generated always as identity primary key,
  campaign_id uuid not null references dm_campaigns (id) on delete cascade,
  fact text not null,
  created_at timestamptz not null default now()
);
create index if not exists dm_lore_campaign_idx on dm_lore (campaign_id);

create table if not exists dm_statuses (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references dm_characters (id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('debuff', 'buff', 'condition', 'injury')),
  description text default '',
  expires_at_minutes integer,
  created_at timestamptz not null default now()
);
create index if not exists dm_statuses_character_idx on dm_statuses (character_id);

create table if not exists dm_encounters (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references dm_campaigns (id) on delete cascade,
  name text not null,
  description text,
  status text not null default 'active' check (status in ('active', 'resolved')),
  outcome text,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);
create index if not exists dm_encounters_campaign_idx on dm_encounters (campaign_id);

create table if not exists dm_enemies (
  id uuid primary key default gen_random_uuid(),
  encounter_id uuid not null references dm_encounters (id) on delete cascade,
  name text not null,
  description text,
  hp integer not null,
  max_hp integer not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists dm_enemies_encounter_idx on dm_enemies (encounter_id);

create table if not exists dm_quests (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references dm_campaigns (id) on delete cascade,
  name text not null,
  description text default '',
  status text not null default 'active'
    check (status in ('active', 'completed', 'failed', 'abandoned')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists dm_quests_campaign_idx on dm_quests (campaign_id);

-- Deny-by-default: RLS on, no policies. The service-role key bypasses RLS;
-- the anon key gets nothing.
alter table dm_campaigns enable row level security;
alter table dm_messages enable row level security;
alter table dm_characters enable row level security;
alter table dm_npcs enable row level security;
alter table dm_locations enable row level security;
alter table dm_lore enable row level security;
alter table dm_statuses enable row level security;
alter table dm_encounters enable row level security;
alter table dm_enemies enable row level security;
alter table dm_quests enable row level security;

-- Public storage buckets for cached scene art and character portraits.
insert into storage.buckets (id, name, public)
values ('scenes', 'scenes', true), ('portraits', 'portraits', true)
on conflict (id) do nothing;
