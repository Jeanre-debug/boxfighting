-- ============================================================
-- Box Fight Multiplayer Schema
-- ============================================================

-- ------------------------------------------------------------
-- Helper function: generate_lobby_code
-- Returns a random 4-character uppercase alphanumeric string,
-- excluding visually ambiguous characters: 0, O, I, 1
-- ------------------------------------------------------------
create or replace function generate_lobby_code()
returns text
language plpgsql
as $$
declare
  chars  text    := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result text    := '';
  i      integer;
begin
  for i in 1..4 loop
    result := result || substr(chars, floor(random() * length(chars) + 1)::integer, 1);
  end loop;
  return result;
end;
$$;

-- ============================================================
-- Tables
-- ============================================================

-- ------------------------------------------------------------
-- profiles
-- ------------------------------------------------------------
create table if not exists profiles (
  id         uuid        primary key references auth.users (id) on delete cascade,
  username   text        unique not null,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- lobbies
-- ------------------------------------------------------------
create table if not exists lobbies (
  id         uuid        primary key default gen_random_uuid(),
  code       text        unique not null,
  mode       text        not null default '1v1'
                           check (mode in ('1v1', '2v2')),
  host_id    uuid        references profiles (id) on delete set null,
  status     text        not null default 'waiting'
                           check (status in ('waiting', 'active', 'finished')),
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- lobby_members
-- ------------------------------------------------------------
create table if not exists lobby_members (
  id        uuid        primary key default gen_random_uuid(),
  lobby_id  uuid        not null references lobbies (id) on delete cascade,
  player_id uuid        not null references profiles (id) on delete cascade,
  team      smallint    not null default 0,
  ready     boolean     not null default false,
  joined_at timestamptz not null default now(),
  unique (lobby_id, player_id)
);

-- ============================================================
-- Row-Level Security
-- ============================================================

alter table profiles     enable row level security;
alter table lobbies      enable row level security;
alter table lobby_members enable row level security;

-- ------------------------------------------------------------
-- profiles policies
-- ------------------------------------------------------------
drop policy if exists "profiles: public select"  on profiles;
drop policy if exists "profiles: own insert"     on profiles;
drop policy if exists "profiles: own update"     on profiles;

create policy "profiles: public select"
  on profiles for select
  using (true);

create policy "profiles: own insert"
  on profiles for insert
  with check (id = auth.uid());

create policy "profiles: own update"
  on profiles for update
  using (id = auth.uid());

-- ------------------------------------------------------------
-- lobbies policies
-- ------------------------------------------------------------
drop policy if exists "lobbies: public select"  on lobbies;
drop policy if exists "lobbies: host insert"    on lobbies;
drop policy if exists "lobbies: host update"    on lobbies;
drop policy if exists "lobbies: host delete"    on lobbies;

create policy "lobbies: public select"
  on lobbies for select
  using (true);

create policy "lobbies: host insert"
  on lobbies for insert
  with check (host_id = auth.uid());

create policy "lobbies: host update"
  on lobbies for update
  using (host_id = auth.uid());

create policy "lobbies: host delete"
  on lobbies for delete
  using (host_id = auth.uid());

-- ------------------------------------------------------------
-- lobby_members policies
-- ------------------------------------------------------------
drop policy if exists "lobby_members: public select"  on lobby_members;
drop policy if exists "lobby_members: own insert"     on lobby_members;
drop policy if exists "lobby_members: own update"     on lobby_members;
drop policy if exists "lobby_members: own delete"     on lobby_members;

create policy "lobby_members: public select"
  on lobby_members for select
  using (true);

create policy "lobby_members: own insert"
  on lobby_members for insert
  with check (player_id = auth.uid());

create policy "lobby_members: own update"
  on lobby_members for update
  using (player_id = auth.uid());

create policy "lobby_members: own delete"
  on lobby_members for delete
  using (player_id = auth.uid());

-- ============================================================
-- Realtime
-- ============================================================
alter publication supabase_realtime add table lobby_members;
