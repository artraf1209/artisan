import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createServerClient } from '@/lib/supabase/server'
import {
  applySubmittedSettingsValues,
  buildEffectiveStrategySettings,
  buildStrategySettingsUpdatePatch,
  getChangedSettings,
  normalizeSubmittedSettingsInput,
  validateStrategySettings,
  type StrategySettingsRow,
} from '@/lib/settings'

type UpdateBody = {
  strategy_id?: string
  values?: Record<string, unknown>
}

class RouteError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly fieldErrors?: Record<string, string>,
  ) {
    super(message)
  }
}

const STRATEGY_SELECT =
  'id, name, active, risk_params, screening_params, timing_params, position_mgmt_params, performance_goals'

async function loadStrategy(supabase: any, strategyId?: string) {
  const query = strategyId
    ? supabase.from('strategies').select(STRATEGY_SELECT).eq('id', strategyId).limit(1)
    : supabase
        .from('strategies')
        .select(STRATEGY_SELECT)
        .eq('active', true)
        .order('created_at', { ascending: false })
        .limit(1)

  const { data, error } = await query.maybeSingle()
  if (error || !data) {
    throw new RouteError(error?.message ?? 'Strategy row not found.', 404)
  }

  return data as StrategySettingsRow & { id: string }
}

async function resolveActor() {
  try {
    const viewer = (await createServerClient()) as any
    const { data } = await viewer.auth.getUser()
    return data?.user?.email ?? data?.user?.id ?? 'settings-update-route'
  } catch {
    return 'settings-update-route'
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as UpdateBody
    if (!body.values || typeof body.values !== 'object' || Array.isArray(body.values)) {
      throw new RouteError('A values object is required.', 400)
    }

    const normalized = normalizeSubmittedSettingsInput(body.values)
    if (Object.keys(normalized.errors).length > 0) {
      throw new RouteError('Validation failed.', 400, normalized.errors)
    }

    const supabase = createAdminClient() as any
    const strategy = await loadStrategy(supabase, body.strategy_id)
    const currentConfig = buildEffectiveStrategySettings(strategy)
    const nextConfig = applySubmittedSettingsValues(currentConfig, normalized.parsed)
    const validationErrors = validateStrategySettings(nextConfig)

    if (Object.keys(validationErrors).length > 0) {
      throw new RouteError('Validation failed.', 400, validationErrors)
    }

    const changes = getChangedSettings(currentConfig, nextConfig)
    if (changes.length === 0) {
      return NextResponse.json({
        ok: true,
        changed_fields: 0,
        message: 'No settings changed.',
      })
    }

    const patch = buildStrategySettingsUpdatePatch(strategy, changes, nextConfig)
    const { error: updateError } = await supabase
      .from('strategies')
      .update(patch)
      .eq('id', strategy.id)

    if (updateError) {
      throw new RouteError(updateError.message, 500)
    }

    const changedAt = new Date().toISOString()
    const actor = await resolveActor()
    const auditRows = changes.map((change) => ({
      actor,
      action: 'config_update',
      entity: 'strategies',
      entity_id: strategy.id,
      payload: {
        param: change.field.key,
        old_value: change.oldValue,
        new_value: change.newValue,
        changed_at: changedAt,
      },
    }))

    const { error: auditError } = await supabase.from('audit_log').insert(auditRows)
    if (auditError) {
      throw new RouteError(auditError.message, 500)
    }

    return NextResponse.json({
      ok: true,
      changed_fields: changes.length,
      last_modified: changedAt,
      message: `Saved ${changes.length} ${changes.length === 1 ? 'setting' : 'settings'}.`,
    })
  } catch (error) {
    if (error instanceof RouteError) {
      return NextResponse.json(
        {
          error: error.message,
          ...(error.fieldErrors ? { errors: error.fieldErrors } : {}),
        },
        { status: error.status },
      )
    }

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to update settings.',
      },
      { status: 500 },
    )
  }
}
