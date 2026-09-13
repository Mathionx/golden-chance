-- ============================================================================
-- GOLDEN CHANCE — BOOTSTRAP SEED
-- ============================================================================
-- There is no self-signup in this app on purpose (unknown Telegram users
-- must be denied access). That means the very first admin has to be
-- inserted by hand, once, directly in the database. Everyone after that
-- is added by the admin through the Admin dashboard.
--
-- HOW TO GET YOUR TELEGRAM USER ID:
--   Message @userinfobot (or @RawDataBot) on Telegram — it replies with
--   your numeric user id. That's the number that goes below.
--
-- Replace the placeholder values, then run this once in the Supabase SQL
-- editor (after running the migrations in supabase/migrations/).
-- ============================================================================

insert into public.members (telegram_user_id, display_name, role, is_active)
values (000000000, 'Replace Me (Admin)', 'admin', true)
on conflict (telegram_user_id) do nothing;

-- Draw schedule defaults: Sundays at 19:00 UTC, manual mode. Adjust freely
-- from the Admin dashboard later — this just gives V1 something sane to
-- start with.
insert into public.draw_settings (id, day_of_week, draw_time, timezone, mode)
values (1, 0, '19:00', 'UTC', 'manual')
on conflict (id) do nothing;

-- The first cycle and its first round. Replace the timestamp with your
-- real first draw date/time (UTC).
with new_cycle as (
  insert into public.cycles (cycle_number, status)
  values (1, 'active')
  returning id
)
insert into public.rounds (cycle_id, week_number, scheduled_at)
select id, 1, now() + interval '7 days'
from new_cycle;
