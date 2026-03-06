'use strict';

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { initDB } = require('./db');
const { registerHandlers } = require('./handlers');

const TOKEN = process.env.TELEGRAM_TOKEN;

if (!TOKEN) {
  console.error('❌  TELEGRAM_TOKEN is not set. Please configure it in your .env file.');
  process.exit(1);
}

(async () => {
  try {
    // Initialize SQLite database (creates tables if needed)
    await initDB();
    console.log('✅  Database initialized (arqueo.db)');

    // Create bot in polling mode (no webhook required for VPS)
    const bot = new TelegramBot(TOKEN, { polling: true });

    // Register all message and callback handlers
    registerHandlers(bot);

    console.log('🤖  ArqueoFlow bot is running. Press Ctrl+C to stop.');

    // Graceful shutdown
    const shutdown = () => {
      console.log('\n🛑  Stopping bot...');
      bot.stopPolling();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (err) {
    console.error('❌  Failed to start bot:', err);
    process.exit(1);
  }
})();
