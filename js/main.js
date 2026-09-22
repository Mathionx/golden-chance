/**
 * main.js
 * ---------------------------------------------------------------
 * App bootstrap. Order matters here:
 *   1. TelegramBridge.init()   — UI/theme only, no auth decisions
 *   2. AuthSession.login()     — the real login handshake (see telegram.js)
 *   3. build nav + render Home — only after we know who's logged in
 *
 * If step 2 fails (not opened from Telegram, unknown member, expired
 * signature, etc), we stop and show a plain, honest error screen
 * instead of a broken app — there is no "guest mode" to fall back to,
 * because that would mean showing private Ekub data to someone we
 * couldn't verify.
 * ---------------------------------------------------------------
 */

const NAV_ITEMS = [
  { screen: "home", label: "Home", icon: ICONS.home },
  { screen: "member", label: "Me", icon: ICONS.member },
  { screen: "history", label: "History", icon: ICONS.history },
  { screen: "admin", label: "Admin", icon: ICONS.admin, adminOnly: true },
];

function initNav() {
  const nav = document.getElementById("bottom-nav");
  const items = NAV_ITEMS.filter((item) => !item.adminOnly || AuthSession.isAdmin());

  nav.innerHTML = items
    .map(
      (item, i) => `
      <button class="nav-btn${i === 0 ? " is-active" : ""}" data-screen="${item.screen}">
        ${item.icon}
        <span>${item.label}</span>
      </button>`
    )
    .join("");

  nav.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchScreen(btn.dataset.screen));
  });
}

function initEnvBadge() {
  const badge = document.getElementById("env-badge");
  if (!badge) return;
  if (TelegramBridge.isInTelegram) {
    badge.textContent = AuthSession.currentMember
      ? AuthSession.currentMember.display_name
      : "Running in Telegram";
    badge.classList.add("in-telegram");
  } else {
    badge.textContent = "Browser preview";
  }
}

/** Replaces the whole app shell with a plain, honest error state — no partial/broken UI. */
function renderFatalError(message) {
  document.querySelector(".app-shell").innerHTML = `
    <div class="fatal-error">
      <div class="fatal-error-icon">${ICONS.lock}</div>
      <h1>Can't open Golden Chance</h1>
      <p>${message}</p>
    </div>
  `;
}

/**
 * Live updates so everyone watching sees the same authoritative draw
 * result — the database row is the source of truth, never a client
 * timer. Two events matter:
 *   - rounds UPDATE to status='drawing': lets passive viewers start
 *     the wheel spinning before the winner is even known (suspense),
 *     without ever knowing or guessing the outcome themselves.
 *   - winners INSERT: the authoritative result. Every connected
 *     client (including the admin's own other tabs/devices) spins to
 *     the same segment because eligible_snapshot + member_id came
 *     straight from the database row, not from local computation.
 * AppState.isDrawingLocally guards against a client re-animating its
 * own already-in-progress draw when its own writes echo back.
 */
function initRealtime() {
  let lastAnimatedRoundId = null;

  subscribeToDrawUpdates({
    onRoundChange: (round, eventType) => {
      if (AppState.isDrawingLocally) return; // this client is the initiator; it's already animating

      if (eventType === "UPDATE" && round.status === "drawing" && AppState.activeScreen === "home") {
        playIndefiniteSpin();
        return;
      }
      if (["home", "member"].includes(AppState.activeScreen)) {
        switchScreen(AppState.activeScreen);
      }
    },
    onWinnerInsert: (winnerRow) => {
      if (winnerRow.round_id === lastAnimatedRoundId) return; // already handled
      lastAnimatedRoundId = winnerRow.round_id;

      if (AppState.isDrawingLocally) return; // the initiating client's own DrawController flow already handles this

      if (AppState.activeScreen === "home") {
        const segments = winnerRow.eligible_snapshot || [];
        const winnerSeg = segments.find((s) => s.id === winnerRow.member_id);
        playRemoteWheelReveal(segments, winnerRow.member_id, {
          memberName: winnerSeg ? winnerSeg.display_name : "Winner",
          weekNumber: AppState.currentWeekNumber,
        });
      } else if (["history", "member"].includes(AppState.activeScreen)) {
        switchScreen(AppState.activeScreen);
      }
    },
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  TelegramBridge.init();

  try {
    await AuthSession.login();
  } catch (err) {
    renderFatalError(err.message);
    return;
  }

  initEnvBadge();
  initNav();
  initRealtime();
  await switchScreen("home");
});
