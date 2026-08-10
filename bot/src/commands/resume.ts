import type { Context } from 'grammy'
import { supabase } from '../lib/supabase'

const DEFAULT_STRATEGY_ID = process.env.STRATEGY_ID ?? '00000000-0000-0000-0000-000000000010'

export async function resumeCommand(ctx: Context) {
  const { error } = await supabase
    .from('strategies')
    .update({ paused_until: null })
    .eq('id', DEFAULT_STRATEGY_ID)

  if (error) {
    return ctx.reply(`Failed to resume engine: ${error.message}`)
  }

  await ctx.reply('Engine resumed. Trading is active again.')
}
