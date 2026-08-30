import { permanentRedirect } from 'next/navigation'

/** Compatibility for existing home-screen bookmarks. */
export default function DashboardRedirect() {
  permanentRedirect('/recommendations')
}
