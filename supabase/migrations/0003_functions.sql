-- ============================================================================
-- GOLDEN CHANCE — BUSINESS LOGIC FUNCTIONS
-- ============================================================================
-- Functions that matter:
--   eligible_members()      read-only helper, runs with caller's own RLS
--   _complete_round()       the ONE place that ever inserts a winner
--   start_draw()            public RPC: admin-triggered manual draw
--   run_scheduled_draws()   internal only: called by pg_cron for "automatic" mode
--   admin_start_new_cycle() atomically closes old cycle, opens next one
--   admin_schedule_next_round() creates the next round in the active cycle
--
-- Everything else (add/edit/deactivate a member, update settings) is a
-- plain table insert/update from the frontend, protected entirely by the
-- RLS policies in 0002_rls.sql — we only reach for a function when a
-- single request needs to become an atomic, row-locked transaction.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- eligible_members: SECURITY INVOKER (the default — no clause needed),
-- so it runs with the CALLER's permissions and normal RLS still applies.
-- It exists for reuse/readability, not to grant any extra access.
-- ----------------------------------------------------------------------------
create or replace function public.eligible_members()
returns setof public.members
language sql
stable
as $$
  select m.*
  from public.members m
  where m.is_active = true
    and not exists (
      select 1
      from public.winners w
      join public.cycles c on c.id = w.cycle_id
      where w.member_id = m.id
        and c.status = 'active'
    );
$$;

comment on function public.eligible_members is
  'Active members who have not yet won the current active cycle.';

