import { NextResponse } from 'next/server'
import { beginRegistration, CHALLENGE_COOKIE_NAME, CHALLENGE_MAX_AGE_SECONDS } from '@/lib/auth/webauthn'

/** Not in the public-paths allowlist -- the access-gate middleware already
 * requires a valid session to reach this route, which is exactly the
 * bootstrap-of-trust this needs: only someone already logged in with the
 * password can register a new Face ID/Touch ID device. */
export async function POST() {
  const options = await beginRegistration()
  const response = NextResponse.json(options)
  response.cookies.set(CHALLENGE_COOKIE_NAME, options.challenge, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: CHALLENGE_MAX_AGE_SECONDS,
  })
  return response
}
