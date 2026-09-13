-- ============================================================================
-- GOLDEN CHANCE — V1 DATABASE SCHEMA
-- ============================================================================
-- This migration creates the core tables for a private, ~15-member Ekub
-- group. It is intentionally small: five tables, plain relationships,
-- and the important business rules enforced as real constraints rather
-- than "we'll remember to check that in the app" logic.
--
-- Run this in the Supabase SQL editor, or via the Supabase CLI:
--   supabase db push
-- ============================================================================

create extension if not exists "pgcrypto"; -- gives us gen_random_uuid()

-- ----------------------------------------------------------------------------
-- MEMBERS
-- ----------------------------------------------------------------------------
-- One row per known Telegram user allowed to use the app. Members are
-- added by the admin ONLY (see RLS below) — there is no self-signup.
-- `telegram_user_id` is the numeric Telegram ID from initData; it is the
-- link between "who Telegram says this is" and "who this is in our system".
create table public.members (
  id                 uuid primary key default gen_random_uuid(),
  telegram_user_id   bigint not null unique,
  display_name       text not null check (char_length(trim(display_name)) > 0),
  role               text not null default 'member' check (role in ('member', 'admin')),
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on table public.members is
  'Known Ekub participants. Membership is admin-managed; unknown Telegram users are denied login (see telegram-auth edge function).';
comment on column public.members.role is
  'Authorization role used by RLS policies and the start_draw() function. Never trust a role claimed by the client — this column, read server-side, is the source of truth.';

-- ----------------------------------------------------------------------------
-- CYCLES
-- ----------------------------------------------------------------------------
-- A cycle runs until every active member has won once. Only one cycle
-- may be 'active' at a time — enforced by the partial unique index below.
create table public.cycles (
  id             uuid primary key default gen_random_uuid(),
  cycle_number   int not null unique check (cycle_number > 0),
  status         text not null default 'active' check (status in ('active', 'completed')),
  started_at     timestamptz not null default now(),
  completed_at   timestamptz,
  created_at     timestamptz not null default now()
);

-- At most one row may have status = 'active' at any time.
create unique index one_active_cycle_idx on public.cycles ((true)) where status = 'active';

comment on table public.cycles is
  'A single rotation of the Ekub. Exactly one cycle is active at a time.';

-- ----------------------------------------------------------------------------
-- ROUNDS
-- ----------------------------------------------------------------------------
-- One row per weekly draw within a cycle. A round starts 'scheduled',
-- and becomes 'completed' the moment start_draw() records a winner for it.
-- Completed rounds are immutable (see trigger below) — there is no redraw.
create table public.rounds (
  id             uuid primary key default gen_random_uuid(),
  cycle_id       uuid not null references public.cycles(id) on delete restrict,
  week_number    int not null check (week_number > 0),
  status         text not null default 'scheduled' check (status in ('scheduled', 'drawing', 'completed')),
  scheduled_at   timestamptz not null,
  completed_at   timestamptz,
  created_at     timestamptz not null default now(),
  unique (cycle_id, week_number)
);

-- Only one open (non-completed) round per cycle at a time.
create unique index one_open_round_per_cycle_idx
  on public.rounds (cycle_id)
  where status <> 'completed';

create index rounds_scheduled_at_idx on public.rounds (scheduled_at);

comment on table public.rounds is
  'One weekly draw slot. status=completed is set exclusively by start_draw(); see trigger prevent_illegal_round_updates.';

-- ----------------------------------------------------------------------------
-- WINNERS
-- ----------------------------------------------------------------------------
-- The authoritative historical record. Two constraints do the heaviest
-- lifting in this whole schema:
--   * unique(round_id)        -> a round can have at most one winner ever.
--   * unique(cycle_id, member_id) -> a member cannot win twice in one cycle.
-- There is deliberately NO update/delete path for this table in the app.
create table public.winners (
  id                 uuid primary key default gen_random_uuid(),
  round_id           uuid not null unique references public.rounds(id) on delete restrict,
  cycle_id           uuid not null references public.cycles(id) on delete restrict,
  member_id          uuid not null references public.members(id) on delete restrict,
  selection_method   text not null default 'manual' check (selection_method in ('manual', 'automatic')),
  selected_at        timestamptz not null default now(),
  unique (cycle_id, member_id)
);

create index winners_member_id_idx on public.winners (member_id);
create index winners_cycle_id_idx on public.winners (cycle_id);

comment on table public.winners is
  'Authoritative winner history. Rows are inserted ONLY by the start_draw() function — see RLS notes in 0002_rls.sql.';

-- ----------------------------------------------------------------------------
-- DRAW SETTINGS
-- ----------------------------------------------------------------------------
-- A single-row settings table (the `id = 1` check enforces "singleton").
create table public.draw_settings (
  id            int primary key default 1 check (id = 1),
  day_of_week   int not null default 0 check (day_of_week between 0 and 6), -- 0 = Sunday
  draw_time     time not null default '19:00',
  timezone      text not null default 'UTC',
  mode          text not null default 'manual' check (mode in ('manual', 'automatic')),
  updated_at    timestamptz not null default now(),
  updated_by    uuid references public.members(id)
);

comment on table public.draw_settings is
  'Single-row weekly schedule + draw mode configuration. V1 keeps this deliberately simple (one fixed weekly slot, one timezone).';

-- ----------------------------------------------------------------------------
-- updated_at maintenance
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_members_updated_at
  before update on public.members
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- Round immutability + "only start_draw() may complete a round"
-- ----------------------------------------------------------------------------
-- This trigger is the enforcement behind two rules from the spec:
--   1. "A completed round cannot be redrawn"        -> blocks ANY update
--      once status = 'completed', full stop.
--   2. "The backend, not frontend JavaScript, must determine the winner"
--      -> blocks setting status = 'completed' unless the update comes
--      from inside start_draw(), which sets a transaction-local flag
--      immediately before making that exact change.
create or replace function public.prevent_illegal_round_updates()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'completed' then
    raise exception 'ROUND_IMMUTABLE: a completed round cannot be modified or redrawn'
      using errcode = 'P0001';
  end if;

  if new.status = 'completed'
     and coalesce(current_setting('app.internal_draw', true), '') <> 'true' then
    raise exception 'FORBIDDEN: rounds may only be completed via start_draw()'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger trg_prevent_illegal_round_updates
  before update on public.rounds
  for each row execute function public.prevent_illegal_round_updates();
