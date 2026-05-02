import type { Context } from 'grammy'
import { supabase } from '../lib/supabase'

export async function pauseCommand(ctx: Context) {
  await supabase.from('logs').insert({
    level: 'info',
    source: 'bot',
    message: 'PAUSED — manual pause via Telegram',
  })
  await ctx.reply('Engine paused. Use /resume to restart trading.')
}
