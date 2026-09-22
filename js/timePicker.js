/**
 * timePicker.js
 * ---------------------------------------------------------------
 * Native <input type="time"> renders very differently (and
 * confusingly) across browsers/OSes — some show 24h clocks, some
 * show scroll wheels, some are hard to operate precisely on mobile.
 * This replaces it with three plain, clearly-labeled <select>
 * elements (Hour / Minute / AM-PM) styled to match the rest of the
 * app, so a non-technical admin always sees the same, unambiguous
 * control no matter what device they're on.
 *
 * The date portion still uses <input type="date"> — that one isn't
 * the ambiguous part (day/month/year pickers are fairly consistent
 * and well understood), so there's no need to reinvent it.
 * ---------------------------------------------------------------
 */

const TimePicker = {
  /** Renders Hour/Minute/AM-PM selects. `initial24` like "19:00" or null. */
  renderHtml(idPrefix, initial24) {
    let hour12 = 7, minute = 0, ampm = "PM";
    if (initial24) {
      const [h, m] = initial24.split(":").map(Number);
      ampm = h >= 12 ? "PM" : "AM";
      hour12 = h % 12 === 0 ? 12 : h % 12;
      minute = m;
    }
    const hourOptions = Array.from({ length: 12 }, (_, i) => i + 1)
      .map((h) => `<option value="${h}" ${h === hour12 ? "selected" : ""}>${h}</option>`)
      .join("");
    const minuteOptions = Array.from({ length: 12 }, (_, i) => i * 5)
      .map((m) => `<option value="${m}" ${m === minute ? "selected" : ""}>${String(m).padStart(2, "0")}</option>`)
      .join("");
    return `
      <div class="time-picker" id="${idPrefix}-wrap">
        <select class="select-field time-picker-part" id="${idPrefix}-hour" aria-label="Hour">${hourOptions}</select>
        <span class="time-picker-colon">:</span>
        <select class="select-field time-picker-part" id="${idPrefix}-minute" aria-label="Minute">${minuteOptions}</select>
        <div class="segmented time-picker-ampm" id="${idPrefix}-ampm">
          <button type="button" data-value="AM" class="${ampm === "AM" ? "is-active" : ""}">AM</button>
          <button type="button" data-value="PM" class="${ampm === "PM" ? "is-active" : ""}">PM</button>
        </div>
      </div>
    `;
  },

  /** Wires the AM/PM segmented control's click behavior. Call once after inserting the HTML. */
  wire(idPrefix) {
    const ampmWrap = document.getElementById(`${idPrefix}-ampm`);
    ampmWrap.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => {
        ampmWrap.querySelectorAll("button").forEach((b) => b.classList.remove("is-active"));
        btn.classList.add("is-active");
      });
    });
  },

  /** Reads the picker back out as a 24h "HH:MM" string. */
  read24(idPrefix) {
    const hour12 = Number(document.getElementById(`${idPrefix}-hour`).value);
    const minute = Number(document.getElementById(`${idPrefix}-minute`).value);
    const ampm = document.getElementById(`${idPrefix}-ampm`).querySelector(".is-active").dataset.value;
    let hour24 = hour12 % 12;
    if (ampm === "PM") hour24 += 12;
    return `${String(hour24).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  },

  /** Renders a full date + time picker together. `initialIso` is a full ISO datetime or null. */
  renderDateTimeHtml(idPrefix, initialIso) {
    let dateVal = "";
    let time24 = null;
    if (initialIso) {
      const d = new Date(initialIso);
      dateVal = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      time24 = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    }
    return `
      <div class="datetime-picker">
        <input type="date" id="${idPrefix}-date" class="text-field" value="${dateVal}" />
        ${this.renderHtml(idPrefix, time24)}
      </div>
    `;
  },

  wireDateTime(idPrefix) {
    this.wire(idPrefix);
  },

  /** Reads the combined date+time picker back out as a full ISO string, or null if no date chosen. */
  readDateTimeIso(idPrefix) {
    const dateVal = document.getElementById(`${idPrefix}-date`).value;
    if (!dateVal) return null;
    const time24 = this.read24(idPrefix);
    // Interpreted in the admin's local timezone, same as a native
    // datetime-local input would be, then normalized to a UTC ISO string.
    return new Date(`${dateVal}T${time24}:00`).toISOString();
  },
};
