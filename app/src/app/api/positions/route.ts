import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { loadOpenPositions } from '@/lib/positions'

export async function GET() {
  try {
    const supabase = await createServerClient()
    const positions = await loadOpenPositions(supabase as any)
    return NextResponse.json(positions)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load positions.' },
      { status: 500 },
    )
  }
}
