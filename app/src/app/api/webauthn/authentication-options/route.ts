import { NextResponse } from 'next/server'
import { beginAuthentication, hasAnyPasskey, CHALLENGE_COOKIE_NAME, CHALLENGE_MAX_AGE_SECONDS } from '@/lib/auth/webauthn'

/** Public (see app/src/lib/auth/public-paths.ts) -- must be reachable from
 * /login before any session exists. */
export async function POST() {
  if (!(await hasAnyPasskey())) {
    return NextResponse.json({ error: 'No passkey registered on this app yet.' }, { status: 404 })
  }

  const options = await beginAuthentication()
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
