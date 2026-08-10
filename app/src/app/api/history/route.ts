import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { loadDecisionHistory } from '@/lib/decision-history'

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const supabase = (await createServerClient()) as any
    const result = await loadDecisionHistory(supabase, {
      symbol: searchParams.get('symbol') ?? undefined,
      setup_type: searchParams.get('setup_type') ?? undefined,
      regime: searchParams.get('regime') ?? undefined,
      resolution: searchParams.get('resolution') ?? undefined,
      mode: searchParams.get('mode') ?? undefined,
    })

    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load decision history.' },
      { status: 500 },
    )
  }
}
