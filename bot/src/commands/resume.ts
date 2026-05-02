import type { Context } from 'grammy'
import { supabase } from '../lib/supabase'

export async function resumeCommand(ctx: Context) {
  await supabase.from('logs').insert({
    level: 'info',
    source: 'bot',
    message: 'RESUMED — manual resume via Telegram',
  })
  await ctx.reply('Engine resumed. Trading is active.')
}
