/**
 * ui.js
 * ---------------------------------------------------------------
 * All DOM rendering, screen by screen. Every render function reads
 * data through api.js (never supabase-js or AuthSession internals
 * directly) so the "how do we talk to the backend" question stays
 * answered in exactly one place.
 *
 * UX NOTE ON ADMIN GATING: this file hides the Admin nav tab and
 * disables admin actions in the UI for non-admins. That is a
 * convenience so people don't see controls they can't use — it is
 * NOT the security boundary. The real boundary is server-side (RLS
 * + the SECURITY DEFINER functions); a non-admin poking the API
 * directly from devtools would still be rejected by Postgres.
 * ---------------------------------------------------------------
 */

// ---------- small formatting helpers ----------

function initials(fullName) {
  return fullName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join("");
}

function formatLongDate(isoDate) {
  const d = new Date(isoDate);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatDrawDateTime(iso) {
  if (!iso) return "Not scheduled yet";
  const d = new Date(iso);
  const datePart = d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
  const timePart = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${datePart} \u00b7 ${timePart}`;
}

/** <input type="datetime-local"> works in local time with no timezone suffix; this converts that to a UTC ISO string for the backend. */
function localDateTimeInputToIso(value) {
  if (!value) return null;
  return new Date(value).toISOString();
}

function showToast(message, tone = "neutral") {
  let el = document.getElementById("gc-toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "gc-toast";
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.className = `toast toast-${tone} is-visible`;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.remove("is-visible"), 3200);
}

// ---------- navigation ----------

async function switchScreen(screenId) {
  if (screenId === "admin" && !AuthSession.isAdmin()) return; // convenience guard, not the real one

  AppState.activeScreen = screenId;

  document.querySelectorAll(".screen").forEach((el) => {
    el.classList.toggle("is-active", el.id === `screen-${screenId}`);
  });
  document.querySelectorAll(".nav-btn").forEach((el) => {
    el.classList.toggle("is-active", el.dataset.screen === screenId);
  });

  try {
    if (screenId === "home") await renderHome();
    if (screenId === "member") await renderMemberScreen();
    if (screenId === "draw") await renderDrawScreen();
    if (screenId === "history") await renderHistoryScreen();
    if (screenId === "admin") await renderAdminScreen();
  } catch (err) {
    console.error(err);
    showToast(err.message || "Something went wrong loading this screen.", "error");
  }
}

// ---------- HOME ----------

let countdownIntervalId = null;

async function renderHome() {
  const root = document.getElementById("screen-home");
  const [round, history] = await Promise.all([getCurrentRound(), getWinnerHistory()]);

  if (round.noActiveCycle) {
    root.innerHTML = buildNoActiveCycleCard();
    return;
  }

  const [members] = await Promise.all([getMembers()]);

  root.innerHTML = `
    <div class="home-grid">
      <div>
        <div class="cycle-hero">
          <div class="cycle-ring-wrap">
            ${buildCycleRingSvg(members, round)}
            <div class="cycle-ring-center">
              <div class="cycle-ring-week-label">Week</div>
              <div class="cycle-ring-week">${round.weekNumber ?? "—"}</div>
              <div class="cycle-ring-cycle">Cycle ${round.cycleNumber}</div>
            </div>
          </div>
          <div class="cycle-legend">
            <span><span class="legend-dot gold"></span>Eligible</span>
            <span><span class="legend-dot muted"></span>Already won</span>
          </div>
          ${buildStatusPill(round)}
        </div>

        <div class="stat-grid">
          <div class="stat-tile">
            <div class="stat-tile-value">${round.totalMembers}</div>
            <div class="stat-tile-label">Total members</div>
          </div>
          <div class="stat-tile">
            <div class="stat-tile-value">${round.eligibleCount}</div>
            <div class="stat-tile-label">Eligible this week</div>
          </div>
        </div>

        ${
          AuthSession.isAdmin()
            ? `<div class="card admin-cta-card">
                 <div class="card-row" style="border:none; padding:0;">
                   <div>
                     <strong>Organizer tools</strong>
                     <div class="profile-joined">You're signed in as the Ekub organizer.</div>
                   </div>
                 </div>
                 <button class="btn btn-primary btn-block" id="home-start-draw-btn" style="margin-top:14px;" ${
                   round.status === "scheduled" ? "" : "disabled"
                 }>
                   ${ICONS.sparkle} Start this week's draw
                 </button>
               </div>`
            : ""
        }
      </div>

      <div>
        <div class="card countdown-card">
          <div class="countdown-heading">${ICONS.clock} Next draw in</div>
          <div class="countdown-numbers" id="countdown-numbers">
            ${["Days", "Hrs", "Min", "Sec"]
              .map(
                (label) => `
              <div class="countdown-unit">
                <div class="countdown-unit-value" data-unit="${label.toLowerCase()}">00</div>
                <div class="countdown-unit-label">${label}</div>
              </div>`
              )
              .join("")}
          </div>
          <div class="countdown-date">${formatDrawDateTime(round.nextDrawAt)}</div>
        </div>

        ${buildRecentWinnerCard(history)}
      </div>
    </div>
  `;

  if (round.nextDrawAt) startCountdown(round.nextDrawAt);

  const homeStartBtn = document.getElementById("home-start-draw-btn");
  if (homeStartBtn) {
    homeStartBtn.addEventListener("click", () => switchScreen("draw"));
  }
}

function buildNoActiveCycleCard() {
  return `
    <div class="card">
      <p class="empty-state">
        There's no active Ekub cycle right now.
        ${AuthSession.isAdmin() ? "Start one from the Admin tab to begin drawing." : "Ask the organizer to start a new cycle."}
      </p>
    </div>
  `;
}

function buildStatusPill(round) {
  const map = {
    scheduled: { text: "Waiting for draw" },
    drawing: { text: "Draw in progress" },
    completed: { text: "Draw completed" },
    no_round_scheduled: { text: "No draw scheduled yet" },
  };
  const info = map[round.status] || map.scheduled;
  return `
    <div class="status-pill ${round.status}">
      <span class="pulse-dot"></span>
      ${info.text}
    </div>
  `;
}

function buildRecentWinnerCard(history) {
  if (!history.length) {
    return `<div class="card"><p class="empty-state">No winners recorded yet.</p></div>`;
  }
  const latest = history[0];
  return `
    <div class="winner-card">
      <div class="winner-card-eyebrow">Most recent winner \u00b7 Week ${latest.weekNumber}</div>
      <div class="winner-card-row">
        <div class="winner-avatar">${initials(latest.memberName)}</div>
        <div>
          <div class="winner-name">${latest.memberName}</div>
          <div class="winner-meta">${formatLongDate(latest.date)} \u00b7 Cycle ${latest.cycleNumber}</div>
        </div>
      </div>
    </div>
  `;
}

/** One dot per active member; gold = eligible, muted = already won this cycle. */
function buildCycleRingSvg(members, round) {
  const size = 210;
  const cx = size / 2;
  const cy = size / 2;
  const r = 88;
  const dotR = 7;
  const activeMembers = members.filter((m) => m.is_active);
  const n = activeMembers.length || 1;

  // We know the count of eligible members from `round`, but not *which*
  // members without another query. For the ring's visual purpose (show
  // overall progress through the cycle), we approximate by marking the
  // first (total - eligible) members as "already won" — good enough for
  // a glanceable progress ring. The exact per-member status is always
  // correct on the Member screen, which reads it directly.
  const wonCount = Math.max(0, activeMembers.length - round.eligibleCount);

  const dots = activeMembers
    .map((m, i) => {
      const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
      const x = cx + r * Math.cos(angle);
      const y = cy + r * Math.sin(angle);
      const cls = i < wonCount ? "dot-won" : "dot-eligible";
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${dotR}" class="${cls}"><title>${m.display_name}</title></circle>`;
    })
    .join("");

  return `
    <svg viewBox="0 0 ${size} ${size}" role="img" aria-label="Cycle progress: one dot per member">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--color-line)" stroke-width="1.5" />
      ${dots}
    </svg>
  `;
}

