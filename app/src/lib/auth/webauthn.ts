import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticatorTransportFuture,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
} from '@simplewebauthn/server'
import { createAdminClient } from '@/lib/supabase/admin'

/** Face ID/Touch ID login for the single-owner access gate, layered on top
 * of the password gate in app/src/middleware.ts -- a successful passkey
 * ceremony sets the exact same artisan_session cookie a password login does
 * (see app/src/lib/auth/session.ts), so nothing downstream needs to know or
 * care which method was used. */

/** Short-lived cookie holding the per-ceremony challenge between the
 * "options" and "verify" steps of a registration or login. Plain (not
 * HMAC-signed like artisan_session) -- WebAuthn's own signature already
 * proves the authenticator actually saw this exact challenge, so the cookie
 * only needs to survive the round trip untampered by ordinary browser
 * behavior, not resist a determined attacker on its own. */
export const CHALLENGE_COOKIE_NAME = 'artisan_webauthn_challenge'
export const CHALLENGE_MAX_AGE_SECONDS = 300 // 5 minutes

const RP_NAME = 'Artisan'
// This app has exactly one owner and no user table backing auth -- there's
// nothing real to derive a WebAuthn userID from, so it's a fixed, synthetic
// value. It only needs to be stable, never meaningful.
const OWNER_USER_ID = new TextEncoder().encode('artisan-owner')
const OWNER_NAME = 'Artisan Owner'

function getRpIdAndOrigin(): { rpID: string; origin: string } {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (!appUrl) {
    throw new Error('NEXT_PUBLIC_APP_URL is not set -- required for WebAuthn (Face ID) login.')
  }
  const url = new URL(appUrl)
  return { rpID: url.hostname, origin: url.origin }
}

interface StoredCredential {
  credential_id: string
  public_key: string
  counter: number
  transports: string[] | null
}

async function loadCredentials(): Promise<StoredCredential[]> {
  const admin = createAdminClient() as any
  const { data, error } = await admin
    .from('auth_passkeys')
    .select('credential_id, public_key, counter, transports')
  if (error) {
    throw new Error(error.message)
  }
  return (data ?? []) as StoredCredential[]
}

/** Called unconditionally by the public /login page on every render, so this
 * must never throw -- the app's own Vercel deploy and the Supabase migration
 * that creates auth_passkeys (supabase/migrations/20260830000001_auth_passkeys.sql)
 * go out through two independent pipelines with no ordering guarantee
 * between them. If the table isn't there yet, that just means "no passkey
 * registered", same as a genuinely empty table -- never a broken login page. */
export async function hasAnyPasskey(): Promise<boolean> {
  try {
    const admin = createAdminClient() as any
    const { count, error } = await admin
      .from('auth_passkeys')
      .select('id', { count: 'exact', head: true })
    if (error) {
      return false
    }
    return (count ?? 0) > 0
  } catch {
    return false
  }
}

/** Step 1 of registering a new device's Face ID/Touch ID. Only ever reached
 * via a route the middleware already requires a valid session for -- this
 * bootstraps trust from an existing password login, so a stranger can never
 * register their own passkey against the app first. */
export async function beginRegistration(): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const { rpID } = getRpIdAndOrigin()
  const existing = await loadCredentials()

  return generateRegistrationOptions({
    rpName: RP_NAME,
    rpID,
    userName: OWNER_NAME,
    userID: OWNER_USER_ID,
    userDisplayName: OWNER_NAME,
    attestationType: 'none',
    authenticatorSelection: {
      // Built-in Face ID/Touch ID/Windows Hello only -- not a roaming USB key.
      authenticatorAttachment: 'platform',
      residentKey: 'required',
      userVerification: 'required',
    },
    excludeCredentials: existing.map((row) => ({
      id: row.credential_id,
      transports: (row.transports ?? undefined) as AuthenticatorTransportFuture[] | undefined,
    })),
  })
}

export async function finishRegistration(
  response: RegistrationResponseJSON,
  expectedChallenge: string,
  deviceLabel: string | null,
): Promise<boolean> {
  const { rpID, origin } = getRpIdAndOrigin()
  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
  })

  if (!verification.verified || !verification.registrationInfo) {
    return false
  }

  const { credential } = verification.registrationInfo
  const admin = createAdminClient() as any
  const { error } = await admin.from('auth_passkeys').insert({
    credential_id: credential.id,
    public_key: Buffer.from(credential.publicKey).toString('base64'),
    counter: credential.counter,
    transports: credential.transports ?? null,
    device_label: deviceLabel,
  })

  return !error
}

/** Step 1 of logging in with a passkey. No allowCredentials -- with
 * residentKey: 'required' at registration, the platform authenticator can
 * surface the right passkey itself, so the login page never needs to know
 * which credential exists before asking Face ID to unlock one. */
export async function beginAuthentication(): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const { rpID } = getRpIdAndOrigin()
  return generateAuthenticationOptions({
    rpID,
    userVerification: 'required',
  })
}

export async function finishAuthentication(
  response: AuthenticationResponseJSON,
  expectedChallenge: string,
): Promise<boolean> {
  const { rpID, origin } = getRpIdAndOrigin()
  const credentials = await loadCredentials()
  const stored = credentials.find((row) => row.credential_id === response.id)
  if (!stored) {
    return false
  }

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    credential: {
      id: stored.credential_id,
      publicKey: new Uint8Array(Buffer.from(stored.public_key, 'base64')),
      counter: stored.counter,
      transports: (stored.transports ?? undefined) as AuthenticatorTransportFuture[] | undefined,
    },
  })

  if (!verification.verified) {
    return false
  }

  const admin = createAdminClient() as any
  await admin
    .from('auth_passkeys')
    .update({ counter: verification.authenticationInfo.newCounter, last_used_at: new Date().toISOString() })
    .eq('credential_id', stored.credential_id)

  return true
}
