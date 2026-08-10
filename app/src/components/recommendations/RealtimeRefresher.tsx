'use client'

import { useRouter } from 'next/navigation'
import { useRealtimeTable } from '@/lib/hooks/useRealtimeTable'

const TABLES = ['recommendations', 'position_reviews', 'trade_executions']

/** Keeps every tab in the Recommendations section fresh as the pipeline and
 * execute-trade write new rows, without each leaf page wiring its own
 * subscription. */
export default function RealtimeRefresher() {
  const router = useRouter()
  useRealtimeTable(TABLES, () => router.refresh())
  return null
}
