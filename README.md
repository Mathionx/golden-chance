# Golden Chance

A private Telegram Mini App for a ~15-member weekly Ekub group. One eligible
member wins each week; once someone wins, they sit out until the next cycle.

This README is written for someone learning backend/security concepts
through this project, so it explains *why*, not just *how*.

---

## 1. Architecture, in one picture

```
Telegram client (Mini App webview)
        │
        │  Telegram.WebApp.initData (signed, opaque string)
        ▼
┌───────────────────────────┐
│  telegram-auth              │  ← the ONLY custom backend code
│  (Supabase Edge Function)   │     BOT_TOKEN, SERVICE_ROLE_KEY,
│                              │     JWT_SECRET live here, only here
└──────────────┬───────────────┘
               │  verified → mint a signed JWT
               ▼
┌───────────────────────────────────────────────────────────┐
│  Frontend (HTML/CSS/vanilla JS) talks DIRECTLY to Supabase │
│  using that JWT — no custom API server in between.         │
└──────────────┬──────────────────────────────────────────────┘
               │  every request carries the JWT
               ▼
┌───────────────────────────────────────────────────────────┐
│  Supabase Postgres                                          │
│   - Row Level Security decides what each request may touch  │
│   - start_draw() (SECURITY DEFINER) is the ONLY code path    │
│     that can ever create a winner row                       │
└───────────────────────────────────────────────────────────┘
```

Why so little custom backend code? Supabase's Postgres already gives you a
real authorization system (Row Level Security) and a real place to put
atomic, race-condition-safe logic (SQL functions with row locks). The only
thing Postgres *can't* do is verify a Telegram signature or hold a bot
token — so that's the one job left for custom backend code.

---

## 2. Repository layout

```
index.html                     app shell, screen containers, script tags
css/style.css                  design tokens + all component styles
js/
  config.js                    PUBLIC Supabase URL + anon key
  supabaseClient.js            builds the supabase-js client, attaches the
                                session JWT after login
  telegram.js                  TelegramBridge (theme/UI) + AuthSession
                                (the real login handshake)
  api.js                       every backend call the app makes, in one file
  draw.js                      draw *animation* — presentation only
  ui.js                        all DOM rendering, one function per screen
  state.js                     small UI-only state (active screen, etc)
  icons.js                     inline SVG icon library
  main.js                      bootstraps everything in the right order
supabase/
  migrations/0001_schema.sql   tables, constraints, indexes
  migrations/0002_rls.sql      Row Level Security policies
  migrations/0003_functions.sql business logic (start_draw, new cycle, ...)
  migrations/0004_cron_optional.sql  optional automatic-mode scheduling
  seed.sql                     bootstrap: first admin, first cycle
  functions/telegram-auth/     the one edge function
.env.example                   variable names + safe placeholders
.gitignore                     keeps .env out of version control
```

---

## 3. Database

Five tables. Read the comments in `supabase/migrations/0001_schema.sql` for
the full reasoning; the short version:

| Table | Purpose | Key constraint |
|---|---|---|
| `members` | known Telegram users allowed in | `telegram_user_id` unique |
| `cycles` | one rotation of the Ekub | only one `status='active'` row at a time (partial unique index) |
| `rounds` | one weekly draw slot | only one open (non-completed) round per cycle |
| `winners` | the authoritative history | `unique(round_id)` — one winner per round ever; `unique(cycle_id, member_id)` — no repeat winner in a cycle |
| `draw_settings` | schedule + mode | single row (`id=1` singleton) |

