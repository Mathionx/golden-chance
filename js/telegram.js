/**
 * telegram.js
 * ---------------------------------------------------------------
 * Two responsibilities:
 *   1. TelegramBridge — UI-only Telegram Mini App integration
 *      (theme sync, expand/ready, detecting whether we're actually
 *      running inside Telegram).
 *   2. AuthSession — the real login handshake. This is the frontend
 *      half of the flow described in supabase/functions/telegram-auth:
 *      send Telegram's raw initData to our backend, receive a signed
 *      session JWT back, use that JWT for every Supabase request.
 *
 * SECURITY NOTE (read this before changing anything here):
 * Telegram.WebApp.initDataUnsafe is a parsed, convenient, and
 * COMPLETELY UNTRUSTED object — it is built client-side from data
 * the browser holds and can be edited by anything running in that
 * browser (a malicious script, a modified client, etc). We use it
 * ONLY for cosmetic purposes (e.g. showing a name before login
 * completes). Every access-control decision in this app is based on
 * the *verified* result of sending Telegram.WebApp.initData (the raw
 * signed string) to the backend and getting a signed JWT back — never
 * on initDataUnsafe directly.
 * ---------------------------------------------------------------
 */

const TelegramBridge = {
  isInTelegram: false,
  displayName: null, // cosmetic only, see note above

  init() {
    const tg = window.Telegram && window.Telegram.WebApp;
    if (!tg) {
      this.isInTelegram = false;
      return;
    }

    this.isInTelegram = true;
    tg.ready();
    tg.expand();
    this._applyTheme(tg);
    tg.onEvent && tg.onEvent("themeChanged", () => this._applyTheme(tg));

    const unsafeUser = tg.initDataUnsafe && tg.initDataUnsafe.user;
    if (unsafeUser) {
      this.displayName = [unsafeUser.first_name, unsafeUser.last_name].filter(Boolean).join(" ");
    }

    tg.setHeaderColor && tg.setHeaderColor("secondary_bg_color");
  },

  /** Maps Telegram's theme params onto our own CSS variables, light or dark. */
  _applyTheme(tg) {
    const root = document.documentElement;
    const params = tg.themeParams || {};
    const map = {
      "--tg-bg": params.bg_color,
      "--tg-text": params.text_color,
      "--tg-hint": params.hint_color,
      "--tg-link": params.link_color,
      "--tg-button": params.button_color,
      "--tg-button-text": params.button_text_color,
      "--tg-secondary-bg": params.secondary_bg_color,
    };
    Object.entries(map).forEach(([cssVar, value]) => {
      if (value) root.style.setProperty(cssVar, value);
    });
    root.dataset.tgColorScheme = tg.colorScheme || "light";
  },

  /** Raw, signed initData string — the only thing safe to send to the backend. */
  getInitData() {
    const tg = window.Telegram && window.Telegram.WebApp;
    return tg ? tg.initData : "";
  },
};

/**
 * AuthSession — the login handshake and session lifecycle.
 */
const AuthSession = {
  currentMember: null, // { id, display_name, role } once logged in
  _expiresAt: 0,
  _refreshTimer: null,

  /**
   * Sends Telegram's raw initData to the telegram-auth edge function.
   * Throws an Error with a `.code` matching the backend's error string
   * (see supabase/functions/telegram-auth/index.ts) so the UI can show
   * a specific, friendly message.
   */
  async login() {
    const initData = TelegramBridge.getInitData();
    if (!initData) {
      const err = new Error("This app must be opened from Telegram.");
      err.code = "not_in_telegram";
      throw err;
    }

    let response;
    try {
      response = await fetch(GoldenChanceConfig.TELEGRAM_AUTH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData }),
      });
    } catch (networkErr) {
      const err = new Error("Couldn't reach the server. Check your connection and try again.");
      err.code = "network_error";
      throw err;
    }

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      const err = new Error(this._friendlyMessage(payload.error));
      err.code = payload.error || "unknown_error";
      throw err;
    }

    this.currentMember = payload.member;
    this._expiresAt = Date.now() + payload.expires_in * 1000;
    SupabaseClientManager.setSessionToken(payload.token);
    this._scheduleRefresh(payload.expires_in);

    return this.currentMember;
  },

  isAdmin() {
    return !!this.currentMember && this.currentMember.role === "admin";
  },

  _scheduleRefresh(expiresInSeconds) {
    if (this._refreshTimer) clearTimeout(this._refreshTimer);
    // Re-run the same handshake a minute before expiry. Telegram's
    // initData typically stays valid for the lifetime of the Mini App
    // session, so re-sending it is enough to mint a fresh app JWT.
    const refreshInMs = Math.max((expiresInSeconds - 60) * 1000, 5000);
    this._refreshTimer = setTimeout(() => this.login().catch(() => {}), refreshInMs);
  },

  _friendlyMessage(code) {
    switch (code) {
      case "unknown_or_inactive_member":
        return "You're not registered in this Ekub yet. Ask the organizer to add you.";
      case "invalid_telegram_auth":
        return "We couldn't verify your Telegram session. Please close and reopen the app.";
      case "missing_init_data":
      case "invalid_request_body":
        return "Something went wrong starting your session. Please reopen the app.";
      default:
        return "Something went wrong. Please try again in a moment.";
    }
  },
};
