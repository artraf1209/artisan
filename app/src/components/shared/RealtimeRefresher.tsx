'use client'

import { useRouter } from 'next/navigation'
import { useRealtimeTable } from '@/lib/hooks/useRealtimeTable'

/** Keeps a section fresh as the pipeline and execute-trade write new rows to the
 * given tables, without each leaf page wiring its own subscription. */
export default function RealtimeRefresher({ tables }: { tables: string[] }) {
  const router = useRouter()
  useRealtimeTable(tables, () => router.refresh())
  return null
}
