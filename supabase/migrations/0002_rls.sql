-- ============================================================================
-- GOLDEN CHANCE — ROW LEVEL SECURITY
-- ============================================================================
-- HOW AUTHORIZATION ACTUALLY WORKS HERE (read this before editing policies):
--
-- Telegram auth and Supabase auth are two separate systems. We bridge them
-- like this:
--
--   1. The frontend sends Telegram's raw `initData` string to our
--      `telegram-auth` edge function (never trusted client-side).
--   2. The edge function verifies initData's HMAC signature using the bot
--      token (server-side only), then looks up the matching row in
--      `members` using the SERVICE ROLE key (server-side only, bypasses
--      RLS on purpose — this is the ONE place a service role is used).
--   3. If the member exists and is active, the edge function mints a JWT
--      signed with the project's JWT secret (also server-side only)
--      containing:
--          sub       = members.id            (so auth.uid() = member id)
--          role      = 'authenticated'       (the Postgres role PostgREST assumes)
--          app_role  = members.role          ('member' or 'admin')
--          telegram_id = the verified Telegram user id
--   4. The frontend uses that JWT as its Supabase session for every
--      subsequent request. PostgREST verifies the JWT's signature itself
--      (using the same secret) — the browser cannot forge or edit
--      `app_role` without invalidating the signature.
--
-- Every policy below reads `app_role` from that verified JWT via
-- auth.jwt() ->> 'app_role'. This is NOT the same as trusting a value the
-- browser sends in a request body — it is a claim inside a signed token
-- that only our backend can produce.
-- ============================================================================

alter table public.members       enable row level security;
alter table public.cycles        enable row level security;
alter table public.rounds        enable row level security;
alter table public.winners       enable row level security;
alter table public.draw_settings enable row level security;

-- Small helper so policies read cleanly and the "what counts as admin"
-- definition lives in exactly one place.
create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select coalesce(auth.jwt() ->> 'app_role', '') = 'admin';
$$;

-- ----------------------------------------------------------------------------
-- Base privileges
-- ----------------------------------------------------------------------------
-- `anon` gets nothing: an unauthenticated request (no valid Golden Chance
-- JWT) must not be able to read or write anything. This is what makes
-- "unknown Telegram users are denied access" actually true at the data
-- layer, not just in application logic.
revoke all on all tables in schema public from anon;

-- `authenticated` = holder of a JWT minted by our telegram-auth function.
-- Table-level grants are necessary but not sufficient — RLS policies below
-- still decide which *rows* are visible/writable.
grant select on public.members, public.cycles, public.rounds, public.winners, public.draw_settings
  to authenticated;
grant insert, update on public.members, public.cycles, public.rounds, public.draw_settings
  to authenticated;
-- Deliberately NOT granting insert/update/delete on `winners` to anyone.
-- The only way a row appears there is through start_draw(), a
-- SECURITY DEFINER function that bypasses grants/RLS for its own writes.

-- ----------------------------------------------------------------------------
-- MEMBERS
-- ----------------------------------------------------------------------------
-- Everyone in the (private, ~15 person) group can see the member list —
-- that's needed for the cycle ring, eligibility counts, and winner names.
create policy members_select_all
  on public.members for select
  to authenticated
  using (true);

-- Only admins may add/edit members. Both USING (which rows can be
-- targeted) and WITH CHECK (what the resulting row may look like) matter:
-- WITH CHECK stops a non-admin from, say, inserting a row and setting
-- role='admin' on themselves.
create policy members_admin_write
  on public.members for insert
  to authenticated
  with check (public.is_admin());

create policy members_admin_update
  on public.members for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- No delete policy: members are deactivated (is_active = false), never
-- hard-deleted, so winner history keeps a valid foreign key forever.

-- ----------------------------------------------------------------------------
-- CYCLES
-- ----------------------------------------------------------------------------
create policy cycles_select_all
  on public.cycles for select
  to authenticated
  using (true);

create policy cycles_admin_write
  on public.cycles for insert
  to authenticated
  with check (public.is_admin());

create policy cycles_admin_update
  on public.cycles for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ----------------------------------------------------------------------------
-- ROUNDS
-- ----------------------------------------------------------------------------
create policy rounds_select_all
  on public.rounds for select
  to authenticated
  using (true);

-- Admins may create rounds (schedule the next draw) and edit
-- non-completed rounds (e.g. reschedule). The trigger from 0001 is what
-- actually stops anyone — including admins — from setting status =
-- 'completed' through this path; RLS alone can't express "this column
-- may change but only to this specific value from this specific function".
create policy rounds_admin_write
  on public.rounds for insert
  to authenticated
  with check (public.is_admin());

create policy rounds_admin_update
  on public.rounds for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ----------------------------------------------------------------------------
-- WINNERS
-- ----------------------------------------------------------------------------
-- Everyone can read winner history.
create policy winners_select_all
  on public.winners for select
  to authenticated
  using (true);

-- No insert/update/delete policies exist for this table at all — for
-- ANY role, including admin. Combined with the missing GRANTs above,
-- that means the only code path that can ever create a winner row is
-- start_draw(), which runs as SECURITY DEFINER and therefore bypasses
-- both the grants and RLS for its own internal writes. This is what
-- makes "the backend determines the winner" a database-enforced fact
-- instead of a convention the app happens to follow.

-- ----------------------------------------------------------------------------
-- DRAW SETTINGS
-- ----------------------------------------------------------------------------
create policy draw_settings_select_all
  on public.draw_settings for select
  to authenticated
  using (true);

create policy draw_settings_admin_update
  on public.draw_settings for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());
