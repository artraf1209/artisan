'use client'

import { useEffect, useState, useTransition } from 'react'
import { browserSupportsWebAuthn, startAuthentication } from '@simplewebauthn/browser'

/** Renders nothing until confirmed both (a) the server says at least one
 * passkey is registered (`enabled`, set by the /login Server Component from
 * hasAnyPasskey()) and (b) this browser actually supports WebAuthn -- so the
 * password field stays the only thing on screen for the very first login,
 * before any device has ever been registered. */
export default function PasskeyLoginButton({ from, enabled }: { from: string; enabled: boolean }) {
  const [supported, setSupported] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    setSupported(browserSupportsWebAuthn())
  }, [])

  if (!enabled || !supported) {
    return null
  }

  const handleClick = () => {
    setError(null)
    startTransition(async () => {
      try {
        const optionsResponse = await fetch('/api/webauthn/authentication-options', { method: 'POST' })
        if (!optionsResponse.ok) {
          const body = await optionsResponse.json().catch(() => null)
          setError(body?.error ?? 'Face ID sign-in is not set up yet.')
          return
        }
        const optionsJSON = await optionsResponse.json()
        const assertion = await startAuthentication({ optionsJSON })

        const verifyResponse = await fetch('/api/webauthn/authentication-verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ response: assertion }),
        })
        const result = await verifyResponse.json()
        if (!verifyResponse.ok || !result.ok) {
          setError(result.error ?? 'Face ID sign-in failed.')
          return
        }
        window.location.href = from
      } catch {
        // The user cancelled the Face ID/Touch ID prompt, or the platform
        // rejected the ceremony -- not worth a hard error, they can just use
        // the password field below instead.
      }
    })
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="w-full rounded-full border border-border bg-background px-5 py-2.5 text-sm font-medium text-foreground transition hover:bg-accent disabled:opacity-60"
      >
        {isPending ? 'Waiting for Face ID…' : 'Sign in with Face ID'}
      </button>
      {error ? <p className="text-sm text-loss">{error}</p> : null}
    </div>
  )
}
