import { NextRequest, NextResponse } from 'next/server'
import type { AgentConfig } from '@/types'
import {
  AGENT_CONFIG_MODEL_OPTION_SET,
  AGENT_CONFIG_ORDER,
  nextPromptVersion,
  normalizePromptText,
  type AgentConfigType,
} from '@/lib/agent-configs'
import { createAdminClient } from '@/lib/supabase/admin'
import { createServerClient } from '@/lib/supabase/server'

type UpdateAgentConfigBody = {
  agent_type?: AgentConfigType
  model_id?: string
  prompt_text?: string
  restore_from_id?: string | null
}

class RouteError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message)
  }
}

async function resolveActor() {
  try {
    const viewer = (await createServerClient()) as any
    const { data } = await viewer.auth.getUser()
    return data?.user?.email ?? data?.user?.id ?? 'agent-config-route'
  } catch {
    return 'agent-config-route'
  }
}

async function loadActiveConfig(supabase: any, agentType: AgentConfigType) {
  const { data, error } = await supabase
    .from('agent_configs')
    .select('id, agent_type, model_id, prompt_text, prompt_version, is_active, created_at, updated_at, updated_by')
    .eq('agent_type', agentType)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    throw new RouteError(error.message, 500)
  }

  return (data ?? null) as AgentConfig | null
}

async function loadHistoricalConfig(supabase: any, configId: string, agentType: AgentConfigType) {
  const { data, error } = await supabase
    .from('agent_configs')
    .select('id, agent_type, model_id, prompt_text, prompt_version, is_active, created_at, updated_at, updated_by')
    .eq('id', configId)
    .eq('agent_type', agentType)
    .limit(1)
    .maybeSingle()

  if (error) {
    throw new RouteError(error.message, 500)
  }

  return (data ?? null) as AgentConfig | null
}

async function rollbackActiveState(supabase: any, current: AgentConfig | null, insertedId?: string) {
  if (insertedId) {
    await supabase.from('agent_configs').delete().eq('id', insertedId)
  }

  if (current?.id) {
    await supabase
      .from('agent_configs')
      .update({
        is_active: true,
        updated_at: current.updated_at,
        updated_by: current.updated_by,
      })
      .eq('id', current.id)
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as UpdateAgentConfigBody
    const agentType = body.agent_type

    if (!agentType || !AGENT_CONFIG_ORDER.includes(agentType)) {
      throw new RouteError('A valid agent_type is required.', 400)
    }

    if (!body.model_id || !AGENT_CONFIG_MODEL_OPTION_SET.has(body.model_id)) {
      throw new RouteError('Model must be one of the allow-listed Claude variants.', 400)
    }

    if (typeof body.prompt_text !== 'string') {
      throw new RouteError('A prompt_text string is required.', 400)
    }

    const promptText = normalizePromptText(body.prompt_text)
    if (!promptText) {
      throw new RouteError('Prompt text cannot be empty.', 400)
    }

    const supabase = createAdminClient() as any
    const actor = await resolveActor()
    const current = await loadActiveConfig(supabase, agentType)
    const restoreSource =
      body.restore_from_id != null
        ? await loadHistoricalConfig(supabase, body.restore_from_id, agentType)
        : null

    if (body.restore_from_id && !restoreSource) {
      throw new RouteError('The selected historical version no longer exists.', 404)
    }

    if (
      current &&
      current.model_id === body.model_id &&
      normalizePromptText(current.prompt_text) === promptText
    ) {
      return NextResponse.json({
        ok: true,
        changed: false,
        message: 'No prompt or model changes were detected.',
      })
    }

    const changedAt = new Date().toISOString()

    if (current?.id) {
      const { error: deactivateError } = await supabase
        .from('agent_configs')
        .update({
          is_active: false,
          updated_at: changedAt,
          updated_by: actor,
        })
        .eq('id', current.id)

      if (deactivateError) {
        throw new RouteError(deactivateError.message, 500)
      }
    }

    const nextVersion = nextPromptVersion(current?.prompt_version)
    const { data: inserted, error: insertError } = await supabase
      .from('agent_configs')
      .insert({
        agent_type: agentType,
        model_id: body.model_id,
        prompt_text: promptText,
        prompt_version: nextVersion,
        is_active: true,
        updated_by: actor,
      })
      .select('id, agent_type, model_id, prompt_text, prompt_version, is_active, created_at, updated_at, updated_by')
      .single()

    if (insertError || !inserted) {
      await rollbackActiveState(supabase, current)
      throw new RouteError(insertError?.message ?? 'Failed to insert the new agent config.', 500)
    }

    const { error: auditError } = await supabase.from('audit_log').insert({
      actor,
      action: 'agent_config_update',
      entity: 'agent_configs',
      entity_id: inserted.id,
      payload: {
        agent_type: agentType,
        previous_active_id: current?.id ?? null,
        previous_version: current?.prompt_version ?? null,
        new_version: nextVersion,
        previous_model_id: current?.model_id ?? null,
        new_model_id: body.model_id,
        prompt_changed:
          normalizePromptText(current?.prompt_text ?? '') !== promptText,
        model_changed: current?.model_id !== body.model_id,
        restore_from_id: restoreSource?.id ?? null,
        restore_from_version: restoreSource?.prompt_version ?? null,
        changed_at: changedAt,
      },
    })

    if (auditError) {
      await rollbackActiveState(supabase, current, inserted.id)
      throw new RouteError(auditError.message, 500)
    }

    return NextResponse.json({
      ok: true,
      changed: true,
      message: `${agentType} saved as ${nextVersion}.`,
      agent_config: inserted,
    })
  } catch (error) {
    if (error instanceof RouteError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to update agent config.',
      },
      { status: 500 },
    )
  }
}
