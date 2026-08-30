import RegisterPasskeyButton from '@/components/auth/RegisterPasskeyButton'

/** No nav entry points here today -- this is a rare, one-time setup action
 * (register this device's Face ID/Touch ID), not a page meant for frequent
 * visits, so it doesn't need a permanent spot in AppShell's navigation. */
export default function SettingsPage() {
  return (
    <main className="mx-auto max-w-2xl space-y-5 px-4 py-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-[-0.04em] text-foreground">Settings</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">Account and device security.</p>
      </div>

      <section className="rounded-[1.5rem] border border-border bg-card/95 p-5 shadow-[0_20px_45px_rgba(0,0,0,0.22)]">
        <h2 className="text-lg font-semibold tracking-[-0.03em] text-foreground">Face ID / Touch ID sign-in</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Register this device so the login screen offers Face ID or Touch ID instead of typing the
          password. You can register more than one device -- do this again from your phone and any other
          device you use.
        </p>
        <div className="mt-4">
          <RegisterPasskeyButton />
        </div>
      </section>
    </main>
  )
}
