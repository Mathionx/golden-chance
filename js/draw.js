/**
 * draw.js
 * ---------------------------------------------------------------
 * Coordinates one manual draw: call the backend, then animate the
 * wheel (GCWheel, see wheel.js) toward whatever it authoritatively
 * returns.
 *
 * ARCHITECTURAL RULE (unchanged since V1, now backed by a real
 * database function and a real wheel instead of mock data and a
 * name-cycling list):
 * This file NEVER decides the winner. It calls api.startDraw() —
 * which calls the start_draw() Postgres function — and only then
 * hands the already-decided result to GCWheel to *visualise*. If
 * startDraw() rejects (wrong role, no eligible members, round
 * already completed, etc), the wheel never spins; the real error is
 * shown instead.
 * ---------------------------------------------------------------
 */

const DrawController = {
  isRunning: false,

  async run({ idleSegments, onError, onDone }) {
    if (this.isRunning) return;
    this.isRunning = true;

    let result;
    try {
      // The backend has already picked and permanently recorded the
      // winner by the time this call resolves, including the exact
      // eligible-member snapshot every client will render the wheel
      // from (result.eligibleSnapshot). Everything after this line is
      // presentation only.
      result = await startDraw();
    } catch (err) {
      this.isRunning = false;
      onError && onError(err);
      return;
    }

    const segments = result.eligibleSnapshot.length ? result.eligibleSnapshot : idleSegments;

    GCWheel.spinToWinner(segments, result.memberId, () => {
      this.isRunning = false;
      onDone && onDone(result);
    });
  },
};
