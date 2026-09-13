/**
 * config.js
 * ---------------------------------------------------------------
 * PUBLIC configuration only.
 *
 * The Supabase URL and "anon" key below are meant to be public —
 * they are the same values Supabase's own docs tell you to embed
 * in any client app. They grant no access by themselves; every
 * table is locked down by Row Level Security (see
 * supabase/migrations/0002_rls.sql), and the anon role additionally
 * has ZERO table grants in this project (see the same file) — so
 * even the public anon key can't read or write anything until a
 * user has completed Telegram login and holds a real session JWT.
 *
 * Never add these to this file:
 *   - Supabase SERVICE ROLE key
 *   - Supabase JWT secret
 *   - Telegram BOT_TOKEN
 * Those live only in the telegram-auth edge function's environment
 * variables (see supabase/functions/telegram-auth and .env.example).
 * ---------------------------------------------------------------
 */

const GoldenChanceConfig = {
  SUPABASE_URL: "https://ihjcepfilubptjaclhsq.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloamNlcGZpbHVicHRqYWNsaHNxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkzMTU2MTYsImV4cCI6MjEwNDg5MTYxNn0.ozlDh2gsO9t1IpUQobOq-FSPV37J_vLLfqFK0166Nuw",

  // Full URL of the deployed telegram-auth edge function, e.g.
  // "https://YOUR-PROJECT-REF.supabase.co/functions/v1/telegram-auth"
  TELEGRAM_AUTH_URL: "https://ihjcepfilubptjaclhsq.supabase.co/functions/v1/swift-service",
};
