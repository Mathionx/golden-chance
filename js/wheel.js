/**
 * wheel.js
 * ---------------------------------------------------------------
 * Renders and spins the Golden Chance wheel.
 *
 * SECURITY / ARCHITECTURE RULE — read this before changing anything:
 * This file NEVER decides a winner. Every function here takes a
 * winner id it was already given (by draw.js, which got it from
 * api.startDraw() → the start_draw() Postgres function) and animates
 * toward that specific, already-recorded segment. There is no
 * Math.random() call anywhere in this file that affects WHO wins —
 * randomness here only adds a small cosmetic wobble so the stopping
 * point doesn't look mechanically exact, purely for visual realism.
 *
 * DESIGN NOTE: the wheel deliberately avoids the "casino prize wheel"
 * look (alternating bright colors, marquee bulbs) in favor of the
 * Golden Chance mark's own language: a dark face, a thin gold rim,
 * fine gold spoke lines, and a small gold pointer echoing the little
 * triangle above the crown in the logo.
 * ---------------------------------------------------------------
 */

const GCWheel = {
  containerEl: null,
  wheelEl: null,
  currentRotation: 0,
  segments: [],

  /** Mounts (or re-mounts) the wheel + pointer into a container, idle (not spinning). */
  mount(container, segments) {
    this.containerEl = container;
    this.segments = segments;
    this.currentRotation = 0;
    container.innerHTML = `
      <div class="wheel-pointer" aria-hidden="true"></div>
      <div class="wheel-rotor" id="wheel-rotor">${this._buildSvg(segments)}</div>
    `;
    this.wheelEl = container.querySelector("#wheel-rotor");
  },

  _buildSvg(segments) {
    const n = Math.max(segments.length, 1);
    const size = 300;
    const cx = size / 2;
    const cy = size / 2;
    const outerR = 138;
    const labelR = 96;
    const step = 360 / n;

    const pointAt = (angleDeg, r) => {
      const rad = ((angleDeg - 90) * Math.PI) / 180; // -90 so 0deg = top (12 o'clock)
      return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
    };

    let slices = "";
    let dividers = "";
    let labels = "";

    if (n === 1) {
      slices = `<circle cx="${cx}" cy="${cy}" r="${outerR}" class="wheel-face" />`;
    } else {
      for (let i = 0; i < n; i++) {
        const startAngle = i * step;
        const endAngle = (i + 1) * step;
        const [x1, y1] = pointAt(startAngle, outerR);
        const [x2, y2] = pointAt(endAngle, outerR);
        const largeArc = step > 180 ? 1 : 0;
        const shade = i % 2 === 0 ? "wheel-face-a" : "wheel-face-b";
        slices += `<path d="M${cx},${cy} L${x1.toFixed(2)},${y1.toFixed(2)} A${outerR},${outerR} 0 ${largeArc} 1 ${x2.toFixed(2)},${y2.toFixed(2)} Z" class="${shade}" />`;
        const [dx, dy] = pointAt(startAngle, outerR);
        dividers += `<line x1="${cx}" y1="${cy}" x2="${dx.toFixed(2)}" y2="${dy.toFixed(2)}" class="wheel-divider" />`;
      }
    }

    segments.forEach((seg, i) => {
      const centerAngle = i * step + step / 2;
      const label = initialsFor(seg.display_name);
      labels += `
        <g transform="rotate(${centerAngle} ${cx} ${cy})">
          <text x="${cx}" y="${cy - labelR}" class="wheel-label" text-anchor="middle">${label}</text>
        </g>
      `;
    });

    return `
      <svg viewBox="0 0 ${size} ${size}" class="wheel-svg" role="img" aria-label="Draw wheel">
        <circle cx="${cx}" cy="${cy}" r="${outerR + 6}" class="wheel-ring-outer" />
        ${slices}
        ${dividers}
        ${labels}
        <circle cx="${cx}" cy="${cy}" r="${outerR + 6}" class="wheel-ring-line" />
        <circle cx="${cx}" cy="${cy}" r="20" class="wheel-hub" />
      </svg>
    `;
  },

  /**
   * Spins to land on `winnerId`'s segment within `segments` (the exact
   * same ordered list every client used to build the wheel — see
   * winners.eligible_snapshot). Calls onDone() once the animation settles.
   */
  spinToWinner(segments, winnerId, onDone) {
    this.mount(this.containerEl, segments); // rebuild fresh from the authoritative snapshot
    const n = segments.length;
    const winnerIndex = segments.findIndex((s) => s.id === winnerId);
    const step = 360 / n;
    const centerAngle = winnerIndex >= 0 ? winnerIndex * step + step / 2 : 0;

    // Small cosmetic wobble so the stop doesn't look laser-precise.
    // Bounded well within the slice so it can never appear to land on
    // the wrong segment.
    const jitter = (Math.random() - 0.5) * step * 0.5;
    const effectiveAngle = ((centerAngle + jitter) % 360 + 360) % 360;
    const restingAngle = (360 - effectiveAngle) % 360;

    const currentMod = ((this.currentRotation % 360) + 360) % 360;
    const forwardDelta = ((restingAngle - currentMod) + 360) % 360;
    const extraSpins = 6 + Math.floor(Math.random() * 2); // 6 or 7 full turns
    const finalRotation = this.currentRotation + forwardDelta + extraSpins * 360;

    // Phase 1: quick spin-up (acceleration) — short, ease-in.
    const spinUpAmount = 130 + Math.random() * 40;
    const phase1Rotation = this.currentRotation + spinUpAmount;

    this.wheelEl.style.transition = "none";
    // Force reflow so the browser registers the current transform before
    // we start transitioning, otherwise the first phase can be skipped.
    void this.wheelEl.offsetWidth;

    this.wheelEl.style.transition = "transform 420ms cubic-bezier(0.55, 0, 0.85, 0.35)";
    this.wheelEl.style.transform = `rotate(${phase1Rotation}deg)`;

    const startPhase2 = () => {
      this.wheelEl.removeEventListener("transitionend", startPhase2);
      const duration = 4200 + Math.random() * 600;
      this.wheelEl.style.transition = `transform ${duration}ms cubic-bezier(0.1, 0.82, 0.18, 1)`;
      this.wheelEl.style.transform = `rotate(${finalRotation}deg)`;
      this.currentRotation = finalRotation;

      const onSettled = () => {
        this.wheelEl.removeEventListener("transitionend", onSettled);
        onDone && onDone();
      };
      this.wheelEl.addEventListener("transitionend", onSettled);
    };
    this.wheelEl.addEventListener("transitionend", startPhase2);
  },
};

/** Small local helper so wheel.js doesn't depend on load order relative to ui.js. */
function initialsFor(fullName) {
  return fullName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join("");
}