function startCountdown(nextDrawIso) {
  if (countdownIntervalId) clearInterval(countdownIntervalId);
  const target = new Date(nextDrawIso).getTime();

  const tick = () => {
    const diff = Math.max(0, target - Date.now());
    const days = Math.floor(diff / 86400000);
    const hours = Math.floor((diff % 86400000) / 3600000);
    const minutes = Math.floor((diff % 3600000) / 60000);
    const seconds = Math.floor((diff % 60000) / 1000);

    const set = (unit, value) => {
      const el = document.querySelector(`[data-unit="${unit}"]`);
      if (el) el.textContent = String(value).padStart(2, "0");
    };
    set("days", days);
    set("hrs", hours);
    set("min", minutes);
    set("sec", seconds);

    if (diff <= 0) clearInterval(countdownIntervalId);
  };

  tick();
  countdownIntervalId = setInterval(tick, 1000);
}

// ---------- MEMBER ----------

async function renderMemberScreen() {
  const root = document.getElementById("screen-member");
  const me = await getCurrentUser();
  const [round, history] = await Promise.all([getCurrentRound(), getWinnerHistory()]);

  // eligible_members() requires an active cycle; skip the call entirely
  // rather than treating a expected "no cycle" state as an error.
  const eligible = round.noActiveCycle ? [] : await getEligibleMembers();

  const isEligible = round.noActiveCycle ? false : eligible.some((m) => m.id === me.id);
  const myWins = history.filter((h) => h.memberId === me.id);
  const firstName = me.display_name.split(" ")[0];

  root.innerHTML = `
    <div class="card">
      <div class="profile-header">
        <div class="profile-avatar">${initials(me.display_name)}</div>
        <div>
          <div class="profile-name">${me.display_name}</div>
          <div class="profile-joined">${me.role === "admin" ? "Ekub organizer" : "Ekub member"}</div>
        </div>
        ${
          round.noActiveCycle
            ? ""
            : isEligible
            ? `<span class="badge badge-eligible" style="margin-left:auto;">${ICONS.check} Eligible</span>`
            : `<span class="badge badge-ineligible" style="margin-left:auto;">${ICONS.lock} Ineligible</span>`
        }
      </div>

      ${
        round.noActiveCycle
          ? `<div class="eligible-note">${ICONS.check}<span>No active cycle right now. Check back once the organizer starts one.</span></div>`
          : isEligible
          ? `<div class="eligible-note">${ICONS.check}<span>Still eligible this cycle — ${firstName} can win in any upcoming weekly draw until they win once.</span></div>`
          : `<div class="ineligible-note">${ICONS.alert}<span><strong>Already won this cycle.</strong> ${firstName} sits out of the draw until the next cycle begins.</span></div>`
      }
    </div>

    ${
      round.noActiveCycle
        ? ""
        : `
    <h2 class="admin-section-title" style="font-size:15px;">Current cycle</h2>
    <div class="card">
      <div class="card-row"><span>Cycle</span><strong>${round.cycleNumber}</strong></div>
      <div class="card-row"><span>Week</span><strong>${round.weekNumber ?? "—"}</strong></div>
      <div class="card-row"><span>Total members</span><strong>${round.totalMembers}</strong></div>
      <div class="card-row"><span>Next draw</span><strong>${formatDrawDateTime(round.nextDrawAt)}</strong></div>
    </div>`
    }

    <h2 class="admin-section-title" style="font-size:15px;">${firstName}'s winner history</h2>
    <div class="card">
      ${
        myWins.length
          ? myWins
              .map(
                (w) => `
            <div class="card-row">
              <span>Week ${w.weekNumber}, Cycle ${w.cycleNumber}</span>
              <strong>${formatLongDate(w.date)}</strong>
            </div>`
              )
              .join("")
          : `<p class="empty-state">No wins yet — good things come to those who wait.</p>`
      }
    </div>
  `;
}

