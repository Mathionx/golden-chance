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
  { screen: "draw", label: "Draw", icon: ICONS.draw },
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

/** Live updates so everyone watching sees the same authoritative draw result. */
function initRealtime() {
  subscribeToDrawUpdates({
    onRoundUpdate: () => {
      if (["home", "draw", "member"].includes(AppState.activeScreen)) {
        switchScreen(AppState.activeScreen);
      }
    },
    onWinnerInsert: () => {
      if (["home", "history", "member"].includes(AppState.activeScreen)) {
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
