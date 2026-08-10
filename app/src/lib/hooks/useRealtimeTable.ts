'use client'

import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'

/** Subscribes to postgres_changes on one or more tables (optionally filtered)
 * and calls `onChange` for every insert/update/delete. Callers decide what
 * to do on change (refetch, router.refresh(), etc.) — this hook only wires
 * the subscription lifecycle. */
export function useRealtimeTable(tables: string[], onChange: () => void, filter?: string) {
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const key = `${tables.join(',')}::${filter ?? ''}`

  useEffect(() => {
    if (tables.length === 0) {
      return
    }

    const supabase = createClient()
    let channel = supabase.channel(`realtime:${key}`)

    for (const table of tables) {
      channel = channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table, ...(filter ? { filter } : {}) },
        () => onChangeRef.current(),
      )
    }

    channel.subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
}