// ---------- DRAW ----------

async function renderDrawScreen() {
  const root = document.getElementById("screen-draw");
  const round = await getCurrentRound();

  if (round.noActiveCycle) {
    root.innerHTML = buildNoActiveCycleCard();
    return;
  }
  if (round.status === "no_round_scheduled") {
    root.innerHTML = `<div class="card"><p class="empty-state">No round is scheduled yet.${
      AuthSession.isAdmin() ? " Schedule one from the Admin tab." : " Ask the organizer to schedule the next draw."
    }</p></div>`;
    return;
  }

  const eligible = await getEligibleMembers();
  const canDraw = AuthSession.isAdmin() && round.status === "scheduled" && eligible.length > 0;

  root.innerHTML = `
    <div class="draw-stage">
      <div class="draw-stage-heading">Week ${round.weekNumber} draw \u00b7 Cycle ${round.cycleNumber} \u00b7 ${eligible.length} eligible</div>

      <div class="draw-name-window is-idle" id="draw-window">
        <div class="draw-name-track" id="draw-track">
          <div class="draw-name-item is-current" id="draw-name-current">
            ${eligible.length ? "Ready when you are" : "No eligible members remain"}
          </div>
        </div>
      </div>

      <div class="draw-progress-label" id="draw-progress"></div>

      <div class="draw-actions" id="draw-actions">
        ${buildDrawActionArea({ canDraw, eligibleCount: eligible.length, isAdmin: AuthSession.isAdmin() })}
      </div>

      <p class="draw-fineprint">
        The winner is selected and permanently recorded by the <code>start_draw()</code> database
        function the moment the organizer presses the button. This animation only presents that
        already-decided result — it never decides it.
      </p>
    </div>
  `;

  const startBtn = document.getElementById("start-draw-btn");
  if (startBtn) {
    startBtn.addEventListener("click", () => beginDrawAnimation(eligible.map((m) => m.display_name)));
  }
}

