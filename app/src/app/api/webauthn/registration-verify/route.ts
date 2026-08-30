import { NextRequest, NextResponse } from 'next/server'
import { finishRegistration, CHALLENGE_COOKIE_NAME } from '@/lib/auth/webauthn'
import type { RegistrationResponseJSON } from '@simplewebauthn/server'

export async function POST(request: NextRequest) {
  const challenge = request.cookies.get(CHALLENGE_COOKIE_NAME)?.value
  if (!challenge) {
    return NextResponse.json({ ok: false, error: 'Registration expired -- try again.' }, { status: 400 })
  }

  const body = (await request.json().catch(() => null)) as {
    response?: RegistrationResponseJSON
    deviceLabel?: string
  } | null

  if (!body?.response) {
    return NextResponse.json({ ok: false, error: 'Malformed registration response.' }, { status: 400 })
  }

  const deviceLabel = typeof body.deviceLabel === 'string' && body.deviceLabel.trim() ? body.deviceLabel.trim() : null
  const ok = await finishRegistration(body.response, challenge, deviceLabel)

  const response = NextResponse.json({ ok })
  response.cookies.set(CHALLENGE_COOKIE_NAME, '', { path: '/', maxAge: 0 })
  return response
}
