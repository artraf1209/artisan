import { NextRequest, NextResponse } from 'next/server'
import { finishAuthentication, CHALLENGE_COOKIE_NAME } from '@/lib/auth/webauthn'
import { SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS, createSessionToken } from '@/lib/auth/session'
import type { AuthenticationResponseJSON } from '@simplewebauthn/server'

/** Public (see app/src/lib/auth/public-paths.ts) -- must be reachable from
 * /login before any session exists. On success this sets the exact same
 * artisan_session cookie a password login does, so everything downstream
 * (middleware included) treats a passkey login identically to a password
 * one -- no special-casing needed anywhere else. */
export async function POST(request: NextRequest) {
  const challenge = request.cookies.get(CHALLENGE_COOKIE_NAME)?.value
  if (!challenge) {
    return NextResponse.json({ ok: false, error: 'Sign-in expired -- try again.' }, { status: 400 })
  }

  const body = (await request.json().catch(() => null)) as { response?: AuthenticationResponseJSON } | null
  if (!body?.response) {
    return NextResponse.json({ ok: false, error: 'Malformed sign-in response.' }, { status: 400 })
  }

  const ok = await finishAuthentication(body.response, challenge)
  if (!ok) {
    return NextResponse.json({ ok: false, error: 'Face ID sign-in failed.' }, { status: 401 })
  }

  const token = await createSessionToken()
  const response = NextResponse.json({ ok: true })
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  })
  response.cookies.set(CHALLENGE_COOKIE_NAME, '', { path: '/', maxAge: 0 })
  return response
}
