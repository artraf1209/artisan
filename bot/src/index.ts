import { Bot } from 'grammy'
import { statusCommand } from './commands/status'
import { tradesCommand } from './commands/trades'
import { pauseCommand } from './commands/pause'
import { resumeCommand } from './commands/resume'

const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN!)

bot.command('start', (ctx) =>
  ctx.reply(
    'Artisan trading bot online.\n\nCommands:\n/status — portfolio summary\n/trades — recent trades\n/pause — halt engine\n/resume — restart engine',
  ),
)

bot.command('status', statusCommand)
bot.command('trades', tradesCommand)
bot.command('pause', pauseCommand)
bot.command('resume', resumeCommand)

bot.catch((err) => {
  console.error('Bot error:', err)
})

console.log('Artisan bot starting...')
bot.start()
