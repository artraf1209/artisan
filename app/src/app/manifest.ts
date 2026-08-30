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
        src: '/artisan-icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/artisan-icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  }
}