function buildDrawActionArea({ canDraw, eligibleCount, isAdmin }) {
  if (!isAdmin) {
    return `<p class="empty-state">Only the organizer can start the draw. You'll see the result here the moment it happens.</p>`;
  }
  if (eligibleCount === 0) {
    return `<p class="empty-state">Everyone has already won this cycle. Start a new cycle from Admin to continue.</p>`;
  }
  return `<button class="btn btn-primary btn-block" id="start-draw-btn" ${canDraw ? "" : "disabled"}>${
    ICONS.sparkle
  } Start this week's draw</button>`;
}

function beginDrawAnimation(eligibleNames) {
  const startBtn = document.getElementById("start-draw-btn");
  const windowEl = document.getElementById("draw-window");
  const nameEl = document.getElementById("draw-name-current");
  const progressEl = document.getElementById("draw-progress");
  const actionsEl = document.getElementById("draw-actions");

  startBtn.disabled = true; // immediate, prevents double-click before the network round trip even starts
  startBtn.textContent = "Drawing…";
  windowEl.classList.remove("is-idle");

  DrawController.run({
    eligibleNames,
    onTick: (name) => {
      nameEl.textContent = name;
    },
    onProgress: (msg) => {
      progressEl.textContent = msg;
    },
    onError: (err) => {
      windowEl.classList.remove("is-idle");
      progressEl.textContent = "";
      actionsEl.innerHTML = `<p class="empty-state">${err.message}</p>
        <button class="btn btn-outline btn-block" id="draw-retry-btn">Back</button>`;
      document.getElementById("draw-retry-btn").addEventListener("click", () => renderDrawScreen());
    },
    onDone: (result) => {
      windowEl.classList.add("is-revealed");
      progressEl.textContent = "This week's winner:";
      actionsEl.innerHTML = `
        <div class="winner-card" style="margin-top:0;">
          <div class="winner-card-eyebrow">Recorded and final \u00b7 Week ${result.weekNumber}</div>
          <div class="winner-card-row">
            <div class="winner-avatar">${initials(result.memberName)}</div>
            <div><div class="winner-name">${result.memberName}</div></div>
          </div>
        </div>
        <button class="btn btn-outline btn-block" id="draw-done-btn" style="margin-top:12px;">Back to dashboard</button>
      `;
      document.getElementById("draw-done-btn").addEventListener("click", () => switchScreen("home"));
    },
  });
}

