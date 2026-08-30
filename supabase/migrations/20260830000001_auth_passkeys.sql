-- Registered WebAuthn/passkey credentials for the single-owner access gate
-- (app/src/middleware.ts, app/src/lib/auth/webauthn.ts). Lets Face ID/Touch ID
-- stand in for the AUTH_PASSWORD login on supported devices. A table rather
-- than a single env var so more than one device (phone, laptop) can each hold
-- their own passkey, all authenticating as the one owner.
CREATE TABLE auth_passkeys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  credential_id text NOT NULL UNIQUE,
  -- base64-encoded COSE public key bytes -- plain text rather than bytea to
  -- avoid PostgREST's \x-hex bytea encoding entirely; this is opaque blob
  -- data that's never filtered or queried on.
  public_key text NOT NULL,
  counter bigint NOT NULL DEFAULT 0,
  transports text[],
  device_label text,
  created_at timestamptz DEFAULT now(),
  last_used_at timestamptz
);

-- Server-only table: no anon/authenticated policies at all. Every read/write
-- goes through the service-role admin client (app/src/lib/supabase/admin.ts)
-- from the webauthn API routes -- this is pure auth state, never queried
-- from the browser, same boundary CLAUDE.md already draws around
-- SUPABASE_SERVICE_ROLE_KEY.
ALTER TABLE auth_passkeys ENABLE ROW LEVEL SECURITY;
