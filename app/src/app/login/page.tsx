import PasskeyLoginButton from '@/components/auth/PasskeyLoginButton'
import { hasAnyPasskey } from '@/lib/auth/webauthn'

/** The password form is deliberately a plain server-rendered form, no client
 * component -- it's the one thing on this page that must render and work
 * with zero JS/hydration dependency, including a cold launch straight into
 * this page from an iPhone home-screen icon with no browser chrome to fall
 * back on. The Face ID button above it is a client island and simply doesn't
 * render if JS hasn't loaded or no passkey exists yet -- the password field
 * underneath it always works either way. */
export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ from?: string; error?: string }>
}) {
  const params = searchParams ? await searchParams : undefined
  const from = params?.from ?? '/dashboard'
  const hasError = params?.error === '1'
  const passkeyEnabled = await hasAnyPasskey()

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-[1.5rem] border border-border bg-card/95 p-6 shadow-[0_20px_45px_rgba(0,0,0,0.22)]">
        <h1 className="text-xl font-semibold tracking-[-0.03em] text-foreground">Artisan</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">Sign in to continue.</p>

        {passkeyEnabled ? (
          <div className="mt-5 space-y-3">
            <PasskeyLoginButton from={from} enabled={passkeyEnabled} />
            <div className="flex items-center gap-3 text-xs uppercase tracking-[0.14em] text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              or
              <span className="h-px flex-1 bg-border" />
            </div>
          </div>
        ) : null}

        <form action="/api/login" method="POST" className="mt-3 space-y-3">
          <input type="hidden" name="from" value={from} />
          <input
            type="password"
            name="password"
            autoFocus={!passkeyEnabled}
            required
            autoComplete="current-password"
            placeholder="Password"
            className="w-full rounded-2xl border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-ring"
          />

          {hasError ? <p className="text-sm text-loss">Incorrect password.</p> : null}

          <button
            type="submit"
            className="w-full rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90"
          >
            Sign in with password
          </button>
        </form>
      </div>
    </main>
  )
}
