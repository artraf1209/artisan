import { supabase } from './supabase'

type Level = 'debug' | 'info' | 'warn' | 'error'

async function log(level: Level, message: string, context?: Record<string, unknown>) {
  const entry = { level, source: 'engine', message, context: context ?? null }
  console[level === 'debug' ? 'log' : level](`[${level.toUpperCase()}] ${message}`, context ?? '')
  await supabase.from('logs').insert(entry)
}

export const logger = {
  debug: (msg: string, ctx?: Record<string, unknown>) => log('debug', msg, ctx),
  info: (msg: string, ctx?: Record<string, unknown>) => log('info', msg, ctx),
  warn: (msg: string, ctx?: Record<string, unknown>) => log('warn', msg, ctx),
  error: (msg: string, ctx?: Record<string, unknown>) => log('error', msg, ctx),
}
