/**
 * draw.js
 * ---------------------------------------------------------------
 * Controls the "live draw" animation on the Draw screen.
 *
 * ARCHITECTURAL RULE (unchanged from the prototype, now backed by a
 * real database function instead of mock data):
 * The animation NEVER decides the winner. It calls api.startDraw()
 * — which calls the start_draw() Postgres function — and only then
 * visualises arriving at that already-decided, already-recorded
 * result. If startDraw() rejects (wrong role, no eligible members,
 * round already completed, etc), the animation never starts; we
 * show the real error instead.
 *
 * The animation itself is a single decelerating name reveal, not a
 * spinning reel — deliberately, so the moment reads as a careful
 * selection rather than a slot machine.
 * ---------------------------------------------------------------
 */

const DrawController = {
  isRunning: false,

  async run({ eligibleNames, onTick, onProgress, onDone, onError }) {
    if (this.isRunning) return;
    this.isRunning = true;

    let result;
    try {
      // The backend has now already picked and permanently recorded the
      // winner by the time this call resolves. Everything after this is
      // presentation only.
      result = await startDraw();
    } catch (err) {
      this.isRunning = false;
      onError && onError(err);
      return;
    }

    const pool = eligibleNames.length ? eligibleNames : [result.memberName];
    const sequence = [];
    const totalTicks = 22;
    for (let i = 0; i < totalTicks; i++) {
      sequence.push(pool[Math.floor(Math.random() * pool.length)]);
    }
    sequence.push(result.memberName); // guaranteed final frame — the real winner

    const progressMessages = ["Checking eligible members…", "Narrowing it down…", "Almost there…"];

    let i = 0;
    const play = () => {
      onTick(sequence[i]);

      const progress = i / (sequence.length - 1);
      if (progress < 0.35) onProgress(progressMessages[0]);
      else if (progress < 0.75) onProgress(progressMessages[1]);
      else onProgress(progressMessages[2]);

      i++;
      if (i < sequence.length) {
        const delay = 70 + Math.pow(progress, 2) * 350; // ease-out settle
        setTimeout(play, delay);
      } else {
        this.isRunning = false;
        onDone(result);
      }
    };
    play();
  },
};
