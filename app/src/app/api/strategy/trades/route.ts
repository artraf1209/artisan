import { NextRequest, NextResponse } from 'next/server'
import { buildActionableShortlistRows } from '@/lib/actionable-shortlist'
import { loadLatestCompletedRunContext } from '@/lib/latest-completed-run'
import { createServerClient } from '@/lib/supabase/server'
import { enterEligibleRankCutoff } from '@/lib/strategy'

function firstStrategyId(searchParams: URLSearchParams) {
  const value = searchParams.get('strategy')
  return value?.trim() || null
}

function toNumber(value: unknown) {
  if (value == null || value === '') {
    return null
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
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

    const { regime: latestRegime } = await loadLatestCompletedRunContext(supabase)

    if (!selectedStrategy || !latestRegime?.run_id) {
      return NextResponse.json({
        regime: latestRegime?.regime ?? null,
        cutoff: null,
        shortlist: [],
        entry_gates: [],
      })
    }

    const shortlistSize = Number(selectedStrategy.screening_params?.shortlist_size ?? 50)
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
        .order('rank', { ascending: true }),
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

    const factorRows = ((factorResult.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
        symbol: String(row.symbol),
        sector: (row.sector as string | null) ?? null,
        rank: toNumber(row.rank),
        composite_z: toNumber(row.composite_z),
        value_z: toNumber(row.value_z),
        value_prev: toNumber(row.value_prev),
        quality_z: toNumber(row.quality_z),
        quality_prev: toNumber(row.quality_prev),
        momentum_z: toNumber(row.momentum_z),
        momentum_prev: toNumber(row.momentum_prev),
        low_vol_z: toNumber(row.low_vol_z),
        low_vol_prev: toNumber(row.low_vol_prev),
        growth_z: toNumber(row.growth_z),
        growth_prev: toNumber(row.growth_prev),
        hard_filter_pass: Boolean(row.hard_filter_pass),
      }))

    const entryRows = ((entryResult.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      symbol: String(row.symbol),
      gate_market: row.gate_market as boolean | null,
      gate_trend: row.gate_trend as boolean | null,
      gate_confirmed: Boolean(row.gate_confirmed),
      setup_type: (row.setup_type as string | null) ?? null,
      entry_price: toNumber(row.entry_price),
      stop_price: toNumber(row.stop_price),
      target_price: toNumber(row.target_price),
      r_multiple: toNumber(row.r_multiple),
      effective_horizon_days: toNumber(row.effective_horizon_days),
      actionable: Boolean(row.actionable),
    }))

    const shortlist = buildActionableShortlistRows(factorRows, entryRows, shortlistSize).map((row) => ({
      ...row,
      actionable: true,
      enter_eligible: row.shortlistRank <= cutoff,
    }))

    const shortlistMetaBySymbol = new Map(
      shortlist.map((row) => [row.symbol, row]),
    )

    const entryGates = entryRows
      .filter((row) => shortlistMetaBySymbol.has(row.symbol))
      .map((row) => ({
        ...row,
        shortlist_rank: shortlistMetaBySymbol.get(row.symbol)?.shortlistRank ?? null,
        factor_rank: shortlistMetaBySymbol.get(row.symbol)?.rank ?? null,
        composite_z: shortlistMetaBySymbol.get(row.symbol)?.composite_z ?? null,
        actionable: true,
        enter_eligible: (shortlistMetaBySymbol.get(row.symbol)?.shortlistRank ?? Number.MAX_SAFE_INTEGER) <= cutoff,
      }))
      .sort(
        (left, right) =>
          (left.shortlist_rank ?? Number.MAX_SAFE_INTEGER) -
          (right.shortlist_rank ?? Number.MAX_SAFE_INTEGER),
      )

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
