import { Bot } from 'grammy'
import { statusCommand } from './commands/status'
import { tradesCommand } from './commands/trades'
import { pauseCommand } from './commands/pause'
import { resumeCommand } from './commands/resume'

const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN!)

bot.command('start', (ctx) =>
  ctx.reply(
    'ATLAS trading bot online.\n\nCommands:\n/status — regime, equity, drawdown, and pause state\n/trades — open positions with unrealized P&L\n/pause [90m|4h|2d] — halt the v2 pipeline\n/resume — clear the pause and restart trading',
  ),
)

bot.command('status', statusCommand)
bot.command('trades', tradesCommand)
bot.command('pause', pauseCommand)
bot.command('resume', resumeCommand)

bot.catch((err) => {
  console.error('Bot error:', err)
})

console.log('ATLAS bot starting...')
bot.start()
