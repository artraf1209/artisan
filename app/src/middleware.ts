import { NextRequest, NextResponse } from 'next/server'
import { SESSION_COOKIE_NAME, verifySessionToken } from '@/lib/auth/session'
import { isPublicPath } from '@/lib/auth/public-paths'

/** Single-owner access gate. Every page and every API route in this app is
 * otherwise fully public -- this is the one place that sees every request
 * (the protected routes span multiple top-level route groups with no shared
 * layout: (sections)/*, settings, trades, history, and all of api/*), so
 * enforcement lives here rather than scattered across layouts. */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (isPublicPath(pathname)) {
    return NextResponse.next()
  }

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value
  const authenticated = token ? await verifySessionToken(token) : false

  if (authenticated) {
    return NextResponse.next()
  }

  if (pathname.startsWith('/api/')) {
    // Redirecting a fetch() call to an HTML login page would just break the
    // caller -- an API request without a valid session gets a plain 401.
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const loginUrl = new URL('/login', request.url)
  loginUrl.searchParams.set('from', pathname + request.nextUrl.search)
  return NextResponse.redirect(loginUrl)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
