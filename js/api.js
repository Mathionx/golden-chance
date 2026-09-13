/**
 * api.js
 * ---------------------------------------------------------------
 * The seam between UI and backend. Every function here talks to
 * Supabase directly (PostgREST for reads/simple writes, RPC calls
 * for the business-critical operations) using the authenticated
 * client from supabaseClient.js. ui.js and draw.js should only ever
 * go through this file — never touch supabase-js directly — so the
 * "how do we talk to the backend" question stays answered in one place.
 *
 * AUTHORIZATION REMINDER:
 * Nothing in this file decides who is allowed to do what. Every
 * function just makes the request; Postgres Row Level Security
 * (supabase/migrations/0002_rls.sql) and the SECURITY DEFINER
 * functions (0003_functions.sql) are what actually accept or reject
 * it. If an admin-only call is attempted by a non-admin, Postgres
 * rejects it and we surface that as a normal error — there is no
 * client-side gate to bypass.
 * ---------------------------------------------------------------
 */

/** Normalizes a Supabase/Postgres error into a small, safe object for the UI. */
function normalizeError(error, fallbackMessage) {
  const raw = (error && error.message) || fallbackMessage || "Something went wrong.";
  // Our SQL functions raise messages like "NO_ELIGIBLE_MEMBERS: everyone has..."
  // Split on the first colon to get a stable machine-readable code when present.
  const match = /^([A-Z_]+):\s*(.*)$/.exec(raw);
  const code = match ? match[1] : error?.code || "UNKNOWN_ERROR";
  const message = match ? match[2] : raw;
  const normalized = new Error(message);
  normalized.code = code;
  console.error("[api]", code, raw);
  return normalized;
}

function db() {
  return SupabaseClientManager.get();
}

// ---------------------------------------------------------------
// Reads
// ---------------------------------------------------------------

/** The currently logged-in member. Populated by AuthSession.login(). */
async function getCurrentUser() {
  if (!AuthSession.currentMember) {
    throw new Error("Not logged in yet.");
  }
  return AuthSession.currentMember;
}

/** All members (RLS: any authenticated member may read the full list). */
async function getMembers() {
  const { data, error } = await db()
    .from("members")
    .select("id, display_name, role, is_active, created_at")
    .order("created_at", { ascending: true });
  if (error) throw normalizeError(error, "Couldn't load members.");
  return data;
}

/** Members not yet a winner in the active cycle. */
async function getEligibleMembers() {
  const { data, error } = await db().rpc("eligible_members");
  if (error) throw normalizeError(error, "Couldn't load eligible members.");
  return data;
}

/** Full winner history, most recent first, with member/round/cycle details joined in. */
async function getWinnerHistory() {
  const { data, error } = await db()
    .from("winners")
    .select(
      `
      id, selected_at, selection_method,
      cycle:cycles ( cycle_number ),
      round:rounds ( week_number ),
      member:members ( id, display_name )
      `
    )
    .order("selected_at", { ascending: false });
  if (error) throw normalizeError(error, "Couldn't load winner history.");

  // Flatten the embedded joins into the simple shape ui.js expects.
  return data.map((w) => ({
    id: w.id,
    cycleNumber: w.cycle?.cycle_number,
    weekNumber: w.round?.week_number,
    memberId: w.member?.id,
    memberName: w.member?.display_name,
    date: w.selected_at,
    selectionMethod: w.selection_method,
  }));
}

/**
 * Everything the Home/Member/Draw screens need about "where we are right
 * now": active cycle, current round, member counts, next draw time.
 * There's no single database view for this in V1 — it's a few small
 * queries composed here, which is simple enough at ~15 members and
 * one round in flight at a time.
 */
