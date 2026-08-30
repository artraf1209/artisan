import { NextRequest, NextResponse } from 'next/server'
import { SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS, createSessionToken, hashForComparison } from '@/lib/auth/session'

/** Same-origin form POST, not a redirect to any external provider -- has to
 * work with no browser chrome, including a cold launch from an iPhone
 * home-screen icon in standalone display mode. */
function safeRedirectTarget(request: NextRequest, from: string | null): string {
  // Reject anything that isn't a same-origin relative path, so a crafted
  // `from` value can't be used as an open redirect.
  if (from && from.startsWith('/') && !from.startsWith('//')) {
    return new URL(from, request.url).toString()
  }
  return new URL('/dashboard', request.url).toString()
}

export async function POST(request: NextRequest) {
  const form = await request.formData()
  const password = String(form.get('password') ?? '')
  const from = form.get('from') ? String(form.get('from')) : null

  const expectedPassword = process.env.AUTH_PASSWORD ?? ''
  const [expectedHash, submittedHash] = await Promise.all([
    hashForComparison(expectedPassword),
    hashForComparison(password),
  ])

  if (!expectedPassword || expectedHash !== submittedHash) {
    // Fixed delay on a mismatch -- proportionate brute-force friction for a
    // single-owner app behind HTTPS, without a stateful rate limiter that
    // Vercel's stateless, multi-region Edge can't cleanly support anyway.
    await new Promise((resolve) => setTimeout(resolve, 500))
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('error', '1')
    if (from) {
      loginUrl.searchParams.set('from', from)
    }
    return NextResponse.redirect(loginUrl, { status: 303 })
  }

  const token = await createSessionToken()
  const response = NextResponse.redirect(safeRedirectTarget(request, from), { status: 303 })
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  })
  return response
}
