export interface LatestCompletedPipelineRun {
  id: string
  run_date: string | null
  status: string | null
  market_regime: string | null
  started_at: string | null
  completed_at: string | null
}

export interface LatestCompletedRegimeSnapshot {
  run_id: string
  date: string | null
  regime: string | null
  spy_close: number | null
  spy_sma50: number | null
  spy_sma200: number | null
  spy_adx14: number | null
  spy_vol_percentile_252d: number | null
  spy_drawdown_from_high_pct: number | null
}

export async function loadLatestCompletedRunContext(
  supabase: any,
): Promise<{
  run: LatestCompletedPipelineRun | null
  regime: LatestCompletedRegimeSnapshot | null
}> {
  const { data: latestRun, error: latestRunError } = await supabase
    .from('pipeline_runs')
    .select('id, run_date, status, market_regime, started_at, completed_at')
    .eq('status', 'completed')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (latestRunError) {
    throw new Error(latestRunError.message)
  }

  if (!latestRun?.id) {
    return {
      run: null,
      regime: null,
    }
  }

  const { data: regimeSnapshot, error: regimeError } = await supabase
    .from('regime_snapshots')
    .select(
      'run_id, date, regime, spy_close, spy_sma50, spy_sma200, spy_adx14, spy_vol_percentile_252d, spy_drawdown_from_high_pct',
    )
    .eq('run_id', latestRun.id)
    .limit(1)
    .maybeSingle()

  if (regimeError) {
    throw new Error(regimeError.message)
  }

  return {
    run: latestRun as LatestCompletedPipelineRun,
    regime: regimeSnapshot
      ? ({
          ...regimeSnapshot,
          date: regimeSnapshot.date ?? latestRun.run_date,
          regime: regimeSnapshot.regime ?? latestRun.market_regime,
        } satisfies LatestCompletedRegimeSnapshot)
      : ({
          run_id: latestRun.id,
          date: latestRun.run_date,
          regime: latestRun.market_regime,
          spy_close: null,
          spy_sma50: null,
          spy_sma200: null,
          spy_adx14: null,
          spy_vol_percentile_252d: null,
          spy_drawdown_from_high_pct: null,
        } satisfies LatestCompletedRegimeSnapshot),
  }
}
