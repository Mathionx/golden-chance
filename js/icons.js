/**
 * icons.js
 * ---------------------------------------------------------------
 * Hand-picked line icons as inline SVG strings. Kept in one place
 * so the visual language (stroke width, corner style) stays
 * consistent across every screen without pulling in an icon font
 * or extra library.
 * ---------------------------------------------------------------
 */

const ICONS = {
  home: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11.5 12 4l8 7.5"/><path d="M6 10v9a1 1 0 0 0 1 1h3v-6h4v6h3a1 1 0 0 0 1-1v-9"/></svg>`,

  member: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.4"/><path d="M5 20c1.2-4 4-6 7-6s5.8 2 7 6"/></svg>`,

  draw: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.2"/><path d="M12 8.2v3.8l2.6 1.6"/></svg>`,

  history: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12a8 8 0 1 0 2.6-5.9"/><path d="M4 4.5V9h4.5"/><path d="M12 8v4.3l3 2"/></svg>`,

  admin: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4.5c.5 1 1.4 1.6 2.6 1.6.2.9.7 1.7 1.4 2.2.7.9.9 1.9.7 2.9-.9.4-1.6 1.1-1.9 2-.5 1.1-1.5 1.8-2.8 1.8s-2.3-.7-2.8-1.8c-.3-.9-1-1.6-1.9-2-.2-1 0-2 .7-2.9.7-.5 1.2-1.3 1.4-2.2 1.2 0 2.1-.6 2.6-1.6Z"/><circle cx="12" cy="12" r="2.4"/></svg>`,

  clock: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>`,

  calendar: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5.5" width="16" height="14.5" rx="2.4"/><path d="M4 9.5h16"/><path d="M8 3.5v3.4M16 3.5v3.4"/></svg>`,

  users: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8.3" r="3"/><path d="M3 19c1-3.3 3.3-5 6-5s5 1.7 6 5"/><path d="M16 8.5a2.7 2.7 0 1 1 .5 5.4"/><path d="M17.5 14.2c2 .4 3.4 1.9 4 4.6" /></svg>`,

  check: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M8.5 12.3 11 14.8l4.7-5.6"/></svg>`,

  alert: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.8 21 19H3L12 3.8Z"/><path d="M12 10v3.6"/><circle cx="12" cy="16.3" r="0.15" fill="currentColor"/></svg>`,

  pencil: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 5.3 18.7 9.3 8 20H4v-4Z"/><path d="M13 7l4 4"/></svg>`,

  trash: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7h14"/><path d="M9 7V5.2c0-.7.5-1.2 1.2-1.2h3.6c.7 0 1.2.5 1.2 1.2V7"/><path d="M7 7l1 12.2c0 .7.6 1.3 1.3 1.3h5.4c.7 0 1.3-.6 1.3-1.3L17 7"/></svg>`,

  plus: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>`,

  sparkle: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4.5c.5 2.6 1.4 3.5 4 4-2.6.5-3.5 1.4-4 4-.5-2.6-1.4-3.5-4-4 2.6-.5 3.5-1.4 4-4Z"/><path d="M18.5 15c.3 1.3.7 1.7 2 2-1.3.3-1.7.7-2 2-.3-1.3-.7-1.7-2-2 1.3-.3 1.7-.7 2-2Z"/></svg>`,

  lock: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5.5" y="10.5" width="13" height="9" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/></svg>`,
};
