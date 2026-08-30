/** Routes the access-gate middleware lets through with no session cookie at
 * all. Kept separate from middleware.ts so the allowlist is independently
 * readable/greppable. Everything not listed here requires a valid
 * artisan_session cookie -- see app/src/middleware.ts. */
const PUBLIC_PATHS = new Set([
  '/login',
  '/api/login',
  // Face ID/Touch ID sign-in ceremony -- must be reachable pre-login, same as
  // /api/login. The *registration* routes (registration-options,
  // registration-verify) deliberately stay OUT of this list: registering a
  // new passkey requires an existing session, enforced for free by the
  // middleware's default-protected behavior.
  '/api/webauthn/authentication-options',
  '/api/webauthn/authentication-verify',
  // Service worker offline fallback (app/src/app/offline/page.tsx) -- must
  // stay reachable unauthenticated or the offline UX breaks.
  '/offline',
  '/manifest.webmanifest',
  '/sw.js',
  '/pwa-icon-192.svg',
  '/pwa-icon-512.svg',
  // File-based icon routes (app/src/app/apple-icon.tsx, icon.tsx).
  '/apple-icon',
  '/icon',
  '/favicon.ico',
])

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname)
}