// ---------- HISTORY ----------

async function renderHistoryScreen() {
  const history = await getWinnerHistory();
  const root = document.getElementById("screen-history");

  if (!history.length) {
    root.innerHTML = `<div class="card"><p class="empty-state">No draws have happened yet.</p></div>`;
    return;
  }

  let lastCycle = null;
  const rows = history
    .map((w) => {
      let divider = "";
      if (w.cycleNumber !== lastCycle) {
        divider = `<div class="cycle-divider">Cycle ${w.cycleNumber}</div>`;
        lastCycle = w.cycleNumber;
      }
      return `
        ${divider}
        <div class="history-item">
          <div class="history-week">W${w.weekNumber}</div>
          <div class="history-info">
            <div class="history-name">${w.memberName}</div>
            <div class="history-date">${formatLongDate(w.date)}</div>
          </div>
        </div>
      `;
    })
    .join("");

  root.innerHTML = `<div class="card">${rows}</div>`;
}

// ---------- ADMIN ----------
// Every write in this screen can fail with a 403 from Postgres if the
// signed-in user somehow isn't actually an admin (e.g. their role was
// changed mid-session) — see the try/catch in wireAdminEvents. The nav
// tab is hidden for non-admins as a convenience; this is the backstop.

async function renderAdminScreen() {
  const root = document.getElementById("screen-admin");
  const [members, round, settings] = await Promise.all([getMembers(), getCurrentRound(), getDrawSettings()]);

  root.innerHTML = `
    <div class="admin-warning">
      ${ICONS.alert}
      <span>Admin actions are enforced by the database (Row Level Security + server-side checks), not by this screen.
      Hiding this tab from other members is a convenience, not the security control.</span>
    </div>

    <h2 class="admin-section-title">Draw control</h2>
    <div class="card">
      <div class="form-grid">
        <div class="form-field">
          <label>Draw mode</label>
          <div class="segmented" id="mode-segmented">
            <button type="button" data-mode="manual" class="${settings.mode === "manual" ? "is-active" : ""}">Manual</button>
            <button type="button" data-mode="automatic" class="${settings.mode === "automatic" ? "is-active" : ""}">Automatic</button>
          </div>
        </div>
        <div class="form-field">
          <label for="schedule-day">Draw day</label>
          <select id="schedule-day" class="select-field">
            ${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
              .map((d, i) => `<option value="${i}" ${i === settings.day_of_week ? "selected" : ""}>${d}</option>`)
              .join("")}
          </select>
        </div>
        <div class="form-field">
          <label for="schedule-time">Draw time (${settings.timezone})</label>
          <input type="time" id="schedule-time" class="text-field" value="${settings.draw_time?.slice(0, 5) || "19:00"}" />
        </div>
        <button class="btn btn-outline btn-block" id="save-schedule-btn">Save schedule</button>
        ${
          settings.mode === "automatic"
            ? `<p class="profile-joined">Automatic mode requires the optional pg_cron job — see README. Without it, draws still need a manual press.</p>`
            : ""
        }
      </div>
    </div>

    <div class="card" style="margin-top:12px;">
      ${
        round.noActiveCycle
          ? `<p class="profile-joined">No active cycle.</p>`
          : `<div class="card-row" style="border:none; padding:0;">
              <div>
                <strong>Cycle ${round.cycleNumber}${round.weekNumber ? `, Week ${round.weekNumber}` : ""}</strong>
                <div class="profile-joined">Everyone becomes eligible again in a new cycle.</div>
              </div>
            </div>`
      }
      ${
        !round.noActiveCycle && round.status === "no_round_scheduled"
          ? `
        <div class="form-field" style="margin-top:14px;">
          <label for="next-round-at">Schedule next draw</label>
          <input type="datetime-local" id="next-round-at" class="text-field" />
        </div>
        <button class="btn btn-primary btn-block" id="schedule-round-btn">Schedule round</button>
      `
          : ""
      }
      <div class="form-field" style="margin-top:14px;">
        <label for="new-cycle-first-round-at">First draw date for a new cycle</label>
        <input type="datetime-local" id="new-cycle-first-round-at" class="text-field" />
      </div>
      <button class="btn btn-terracotta btn-block" id="new-cycle-btn">Start a new cycle</button>
    </div>

    <h2 class="admin-section-title">Members (${members.length})</h2>
    <div class="card">
      <div class="form-grid" style="margin-bottom: 14px;">
        <input type="number" id="new-member-telegram-id" class="text-field" placeholder="Telegram user ID (numeric)" />
        <input type="text" id="new-member-name" class="text-field" placeholder="Display name" />
        <select id="new-member-role" class="select-field">
          <option value="member" selected>Member</option>
          <option value="admin">Admin</option>
        </select>
        <button class="btn btn-primary btn-block" id="add-member-btn">${ICONS.plus} Add member</button>
      </div>
      <div id="admin-members-list">
        ${members.map((m) => buildAdminMemberRow(m)).join("")}
      </div>
    </div>

    <h2 class="admin-section-title">Winner history</h2>
    <div class="card" id="admin-history-list"></div>

    <div class="modal-backdrop" id="edit-modal-backdrop">
      <div class="modal-sheet">
        <div class="modal-sheet-title">Edit member</div>
        <div class="form-grid">
          <div class="form-field">
            <label for="edit-member-name">Name</label>
            <input type="text" id="edit-member-name" class="text-field" />
          </div>
          <div class="form-field">
            <label for="edit-member-role">Role</label>
            <select id="edit-member-role" class="select-field">
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <label style="display:flex; align-items:center; gap:8px; font-size:13.5px; margin-top:4px;">
            <input type="checkbox" id="edit-member-active" />
            Active (unchecking deactivates — they keep their history but can no longer log in or be drawn)
          </label>
        </div>
        <div class="modal-actions">
          <button class="btn btn-outline" id="edit-cancel-btn">Cancel</button>
          <button class="btn btn-primary" id="edit-save-btn">Save changes</button>
        </div>
      </div>
    </div>
  `;

  const history = await getWinnerHistory();
  document.getElementById("admin-history-list").innerHTML = history.length
    ? history
        .slice(0, 8)
        .map(
          (w) => `
        <div class="history-item">
          <div class="history-week">W${w.weekNumber}</div>
          <div class="history-info">
            <div class="history-name">${w.memberName}</div>
            <div class="history-date">${formatLongDate(w.date)} \u00b7 Cycle ${w.cycleNumber}</div>
          </div>
        </div>`
        )
        .join("")
    : `<p class="empty-state">No draws recorded yet.</p>`;

  wireAdminEvents();
}

