import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'ATLAS Trading Workspace',
    short_name: 'ATLAS',
    description: 'AI trading workspace for recommendations, positions, briefings, and strategy controls.',
    start_url: '/recommendations',
    display: 'standalone',
    background_color: '#0B0C0E',
    theme_color: '#0B0C0E',
    orientation: 'portrait',
    icons: [
      {
        src: '/atlas-icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/atlas-icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  }
}