-- ----------------------------------------------------------------------------
-- _complete_round: the single implementation of "pick a winner and record
-- it" shared by start_draw() (manual, admin-triggered) and
-- run_scheduled_draws() (automatic, cron-triggered). Not exposed to
-- PostgREST — it has no GRANT to anon/authenticated, so it can only ever
-- be called from inside another SECURITY DEFINER function in this file.
-- This is where the actual atomicity/locking lives.
-- ----------------------------------------------------------------------------
create or replace function public._complete_round(p_round_id uuid, p_method text)
returns table (
  round_id      uuid,
  week_number   int,
  member_id     uuid,
  display_name  text,
  selected_at   timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_round  public.rounds%rowtype;
  v_winner public.members%rowtype;
  v_now    timestamptz := now();
begin
  -- Lock the round row. If another transaction is already completing
  -- this exact round, this blocks here until that transaction finishes,
  -- then the status check below correctly rejects the second attempt.
  select * into v_round from public.rounds where id = p_round_id for update;

  if not found then
    raise exception 'ROUND_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_round.status = 'completed' then
    raise exception 'ROUND_ALREADY_COMPLETED: this round has already been drawn'
      using errcode = 'P0001';
  end if;

  -- Pick exactly one eligible member. ORDER BY random() is fine at this
  -- scale (~15 rows) and runs here, server-side, inside this transaction
  -- — never influenced by anything the frontend sends.
  select m.* into v_winner
    from public.eligible_members() m
    where not exists (
      select 1 from public.winners w
      where w.cycle_id = v_round.cycle_id and w.member_id = m.id
    )
    order by random()
    limit 1;

  if not found then
    raise exception 'NO_ELIGIBLE_MEMBERS: everyone has already won this cycle'
      using errcode = 'P0001';
  end if;

  -- Record the winner. If two transactions somehow both reached this
  -- line (they can't, because of the row lock above — kept as defense
  -- in depth), UNIQUE(round_id) / UNIQUE(cycle_id, member_id) on
  -- `winners` would reject the second insert outright.
  insert into public.winners (round_id, cycle_id, member_id, selection_method)
  values (v_round.id, v_round.cycle_id, v_winner.id, p_method);

  -- Flip the round to completed. The transaction-local flag is what the
  -- prevent_illegal_round_updates trigger (0001) checks for; it exists
  -- only for the lifetime of this transaction.
  perform set_config('app.internal_draw', 'true', true);
  update public.rounds set status = 'completed', completed_at = v_now
    where id = v_round.id;

  return query
    select v_round.id, v_round.week_number, v_winner.id, v_winner.display_name, v_now;
end;
$$;

revoke all on function public._complete_round(uuid, text) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- start_draw(): public RPC for a manual, admin-triggered draw.
--
-- SECURITY DEFINER is required because `winners` has no INSERT policy for
-- any role and `rounds` can't reach status='completed' except through the
-- flag _complete_round sets — this function's elevated privileges are
-- exactly what makes winner selection possible at all. That means the
-- authorization check below IS the real security boundary for this
-- action, not a nicety layered on top of RLS. Do not remove it.
-- ----------------------------------------------------------------------------
create or replace function public.start_draw()
returns table (
  round_id      uuid,
  week_number   int,
  member_id     uuid,
  display_name  text,
  selected_at   timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cycle  public.cycles%rowtype;
  v_round  public.rounds%rowtype;
  v_method text;
begin
  -- Authorization: re-check the caller's role from their verified JWT.
  -- This never trusts anything the client sent in the request body.
  if not public.is_admin() then
    raise exception 'FORBIDDEN: admin role required to start a draw'
      using errcode = '42501';
  end if;

  -- Lock the active cycle so it can't be closed out from under us by a
  -- concurrent admin_start_new_cycle() call mid-draw.
  select * into v_cycle from public.cycles where status = 'active' for update;
  if not found then
    raise exception 'NO_ACTIVE_CYCLE: start a cycle before drawing'
      using errcode = 'P0001';
  end if;

  select * into v_round
    from public.rounds
    where cycle_id = v_cycle.id and status <> 'completed'
    order by week_number desc
    limit 1;

  if not found then
    raise exception 'NO_OPEN_ROUND: no round is scheduled for the active cycle'
      using errcode = 'P0001';
  end if;

  select mode into v_method from public.draw_settings where id = 1;

  return query select * from public._complete_round(v_round.id, coalesce(v_method, 'manual'));
end;
$$;

revoke all on function public.start_draw() from public, anon;
grant execute on function public.start_draw() to authenticated;

-- ----------------------------------------------------------------------------
-- run_scheduled_draws(): for "automatic" mode. Intended to be invoked only
-- by pg_cron on a schedule (see 0004_cron.sql). It has no grant to
-- anon/authenticated, so it is unreachable from the frontend or PostgREST
-- — the only caller is the cron job, which runs outside any request
-- context (no JWT), so it checks draw_settings.mode instead of a caller role.
-- ----------------------------------------------------------------------------
create or replace function public.run_scheduled_draws()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mode text;
  v_due  record;
begin
  select mode into v_mode from public.draw_settings where id = 1;
  if v_mode is distinct from 'automatic' then
    return; -- automatic mode is off; nothing to do
  end if;

  for v_due in
    select r.id as round_id
    from public.rounds r
    join public.cycles c on c.id = r.cycle_id
    where c.status = 'active'
      and r.status <> 'completed'
      and r.scheduled_at <= now()
    order by r.scheduled_at
  loop
    begin
      perform public._complete_round(v_due.round_id, 'automatic');
    exception when others then
      -- Don't let one bad round abort the whole scheduled batch.
      raise notice 'run_scheduled_draws: failed to complete round %: %', v_due.round_id, sqlerrm;
    end;
  end loop;
end;
$$;

revoke all on function public.run_scheduled_draws() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- admin_start_new_cycle(): closes the active cycle (if any) and opens the
-- next one plus its first round. SECURITY INVOKER (default, no clause) —
-- the caller still needs the RLS-granted admin insert/update rights for
-- this to succeed, so RLS is an independent second check, not just the
-- is_admin() guard below.
-- ----------------------------------------------------------------------------
create or replace function public.admin_start_new_cycle(p_first_round_at timestamptz)
returns table (cycle_id uuid, cycle_number int, round_id uuid)
language plpgsql
as $$
declare
  v_old_cycle public.cycles%rowtype;
  v_new_cycle public.cycles%rowtype;
  v_new_round public.rounds%rowtype;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN: admin role required to start a new cycle'
      using errcode = '42501';
  end if;

  select * into v_old_cycle from public.cycles where status = 'active' for update;
  if found then
    update public.cycles
      set status = 'completed', completed_at = now()
      where id = v_old_cycle.id;
  end if;

  insert into public.cycles (cycle_number)
  values (coalesce((select max(cycle_number) from public.cycles), 0) + 1)
  returning * into v_new_cycle;

  insert into public.rounds (cycle_id, week_number, scheduled_at)
  values (v_new_cycle.id, 1, p_first_round_at)
  returning * into v_new_round;

  return query select v_new_cycle.id, v_new_cycle.cycle_number, v_new_round.id;
end;
$$;

revoke all on function public.admin_start_new_cycle(timestamptz) from public, anon;
grant execute on function public.admin_start_new_cycle(timestamptz) to authenticated;

-- ----------------------------------------------------------------------------
-- admin_schedule_next_round(): create the next round in the active cycle.
-- A plain INSERT would also work under RLS, but computing week_number
-- safely under concurrent admins is easier with a lock here.
-- ----------------------------------------------------------------------------
create or replace function public.admin_schedule_next_round(p_scheduled_at timestamptz)
returns table (round_id uuid, week_number int)
language plpgsql
as $$
declare
  v_cycle     public.cycles%rowtype;
  v_next_week int;
  v_round     public.rounds%rowtype;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN: admin role required to schedule a round'
      using errcode = '42501';
  end if;

  select * into v_cycle from public.cycles where status = 'active' for update;
  if not found then
    raise exception 'NO_ACTIVE_CYCLE: start a cycle first'
      using errcode = 'P0001';
  end if;

  select coalesce(max(week_number), 0) + 1 into v_next_week
    from public.rounds where cycle_id = v_cycle.id;

  insert into public.rounds (cycle_id, week_number, scheduled_at)
  values (v_cycle.id, v_next_week, p_scheduled_at)
  returning * into v_round;

  return query select v_round.id, v_round.week_number;
end;
$$;

revoke all on function public.admin_schedule_next_round(timestamptz) from public, anon;
grant execute on function public.admin_schedule_next_round(timestamptz) to authenticated;
