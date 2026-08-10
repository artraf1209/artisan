import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { enterEligibleRankCutoff } from '@/lib/strategy'

function firstStrategyId(searchParams: URLSearchParams) {
  const value = searchParams.get('strategy')
  return value?.trim() || null
}

export async function GET(request: NextRequest) {
  try {
    const supabase = (await createServerClient()) as any
    const requestedStrategyId = firstStrategyId(request.nextUrl.searchParams)

    const { data: strategiesData } = await supabase
      .from('strategies')
      .select('id, screening_params')
      .order('created_at', { ascending: false })

    const strategies = (strategiesData ?? []) as Array<{
      id: string
      screening_params?: { shortlist_size?: number } | null
    }>
    const selectedStrategy =
      strategies.find((strategy) => strategy.id === requestedStrategyId) ??
      strategies[0] ??
      null

    const { data: latestRegime } = await supabase
      .from('regime_snapshots')
      .select('run_id, regime, date')
      .order('date', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!selectedStrategy || !latestRegime?.run_id) {
      return NextResponse.json({
        regime: latestRegime?.regime ?? null,
        cutoff: null,
        shortlist: [],
        entry_gates: [],
      })
    }

    const shortlistSize = Number(selectedStrategy.screening_params?.shortlist_size ?? 30)
    const cutoff = enterEligibleRankCutoff(latestRegime.regime ?? 'neutral', shortlistSize)

    const [factorResult, entryResult] = await Promise.all([
      supabase
        .from('factor_scores')
        .select(
          'symbol, sector, rank, composite_z, value_z, value_prev, quality_z, quality_prev, momentum_z, momentum_prev, low_vol_z, low_vol_prev, growth_z, growth_prev, hard_filter_pass, run_id',
        )
        .eq('strategy_id', selectedStrategy.id)
        .eq('run_id', latestRegime.run_id)
        .eq('hard_filter_pass', true)
        .not('rank', 'is', null)
        .order('rank', { ascending: true })
        .limit(shortlistSize),
      supabase
        .from('entry_signals')
        .select(
          'symbol, gate_market, gate_trend, gate_confirmed, setup_type, entry_price, stop_price, target_price, r_multiple, effective_horizon_days, actionable',
        )
        .eq('strategy_id', selectedStrategy.id)
        .eq('run_id', latestRegime.run_id)
        .order('symbol'),
    ])

    if (factorResult.error) {
      throw new Error(factorResult.error.message)
    }
    if (entryResult.error) {
      throw new Error(entryResult.error.message)
    }

    const shortlist = ((factorResult.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
        symbol: String(row.symbol),
        sector: (row.sector as string | null) ?? null,
        rank: typeof row.rank === 'number' ? row.rank : Number(row.rank ?? NaN),
        composite_z: row.composite_z ?? null,
        value_z: row.value_z ?? null,
        value_prev: row.value_prev ?? null,
        quality_z: row.quality_z ?? null,
        quality_prev: row.quality_prev ?? null,
        momentum_z: row.momentum_z ?? null,
        momentum_prev: row.momentum_prev ?? null,
        low_vol_z: row.low_vol_z ?? null,
        low_vol_prev: row.low_vol_prev ?? null,
        growth_z: row.growth_z ?? null,
        growth_prev: row.growth_prev ?? null,
        hard_filter_pass: Boolean(row.hard_filter_pass),
        enter_eligible:
          typeof row.rank === 'number'
            ? row.rank <= cutoff
            : Number.isFinite(Number(row.rank)) && Number(row.rank) <= cutoff,
      }))

    const eligibleSymbols = new Set(
      shortlist
        .filter((row) => row.enter_eligible)
        .map((row) => row.symbol as string),
    )

    const entryGates = ((entryResult.data ?? []) as Array<Record<string, unknown>>)
      .filter((row) => eligibleSymbols.has(row.symbol as string))

    return NextResponse.json({
      regime: latestRegime.regime ?? null,
      cutoff,
      shortlist,
      entry_gates: entryGates,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load strategy data.' },
      { status: 500 },
    )
  }
}