function buildAdminMemberRow(member) {
  return `
    <div class="member-row" data-id="${member.id}">
      <div class="member-row-avatar">${initials(member.display_name)}</div>
      <div>
        <div class="member-row-name">${member.display_name}${member.role === "admin" ? " \u00b7 Admin" : ""}</div>
        <div class="member-row-meta">${member.is_active ? "Active" : "Deactivated"}</div>
      </div>
      <span class="badge ${member.is_active ? "badge-eligible" : "badge-ineligible"}" style="margin-left:auto;">
        ${member.is_active ? "Active" : "Inactive"}
      </span>
      <div class="member-row-actions">
        <button class="icon-btn" data-action="edit" title="Edit member">${ICONS.pencil}</button>
        ${
          member.is_active
            ? `<button class="icon-btn danger" data-action="deactivate" title="Deactivate member">${ICONS.trash}</button>`
            : ""
        }
      </div>
    </div>
  `;
}

/** Wraps an admin action so a server-side rejection shows a clean message instead of an unhandled error. */
async function runAdminAction(fn, successMessage) {
  try {
    await fn();
    if (successMessage) showToast(successMessage, "success");
    return true;
  } catch (err) {
    showToast(err.message || "That action wasn't allowed.", "error");
    return false;
  }
}

function wireAdminEvents() {
  document.querySelectorAll("#mode-segmented button").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const ok = await runAdminAction(() => adminUpdateDrawSettings({ mode: btn.dataset.mode }));
      if (ok) renderAdminScreen();
    });
  });

  document.getElementById("save-schedule-btn").addEventListener("click", async () => {
    const day_of_week = Number(document.getElementById("schedule-day").value);
    const draw_time = document.getElementById("schedule-time").value;
    const ok = await runAdminAction(
      () => adminUpdateDrawSettings({ day_of_week, draw_time }),
      "Schedule saved."
    );
    if (ok) renderAdminScreen();
  });

  const scheduleRoundBtn = document.getElementById("schedule-round-btn");
  if (scheduleRoundBtn) {
    scheduleRoundBtn.addEventListener("click", async () => {
      const iso = localDateTimeInputToIso(document.getElementById("next-round-at").value);
      if (!iso) return showToast("Pick a date and time first.", "error");
      const ok = await runAdminAction(() => adminScheduleNextRound(iso), "Next round scheduled.");
      if (ok) { renderAdminScreen(); }
    });
  }

  document.getElementById("new-cycle-btn").addEventListener("click", async () => {
    const iso = localDateTimeInputToIso(document.getElementById("new-cycle-first-round-at").value);
    if (!iso) return showToast("Pick a first draw date first.", "error");
    if (!confirm("Start a new cycle? Every member becomes eligible again.")) return;
    const ok = await runAdminAction(() => adminStartNewCycle(iso), "New cycle started.");
    if (ok) renderAdminScreen();
  });

  document.getElementById("add-member-btn").addEventListener("click", async () => {
    const idInput = document.getElementById("new-member-telegram-id");
    const nameInput = document.getElementById("new-member-name");
    const roleSelect = document.getElementById("new-member-role");
    const telegramId = Number(idInput.value);
    const name = nameInput.value.trim();
    if (!telegramId || !name) return showToast("Telegram ID and name are both required.", "error");
    const ok = await runAdminAction(
      () => adminAddMember(telegramId, name, roleSelect.value),
      "Member added."
    );
    if (ok) renderAdminScreen();
  });

  document.querySelectorAll('#admin-members-list [data-action="deactivate"]').forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const id = e.target.closest(".member-row").dataset.id;
      if (!confirm("Deactivate this member? They'll keep their history but can no longer log in or be drawn.")) return;
      const ok = await runAdminAction(() => adminDeactivateMember(id), "Member deactivated.");
      if (ok) renderAdminScreen();
    });
  });

  document.querySelectorAll('#admin-members-list [data-action="edit"]').forEach((btn) => {
    btn.addEventListener("click", (e) => openEditModal(e.target.closest(".member-row").dataset.id));
  });

  document.getElementById("edit-cancel-btn").addEventListener("click", closeEditModal);

  const backdrop = document.getElementById("edit-modal-backdrop");
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) closeEditModal();
  });
}

let editingMemberId = null;

async function openEditModal(id) {
  const members = await getMembers();
  const member = members.find((m) => m.id === id);
  if (!member) return;
  editingMemberId = id;
  document.getElementById("edit-member-name").value = member.display_name;
  document.getElementById("edit-member-role").value = member.role;
  document.getElementById("edit-member-active").checked = member.is_active;
  document.getElementById("edit-modal-backdrop").classList.add("is-open");

  document.getElementById("edit-save-btn").onclick = async () => {
    const display_name = document.getElementById("edit-member-name").value.trim();
    const role = document.getElementById("edit-member-role").value;
    const is_active = document.getElementById("edit-member-active").checked;
    if (!display_name) return showToast("Name can't be empty.", "error");
    const ok = await runAdminAction(
      () => adminEditMember(editingMemberId, { display_name, role, is_active }),
      "Member updated."
    );
    if (ok) {
      closeEditModal();
      renderAdminScreen();
    }
  };
}

function closeEditModal() {
  document.getElementById("edit-modal-backdrop").classList.remove("is-open");
  editingMemberId = null;
}
