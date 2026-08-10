import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { loadOrders } from '@/lib/orders'

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const supabase = (await createServerClient()) as any
    const orders = await loadOrders(supabase, {
      date_from: searchParams.get('date_from') ?? undefined,
      date_to: searchParams.get('date_to') ?? undefined,
      symbol: searchParams.get('symbol') ?? undefined,
      side: (searchParams.get('side') as 'buy' | 'sell' | '') ?? undefined,
    })

    return NextResponse.json(orders)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load order history.' },
      { status: 500 },
    )
  }
}
