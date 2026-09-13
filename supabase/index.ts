// ============================================================================
// GOLDEN CHANCE — telegram-auth edge function
// ============================================================================
// This is the ONLY backend "application code" in the whole project.
// Everything else the app does goes straight from the frontend to
// Supabase's auto-generated REST API, protected by RLS + the SQL
// functions in supabase/migrations/0003_functions.sql.
//
// This function exists because it needs THREE secrets that must never
// reach the browser:
//   - BOT_TOKEN                 to verify Telegram's signature
//   - SUPABASE_SERVICE_ROLE_KEY to look up the member bypassing RLS
//   - SUPABASE_JWT_SECRET        to mint a session token for the frontend
//
// FLOW
//   1. Frontend sends { initData } — the raw string from
//      Telegram.WebApp.initData. Never initDataUnsafe; that object is
//      client-supplied and unsigned.
//   2. We verify initData's HMAC signature using BOT_TOKEN (Telegram's
//      documented algorithm — see verifyTelegramInitData below).
//   3. We reject stale initData (auth_date older than MAX_AUTH_AGE_SECONDS).
//   4. We look up the Telegram user id in `members` using the service
//      role (bypasses RLS — safe here because this code runs only on
//      our server, never in a browser).
//   5. Unknown or inactive members are rejected. There is no auto-create;
//      an admin must add the member first (see supabase/seed.sql /
//      the Admin dashboard).
//   6. We mint a JWT signed with SUPABASE_JWT_SECRET containing the
//      member's id, role, and Telegram id, and return it to the client.
// ============================================================================

import { create, getNumericDate } from "https://deno.land/x/djwt@v3.0.2/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BOT_TOKEN = Deno.env.get("BOT_TOKEN");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const SUPABASE_JWT_SECRET = Deno.env.get("SUPABASE_JWT_SECRET");
// Optional: restrict CORS to your Mini App's real origin in production.
// Left as "*" for local development.
const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") ?? "*";

const MAX_AUTH_AGE_SECONDS = 24 * 60 * 60; // reject initData older than 24h
const SESSION_TTL_SECONDS = 12 * 60 * 60; // minted JWT is valid for 12h

const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "content-type, authorization, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Verifies a Telegram Mini App initData string per Telegram's documented
 * algorithm: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 *   secret_key = HMAC_SHA256(key = "WebAppData", data = BOT_TOKEN)
 *   data_check_string = all fields except `hash`, sorted alphabetically
 *                        by key, joined as "key=value" with "\n"
 *   computed_hash = HMAC_SHA256(key = secret_key, data = data_check_string), hex
 *   valid iff computed_hash === hash (the field Telegram sent)
 */
async function verifyTelegramInitData(initData: string, botToken: string) {
  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash");
  if (!receivedHash) return { valid: false as const, reason: "missing_hash" };
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const encoder = new TextEncoder();

  const secretKeyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode("WebAppData"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const secretKeyBytes = await crypto.subtle.sign(
    "HMAC",
    secretKeyMaterial,
    encoder.encode(botToken),
  );

  const signingKey = await crypto.subtle.importKey(
    "raw",
    secretKeyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const computedHashBytes = await crypto.subtle.sign(
    "HMAC",
    signingKey,
    encoder.encode(dataCheckString),
  );
  const computedHash = Array.from(new Uint8Array(computedHashBytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  if (computedHash !== receivedHash) {
    return { valid: false as const, reason: "bad_signature" };
  }

  const authDate = Number(params.get("auth_date"));
  if (!authDate || Date.now() / 1000 - authDate > MAX_AUTH_AGE_SECONDS) {
    return { valid: false as const, reason: "expired" };
  }

  const userRaw = params.get("user");
  if (!userRaw) return { valid: false as const, reason: "missing_user" };

  let user: { id: number; first_name?: string; last_name?: string; username?: string };
  try {
    user = JSON.parse(userRaw);
  } catch {
    return { valid: false as const, reason: "malformed_user" };
  }

  return { valid: true as const, user, authDate };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  if (!BOT_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_JWT_SECRET) {
    // Never leak *why* to the client beyond a generic message — this
    // indicates a misconfigured deployment, not something the caller did.
    console.error("telegram-auth: missing required environment variables");
    return jsonResponse({ error: "server_misconfigured" }, 500);
  }

  let body: { initData?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_request_body" }, 400);
  }

  if (!body.initData || typeof body.initData !== "string") {
    return jsonResponse({ error: "missing_init_data" }, 400);
  }

  const verification = await verifyTelegramInitData(body.initData, BOT_TOKEN);
  if (!verification.valid) {
    // Deliberately generic — do not tell a caller which part failed.
    return jsonResponse({ error: "invalid_telegram_auth" }, 401);
  }

  // Service-role client: bypasses RLS. This is safe ONLY because this
  // code runs server-side inside the edge function, never in a browser.
  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data: member, error } = await adminClient
    .from("members")
    .select("id, display_name, role, is_active")
    .eq("telegram_user_id", verification.user.id)
    .maybeSingle();

  if (error) {
    console.error("telegram-auth: member lookup failed", error);
    return jsonResponse({ error: "server_error" }, 500);
  }

  if (!member || !member.is_active) {
    // Unknown or deactivated Telegram users are denied outright. There
    // is no self-signup — an admin must add the member first.
    return jsonResponse({ error: "unknown_or_inactive_member" }, 403);
  }

  const jwtSecretKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SUPABASE_JWT_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );

  const token = await create(
    { alg: "HS256", typ: "JWT" },
    {
      sub: member.id, // becomes auth.uid() in Postgres
      role: "authenticated", // Postgres role PostgREST assumes for this request
      app_role: member.role, // 'member' | 'admin' — read by is_admin() and RLS
      telegram_id: verification.user.id,
      iat: getNumericDate(0),
      exp: getNumericDate(SESSION_TTL_SECONDS),
    },
    jwtSecretKey,
  );

  return jsonResponse({
    token,
    expires_in: SESSION_TTL_SECONDS,
    member: {
      id: member.id,
      display_name: member.display_name,
      role: member.role,
    },
  });
});
