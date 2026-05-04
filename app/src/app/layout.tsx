import type { Metadata, Viewport } from 'next'
import { Outfit } from 'next/font/google'
import './globals.css'
import PwaRegistration from '@/components/shared/PwaRegistration'

const outfit = Outfit({ subsets: ['latin'], variable: '--font-outfit' })

export const metadata: Metadata = {
  title: 'Artisan',
  description: 'Installable mobile-first trading dashboard for signals, approvals, and briefings.',
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
  themeColor: '#0a0a0f',
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
      <body className={outfit.className}>
        <PwaRegistration />
        {children}
      </body>
    </html>
  )
}
