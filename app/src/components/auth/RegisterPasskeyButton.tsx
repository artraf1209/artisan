'use client'

import { useEffect, useState, useTransition } from 'react'
import { browserSupportsWebAuthn, startRegistration } from '@simplewebauthn/browser'

/** One-time setup action: registers this device's Face ID/Touch ID as a
 * passkey. Only reachable already-logged-in (this page sits behind the
 * access-gate middleware), which is what lets a passkey registration be
 * trusted without its own separate credential check. */
export default function RegisterPasskeyButton() {
  const [supported, setSupported] = useState(false)
  const [status, setStatus] = useState<'idle' | 'done' | 'error'>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    setSupported(browserSupportsWebAuthn())
  }, [])

  if (!supported) {
    return (
      <p className="text-sm text-muted-foreground">
        This browser doesn&apos;t support Face ID/Touch ID sign-in.
      </p>
    )
  }

  const handleClick = () => {
    setStatus('idle')
    setMessage(null)
    startTransition(async () => {
      try {
        const optionsResponse = await fetch('/api/webauthn/registration-options', { method: 'POST' })
        if (!optionsResponse.ok) {
          setStatus('error')
          setMessage('Could not start registration. Try again.')
          return
        }
        const optionsJSON = await optionsResponse.json()
        const attestation = await startRegistration({ optionsJSON })

        const deviceLabel =
          typeof navigator !== 'undefined' && /iPhone|iPad/.test(navigator.userAgent) ? 'iPhone' : 'This device'

        const verifyResponse = await fetch('/api/webauthn/registration-verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ response: attestation, deviceLabel }),
        })
        const result = await verifyResponse.json()
        if (!verifyResponse.ok || !result.ok) {
          setStatus('error')
          setMessage('Registration failed. Try again.')
          return
        }
        setStatus('done')
        setMessage('Face ID/Touch ID is set up -- you can use it on the login screen from now on.')
      } catch {
        setStatus('error')
        setMessage('Cancelled or not available on this device.')
      }
    })
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending || status === 'done'}
        className="rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
      >
        {isPending ? 'Waiting for Face ID…' : status === 'done' ? 'Registered' : 'Set up Face ID / Touch ID'}
      </button>
      {message ? (
        <p className={`text-sm ${status === 'error' ? 'text-loss' : 'text-muted-foreground'}`}>{message}</p>
      ) : null}
    </div>
  )
}
