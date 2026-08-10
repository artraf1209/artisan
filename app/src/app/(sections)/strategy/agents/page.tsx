import AgentConfigsEditor from '@/components/strategy/AgentConfigsEditor'
import { buildAgentConfigGroups } from '@/lib/agent-configs'
import { createServerClient } from '@/lib/supabase/server'
import type { AgentConfig } from '@/types'

export const dynamic = 'force-dynamic'

export default async function StrategyAgentsPage() {
  const supabase = (await createServerClient()) as any
  const { data, error } = await supabase
    .from('agent_configs')
    .select('id, agent_type, model_id, prompt_text, prompt_version, is_active, created_at, updated_at, updated_by')
    .order('created_at', { ascending: false })

  const groups = buildAgentConfigGroups(((data ?? []) as AgentConfig[]) ?? [])

  return (
    <>
      {error ? (
        <p className="rounded-2xl border border-loss/30 bg-loss/10 px-4 py-3 text-sm text-loss">
          {error.message}
        </p>
      ) : null}

      <AgentConfigsEditor groups={groups} />
    </>
  )
}
