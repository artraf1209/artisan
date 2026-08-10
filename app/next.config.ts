import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Strict mode for catching issues early
  reactStrictMode: true,
  async redirects() {
    // Added incrementally, one pair per v3-* relocation task, only once the
    // new destination has real content — never redirect to a stub.
    return [
      { source: '/positions', destination: '/dashboard/positions', permanent: true },
      { source: '/account', destination: '/dashboard/account', permanent: true },
      { source: '/orders', destination: '/recommendations/orders', permanent: true },
      { source: '/trades/queue', destination: '/recommendations', permanent: true },
    ]
  },
}

export default nextConfig
