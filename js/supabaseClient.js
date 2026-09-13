/**
 * supabaseClient.js
 * ---------------------------------------------------------------
 * Owns the single supabase-js client instance used by the whole
 * app. The client starts out unauthenticated (anon key only, which
 * — per config.js — can't read or write anything). Once
 * AuthSession (see telegram.js) completes the Telegram login
 * handshake and receives a session JWT from the telegram-auth edge
 * function, we rebuild the client with that JWT attached to every
 * request's Authorization header.
 *
 * This is NOT the same thing as supabase.auth.signIn() — our JWT
 * isn't a Supabase Auth session, it's a compatible token we minted
 * ourselves (see the edge function). Attaching it as a global
 * header is the standard way to use a custom/third-party JWT with
 * PostgREST and Realtime.
 * ---------------------------------------------------------------
 */

const SupabaseClientManager = {
  client: null,

  /** Anonymous client — used only to call the edge function itself. */
  getAnonClient() {
    if (!this._anonClient) {
      this._anonClient = supabase.createClient(
        GoldenChanceConfig.SUPABASE_URL,
        GoldenChanceConfig.SUPABASE_ANON_KEY
      );
    }
    return this._anonClient;
  },

  /** Rebuilds the authenticated client to use the given session JWT. */
  setSessionToken(jwt) {
    this.client = supabase.createClient(
      GoldenChanceConfig.SUPABASE_URL,
      GoldenChanceConfig.SUPABASE_ANON_KEY,
      {
        global: {
          headers: { Authorization: `Bearer ${jwt}` },
        },
      }
    );
    // Realtime connects over a separate websocket and needs the same
    // token so postgres_changes subscriptions are evaluated under the
    // correct RLS identity, not the anon role.
    this.client.realtime.setAuth(jwt);
    return this.client;
  },

  /** The active client, or throws if login hasn't completed yet. */
  get() {
    if (!this.client) {
      throw new Error("Supabase client not authenticated yet — call AuthSession.login() first.");
    }
    return this.client;
  },
};