async function getCurrentRound() {
  const client = db();

  const { data: cycle, error: cycleErr } = await client
    .from("cycles")
    .select("id, cycle_number, status, started_at")
    .eq("status", "active")
    .maybeSingle();
  if (cycleErr) throw normalizeError(cycleErr, "Couldn't load the current cycle.");
  if (!cycle) {
    return { noActiveCycle: true };
  }

  const { data: round, error: roundErr } = await client
    .from("rounds")
    .select("id, week_number, status, scheduled_at, completed_at")
    .eq("cycle_id", cycle.id)
    .neq("status", "completed")
    .order("week_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (roundErr) throw normalizeError(roundErr, "Couldn't load the current round.");

  const { count: totalMembers, error: totalErr } = await client
    .from("members")
    .select("id", { count: "exact", head: true })
    .eq("is_active", true);
  if (totalErr) throw normalizeError(totalErr, "Couldn't count members.");

  const eligible = await getEligibleMembers();

  const { data: settings } = await client.from("draw_settings").select("mode").eq("id", 1).maybeSingle();

  return {
    cycleId: cycle.id,
    cycleNumber: cycle.cycle_number,
    roundId: round ? round.id : null,
    weekNumber: round ? round.week_number : null,
    status: round ? round.status : "no_round_scheduled",
    nextDrawAt: round ? round.scheduled_at : null,
    totalMembers: totalMembers ?? 0,
    eligibleCount: eligible.length,
    drawMode: settings?.mode || "manual",
  };
}

/** Convenience wrapper — see getCurrentRound(). */
async function getNextDraw() {
  const round = await getCurrentRound();
  return round.nextDrawAt || null;
}

async function getDrawSettings() {
  const { data, error } = await db().from("draw_settings").select("*").eq("id", 1).single();
  if (error) throw normalizeError(error, "Couldn't load draw settings.");
  return data;
}

// ---------------------------------------------------------------
// The draw — the only place a winner is decided (in Postgres, not here)
// ---------------------------------------------------------------

/**
 * Calls the start_draw() database function. The response, if successful,
 * IS the authoritative winner — there is no client-side randomness
 * anywhere in this path. See supabase/migrations/0003_functions.sql.
 */
async function startDraw() {
  const { data, error } = await db().rpc("start_draw");
  if (error) throw normalizeError(error, "Couldn't start the draw.");
  const result = Array.isArray(data) ? data[0] : data;
  return {
    roundId: result.round_id,
    weekNumber: result.week_number,
    memberId: result.member_id,
    memberName: result.display_name,
    selectedAt: result.selected_at,
  };
}

// ---------------------------------------------------------------
// Admin actions — all protected server-side by RLS / RPC checks,
// never by anything in this file or in ui.js.
// ---------------------------------------------------------------

async function adminAddMember(telegramUserId, displayName, role = "member") {
  const { data, error } = await db()
    .from("members")
    .insert({ telegram_user_id: telegramUserId, display_name: displayName, role })
    .select()
    .single();
  if (error) throw normalizeError(error, "Couldn't add member.");
  return data;
}

async function adminEditMember(id, updates) {
  const { data, error } = await db().from("members").update(updates).eq("id", id).select().single();
  if (error) throw normalizeError(error, "Couldn't update member.");
  return data;
}

/** Soft delete: members are deactivated, never hard-deleted (keeps winner history intact). */
async function adminDeactivateMember(id) {
  const { data, error } = await db()
    .from("members")
    .update({ is_active: false })
    .eq("id", id)
    .select()
    .single();
  if (error) throw normalizeError(error, "Couldn't deactivate member.");
  return data;
}

async function adminStartNewCycle(firstRoundAtIso) {
  const { data, error } = await db().rpc("admin_start_new_cycle", {
    p_first_round_at: firstRoundAtIso,
  });
  if (error) throw normalizeError(error, "Couldn't start a new cycle.");
  return Array.isArray(data) ? data[0] : data;
}

async function adminScheduleNextRound(scheduledAtIso) {
  const { data, error } = await db().rpc("admin_schedule_next_round", {
    p_scheduled_at: scheduledAtIso,
  });
  if (error) throw normalizeError(error, "Couldn't schedule the next round.");
  return Array.isArray(data) ? data[0] : data;
}

async function adminUpdateDrawSettings(newSettings) {
  const { data, error } = await db()
    .from("draw_settings")
    .update({ ...newSettings, updated_by: AuthSession.currentMember?.id })
    .eq("id", 1)
    .select()
    .single();
  if (error) throw normalizeError(error, "Couldn't update draw settings.");
  return data;
}

// ---------------------------------------------------------------
// Realtime — everyone watching the draw sees the same authoritative
// result, sourced from the database, not from any client's timer.
// ---------------------------------------------------------------

/**
 * Subscribes to round completions and new winner rows. Returns the
 * channel so the caller can unsubscribe (e.g. supabase.removeChannel).
 */
function subscribeToDrawUpdates({ onRoundUpdate, onWinnerInsert } = {}) {
  const channel = db()
    .channel("golden-chance-draw")
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "rounds" },
      (payload) => onRoundUpdate && onRoundUpdate(payload.new)
    )
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "winners" },
      (payload) => onWinnerInsert && onWinnerInsert(payload.new)
    )
    .subscribe();
  return channel;
}
