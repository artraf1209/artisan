import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Artisan Trading Dashboard',
    short_name: 'Artisan',
    description: 'AI trading workspace for dashboard, recommendations, briefing, and strategy controls.',
    start_url: '/recommendations',
    display: 'standalone',
    background_color: '#0B0C0E',
    theme_color: '#0B0C0E',
    orientation: 'portrait',
    icons: [
      {
        src: '/pwa-icon-192.svg',
        sizes: '192x192',
        type: 'image/svg+xml',
        purpose: 'maskable',
      },
      {
        src: '/pwa-icon-512.svg',
        sizes: '512x512',
        type: 'image/svg+xml',
        purpose: 'maskable',
      },
    ],
  }
}
