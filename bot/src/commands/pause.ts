import type { Context } from 'grammy'
import { supabase } from '../lib/supabase'

const DEFAULT_STRATEGY_ID = process.env.STRATEGY_ID ?? '00000000-0000-0000-0000-000000000010'
const DEFAULT_PAUSE_MS = 7 * 24 * 60 * 60 * 1000

function parsePauseDuration(messageText: string | undefined) {
  const rawArgument = messageText?.trim().split(/\s+/).slice(1).join(' ') ?? ''

  if (!rawArgument) {
    return {
      until: new Date(Date.now() + DEFAULT_PAUSE_MS),
      label: '7d',
    }
  }

  const match = rawArgument.match(/^(\d+)(m|h|d)$/i)
  if (!match) {
    return null
  }

  const amount = Number(match[1])
  const unit = match[2].toLowerCase()
  const multiplier =
    unit === 'm'
      ? 60 * 1000
      : unit === 'h'
        ? 60 * 60 * 1000
        : 24 * 60 * 60 * 1000

  return {
    until: new Date(Date.now() + amount * multiplier),
    label: `${amount}${unit}`,
  }
}

export async function pauseCommand(ctx: Context) {
  const parsed = parsePauseDuration(ctx.message?.text)
  if (!parsed) {
    return ctx.reply('Usage: /pause [90m|4h|2d]')
  }

  const { error } = await supabase
    .from('strategies')
    .update({ paused_until: parsed.until.toISOString() })
    .eq('id', DEFAULT_STRATEGY_ID)

  if (error) {
    return ctx.reply(`Failed to pause engine: ${error.message}`)
  }

  await ctx.reply(
    `Engine paused for ${parsed.label}. Trading will stay paused until ${parsed.until.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'UTC',
    })} UTC, or until you send /resume.`,
  )
}
