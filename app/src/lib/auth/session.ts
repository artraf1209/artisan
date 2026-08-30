/**
 * Stateless session cookie for the single-owner access gate (see
 * app/src/middleware.ts). No user table, no server-side session store --
 * the cookie is a base64url `{exp}` payload plus an HMAC-SHA256 signature,
 * verified locally on every request via Web Crypto (`crypto.subtle`), which
 * runs identically in Edge middleware and Node/Bun route handlers with zero
 * new dependency.
 */

export const SESSION_COOKIE_NAME = 'artisan_session'
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 90 // 90 days

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(value.length + ((4 - (value.length % 4)) % 4), '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

async function getSigningKey(): Promise<CryptoKey> {
  const secret = process.env.APP_SECRET
  if (!secret) {
    throw new Error('APP_SECRET is not set -- cannot sign or verify session cookies.')
  }
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

/** Signs a fresh session, expiring SESSION_MAX_AGE_SECONDS from now. Expiry is
 * baked into the signed payload (not left to the cookie's own maxAge), so
 * there's nothing server-side to track and no way to extend a session by
 * replaying the same cookie value. */
export async function createSessionToken(): Promise<string> {
  const key = await getSigningKey()
  const payload = JSON.stringify({ exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS })
  const payloadB64 = toBase64Url(new TextEncoder().encode(payload))
  const signatureBytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadB64)))
  return `${payloadB64}.${toBase64Url(signatureBytes)}`
}

/** Never throws -- any malformed, unsigned, tampered, or expired token is
 * simply "not authenticated", same as no cookie at all. */
export async function verifySessionToken(token: string): Promise<boolean> {
  try {
    const [payloadB64, signatureB64] = token.split('.')
    if (!payloadB64 || !signatureB64) {
      return false
    }

    const key = await getSigningKey()
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      fromBase64Url(signatureB64),
      new TextEncoder().encode(payloadB64),
    )
    if (!valid) {
      return false
    }

    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(payloadB64))) as { exp?: unknown }
    return typeof payload.exp === 'number' && payload.exp > Math.floor(Date.now() / 1000)
  } catch {
    return false
  }
}

/** HMAC digest of an arbitrary string, used by the login route to compare the
 * submitted password against AUTH_PASSWORD. Comparing two fixed-size digests
 * with `===` doesn't leak positional information about the real secret the
 * way comparing raw strings character-by-character can -- a lightweight,
 * dependency-free stand-in for crypto.timingSafeEqual, which needs Node
 * Buffers and isn't reliably available in Edge middleware. */
export async function hashForComparison(value: string): Promise<string> {
  const key = await getSigningKey()
  const signatureBytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)))
  return toBase64Url(signatureBytes)
}