The two `unique` constraints on `winners` are doing the real work of two of
your core rules ("a member cannot win twice in a cycle", "a round cannot
have multiple winners") — they hold even if every line of application code
above them has a bug. That's the point of enforcing rules at the database
level instead of only in JavaScript.

A trigger (`prevent_illegal_round_updates`) makes completed rounds
immutable and makes sure a round can only become `completed` from inside
`start_draw()` — not from a plain `UPDATE`, not even by an admin.

---

## 4. Row Level Security — how authorization actually works

**The core problem:** Telegram tells us who someone is (after we verify
their signature). Supabase's database has no idea what Telegram is. We
need a bridge between "verified Telegram identity" and "what this request
is allowed to touch in Postgres."

**The bridge is a custom JWT.** Here's the full chain:

1. Frontend sends the raw `Telegram.WebApp.initData` string to the
   `telegram-auth` edge function. (Never `initDataUnsafe` — that's a
   client-built JS object, not a signed credential. Anyone could edit it
   in devtools. It's used only for cosmetic display, never for access
   control.)
2. The edge function recomputes Telegram's HMAC signature using `BOT_TOKEN`
   (server-side only) and compares it to the one Telegram sent. This is
   [Telegram's documented validation algorithm](https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app).
3. It also rejects `initData` older than 24 hours.
4. It looks up `telegram_user_id` in the `members` table using the
   **service role key** (bypasses RLS — safe here because this code never
   runs in a browser). Unknown or deactivated users are rejected outright.
   **There is no auto-registration** — an admin must add a member first.
5. It mints a JWT signed with `SUPABASE_JWT_SECRET` containing:
   - `sub` = the member's UUID (becomes `auth.uid()` in Postgres)
   - `role` = `"authenticated"` (the Postgres role PostgREST will assume)
   - `app_role` = `"member"` or `"admin"` (read by RLS policies)
6. The frontend uses that JWT as its Supabase session. Every request now
   carries a token whose claims **cannot be edited by the browser** without
   invalidating the signature — Postgres verifies the signature itself.

Every RLS policy that checks "is this an admin?" reads `app_role` from that
verified JWT (`auth.jwt() ->> 'app_role'`), never anything the client sent
in a request body. See `supabase/migrations/0002_rls.sql` for the full
policy set with inline explanations — including *why* the `winners` table
has no INSERT policy for anyone, admin included (only `start_draw()`, a
`SECURITY DEFINER` function, can write there).

---

## 5. The draw — how a winner is actually chosen

`start_draw()` (in `0003_functions.sql`) is the only path to a winner:

1. Re-checks `is_admin()` from the caller's verified JWT. This check is the
   real security boundary for this action (see the comment in the file for
   why).
2. Locks the active cycle row (`FOR UPDATE`) — a concurrent
   `admin_start_new_cycle()` call can't yank the cycle out from under an
   in-flight draw.
3. Locks the current open round (`FOR UPDATE`) — a second, concurrent
   `start_draw()` call (double-click, two admins, whatever) blocks here
   until the first transaction finishes, then correctly fails with
   "already completed" instead of drawing twice.
4. Picks one eligible member (`ORDER BY random() LIMIT 1`) — server-side,
   inside this transaction, never influenced by the frontend.
5. Inserts the winner row (protected further by the two `unique`
   constraints from section 3) and flips the round to `completed`.

The frontend (`draw.js`) calls this function, waits for the real result,
and *then* plays a cosmetic name-cycling animation that ends on whatever
name the backend actually returned. If the backend call fails (not admin,
no eligible members, round already drawn, etc), the animation never starts
— the real error is shown instead.

**Automatic mode:** `run_scheduled_draws()` does the same thing but is
triggered by `pg_cron` on a timer instead of a JWT-carrying request (see
`0004_cron_optional.sql`). It is not reachable from the frontend at all —
no grant to `anon`/`authenticated`.

---

## 6. Realtime

Everyone with the Draw screen (or Home) open subscribes to Postgres changes
on `rounds` (UPDATE) and `winners` (INSERT) via Supabase Realtime
(`api.js` → `subscribeToDrawUpdates`). When the admin completes a draw,
every connected client re-fetches and re-renders — the database row is the
source of truth, not any client's local timer or animation state.

---

## 7. Environment variables

See `.env.example` for the full list with comments. Summary:

| Variable | Secret? | Lives in |
|---|---|---|
| `BOT_TOKEN` | **Secret** | edge function env only |
| `SUPABASE_SERVICE_ROLE_KEY` | **Secret** | edge function env only |
| `SUPABASE_JWT_SECRET` | **Secret** | edge function env only |
| `SUPABASE_URL` | Public | edge function env **and** `js/config.js` |
| `SUPABASE_ANON_KEY` | Public | `js/config.js` only |
| `ALLOWED_ORIGIN` | Public (config) | edge function env only |

The frontend (`js/config.js`) never contains anything from the "secret"
row. If you ever see a bot token, service role key, or JWT secret in a
file under `js/` or `index.html`, that's a bug — stop and fix it before
deploying.

---

## 8. Local development / deployment

You'll need a Supabase project and a Telegram bot (via [@BotFather](https://t.me/BotFather)).

### 8.1 Database

```bash
# Using the Supabase CLI, from the project root:
supabase link --project-ref YOUR-PROJECT-REF
supabase db push               # runs everything in supabase/migrations/
```

Or paste each file in `supabase/migrations/`, in order, into the Supabase
Dashboard's SQL editor.

### 8.2 Bootstrap the first admin

There's no self-signup by design. Get your own numeric Telegram user ID by
messaging **@userinfobot** on Telegram, then edit and run `supabase/seed.sql`
in the SQL editor (replace the placeholder ID/name).

### 8.3 Deploy the edge function

```bash
supabase functions deploy telegram-auth
supabase secrets set --env-file .env   # after copying .env.example -> .env
                                        # and filling in real values
```

### 8.4 Configure the frontend

Edit `js/config.js` with your project's public URL, public anon key, and
the deployed function URL. These are safe to commit — they're meant to be
public (see section 7).

### 8.5 Register the Mini App

In @BotFather: `/newapp` (or edit an existing bot), point it at wherever
you're hosting the static frontend (GitHub Pages, Netlify, Vercel, etc —
it's plain HTML/CSS/JS, no build step).

### 8.6 (Optional) Automatic draw mode

Automatic mode needs `pg_cron`, which must be enabled from the Supabase
Dashboard (Database → Extensions) — this can't be done from a SQL
migration. Then run the `cron.schedule(...)` statement commented in
`supabase/migrations/0004_cron_optional.sql`. Manual mode works without
any of this.

---

## 9. Manual testing checklist

- [ ] Opening the hosted URL in a normal browser (not Telegram) shows the
      "must be opened from Telegram" error, not a broken or fake UI.
- [ ] Opening the Mini App from Telegram as a registered member logs in
      and shows Home/Member/Draw/History (no Admin tab).
- [ ] Opening it as a Telegram user who is **not** in `members` is denied
      with a clear message.
- [ ] Deactivating a member (Admin) immediately prevents their next login.
- [ ] The Admin tab only appears for `role='admin'` members.
- [ ] A non-admin calling `supabase.rpc('start_draw')` directly from the
      browser devtools console gets a `FORBIDDEN` error from Postgres —
      confirms the UI hiding the button isn't the real protection.
- [ ] Clicking "Start draw" twice quickly only records one winner (test by
      double-clicking fast, or by opening devtools and firing
      `startDraw()` twice concurrently).
- [ ] After a cycle's last eligible member wins, drawing again returns
      "no eligible members" instead of erroring or repeating a winner.
- [ ] A completed round cannot be modified — try
      `supabase.from('rounds').update({status:'scheduled'}).eq('id', ...)`
      from devtools on a completed round and confirm it's rejected.
- [ ] Two browser tabs open on the Draw screen both update the moment one
      admin completes a draw (Realtime check).
- [ ] `anon`-only requests (no session token) can't read any table — test
      with `curl` and just the anon key, no Authorization header.
- [ ] Starting a new cycle makes every member eligible again.

---

## 10. Security considerations (and what "secure" does *not* mean here)

- This design does not claim to be audited or attack-proof — you said
  you'd inspect and attack it, which is exactly the right next step.
- `initDataUnsafe` is never used for access control anywhere in this
  codebase — grep for it if you want to confirm.
- The frontend hiding the Admin tab for non-admins is UX, not security.
  The actual boundary is RLS + `is_admin()` checks inside SQL functions.
  Test this explicitly (see checklist above).
- `winners` has zero write policies for any role — the only way in is
  `start_draw()`'s elevated (`SECURITY DEFINER`) privileges. If you ever
  add a new way to write to `winners`, ask whether it should really bypass
  this restriction.
- JWTs are valid for 12 hours. A stolen token is usable until it expires;
  there's no server-side revocation list in V1 (see limitations below).
- Rate limiting is not implemented anywhere in V1 — Supabase's platform
  defaults apply, nothing custom.

---

## 11. Known V1 limitations

- **No JWT revocation.** If a member's role changes or they're
  deactivated, their *existing* token still works until it expires (up to
  12h) — only their *next* login is blocked. Fine for a trusted 15-person
  group; worth fixing before wider use.
- **No column-level RLS.** Admin `UPDATE` policies on `rounds`/`cycles`
  allow updating any column; the trigger stops the one dangerous case
  (illegally completing a round), but a more advanced setup would use
  column-level privileges for finer control.
- **Single timezone.** `draw_settings.timezone` exists but the whole app
  assumes one fixed schedule; no per-member timezone handling.
- **Automatic mode requires manual `pg_cron` setup** in the Supabase
  Dashboard — it can't be fully scripted from a migration.
- **No audit log.** We know *what* the current state is, not a full
  history of every admin action (only winner history is kept).
- **Ring visualization on Home is an approximation** — it shows *how many*
  members have won this cycle, not precisely *which* ones (the Member
  screen always has the exact answer for the logged-in member).
- **No automated test suite.** Given the emphasis on hand-verifying
  security properties, testing so far is manual (see checklist). Adding
  `pgTAP` tests for the RLS policies and `start_draw()` race conditions
  would be a good next step.
- **No pagination.** Fine at ~15 members and a few dozen winner rows;
  would need it at real scale.

---

## 12. Things that still need manual configuration

- Create the Supabase project itself.
- Create the Telegram bot via @BotFather and register the Mini App URL.
- Fill in real values in `.env` and deploy them as edge function secrets.
- Fill in real values in `js/config.js`.
- Run `supabase/seed.sql` with your real Telegram user ID to bootstrap
  the first admin.
- Host the static frontend somewhere (any static host works).
- Optionally enable `pg_cron` and run the schedule statement for
  automatic mode.
