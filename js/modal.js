/**
 * modal.js
 * ---------------------------------------------------------------
 * A single reusable confirmation modal, used everywhere the app
 * used to call window.confirm()/window.alert(). Two modes:
 *   - plain confirm: "Deactivate this member?" / OK / Cancel
 *   - danger + typed phrase: for destructive, irreversible actions
 *     (reset cycle, permanent delete) — the confirm button stays
 *     disabled until the admin types an exact phrase, so a stray
 *     click can never trigger it.
 *
 * This is a UX safeguard, not a security boundary — the backend
 * (RLS + the SQL functions) is what actually decides whether the
 * action is allowed. See api.js / the SECURITY DEFINER functions.
 * ---------------------------------------------------------------
 */

const GCModal = {
  _resolve: null,

  ensureMounted() {
    if (document.getElementById("gc-modal-backdrop")) return;
    const el = document.createElement("div");
    el.id = "gc-modal-backdrop";
    el.className = "modal-backdrop";
    el.innerHTML = `
      <div class="modal-sheet gc-confirm-sheet" role="alertdialog" aria-modal="true">
        <div class="gc-confirm-icon" id="gc-confirm-icon"></div>
        <div class="modal-sheet-title" id="gc-confirm-title"></div>
        <p class="gc-confirm-message" id="gc-confirm-message"></p>
        <div class="gc-confirm-phrase-wrap" id="gc-confirm-phrase-wrap" hidden>
          <label id="gc-confirm-phrase-label"></label>
          <input type="text" id="gc-confirm-phrase-input" class="text-field" autocomplete="off" autocapitalize="off" spellcheck="false" />
        </div>
        <div class="modal-actions">
          <button class="btn btn-outline" id="gc-confirm-cancel">Cancel</button>
          <button class="btn btn-primary" id="gc-confirm-ok">Confirm</button>
        </div>
      </div>
    `;
    document.body.appendChild(el);
    el.addEventListener("click", (e) => {
      if (e.target === el) this._settle(false);
    });
    document.getElementById("gc-confirm-cancel").addEventListener("click", () => this._settle(false));
    document.getElementById("gc-confirm-ok").addEventListener("click", () => this._settle(true));
  },

  _settle(result) {
    document.getElementById("gc-modal-backdrop").classList.remove("is-open");
    if (this._resolve) {
      const resolve = this._resolve;
      this._resolve = null;
      resolve(result);
    }
  },

  /**
   * Shows the modal, resolves true (confirmed) or false (cancelled).
   * options: { title, message, confirmLabel, danger, requirePhrase }
   */
  confirm({ title, message, confirmLabel = "Confirm", danger = false, requirePhrase = null }) {
    this.ensureMounted();
    const backdrop = document.getElementById("gc-modal-backdrop");
    const okBtn = document.getElementById("gc-confirm-ok");
    const phraseWrap = document.getElementById("gc-confirm-phrase-wrap");
    const phraseInput = document.getElementById("gc-confirm-phrase-input");
    const phraseLabel = document.getElementById("gc-confirm-phrase-label");
    const icon = document.getElementById("gc-confirm-icon");

    document.getElementById("gc-confirm-title").textContent = title;
    document.getElementById("gc-confirm-message").textContent = message;
    okBtn.textContent = confirmLabel;
    okBtn.className = danger ? "btn btn-terracotta" : "btn btn-primary";
    icon.innerHTML = danger ? ICONS.alert : ICONS.check;
    icon.className = `gc-confirm-icon ${danger ? "is-danger" : "is-neutral"}`;

    if (requirePhrase) {
      phraseWrap.hidden = false;
      phraseLabel.textContent = `Type ${requirePhrase} to confirm`;
      phraseInput.value = "";
      okBtn.disabled = true;
      const checkMatch = () => {
        okBtn.disabled = phraseInput.value.trim() !== requirePhrase;
      };
      phraseInput.oninput = checkMatch;
      setTimeout(() => phraseInput.focus(), 50);
    } else {
      phraseWrap.hidden = true;
      phraseInput.oninput = null;
      okBtn.disabled = false;
    }

    backdrop.classList.add("is-open");
    return new Promise((resolve) => {
      this._resolve = resolve;
    });
  },
};
