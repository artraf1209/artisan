import type { Metadata, Viewport } from 'next'
import { JetBrains_Mono, Michroma } from 'next/font/google'
import './globals.css'
import PwaRegistration from '@/components/shared/PwaRegistration'

const jetbrainsMono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' })
const michroma = Michroma({ weight: '400', subsets: ['latin'], variable: '--font-display' })

export const metadata: Metadata = {
  title: 'Artisan',
  description: 'Installable AI trading workspace for dashboard, recommendations, briefing, and strategy controls.',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Artisan',
  },
  icons: {
    icon: '/pwa-icon-192.svg',
    apple: '/apple-icon',
  },
}

export const viewport: Viewport = {
  themeColor: '#0B0C0E',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={`${jetbrainsMono.variable} ${michroma.variable} font-mono`}>
        <PwaRegistration />
        {children}
      </body>
    </html>
  )
}
