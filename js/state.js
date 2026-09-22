/**
 * state.js
 * ---------------------------------------------------------------
 * Pure UI state only. In the prototype this file also held mock
 * "server" data (members, winners, etc); that data now lives in
 * Supabase and is fetched through api.js on demand, so this file
 * shrank to exactly what its comment always promised it would.
 * ---------------------------------------------------------------
 */

const AppState = {
  activeScreen: "home",
  lastDrawResult: null, // set right after a draw completes, used by the reveal UI
  isDrawingLocally: false, // true while THIS client is running its own draw, so realtime echoes of its own writes don't double-animate
  currentWeekNumber: null, // set by renderHome(), used by the realtime handler to label a remote reveal
};
