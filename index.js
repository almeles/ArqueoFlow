'use strict';

require('dotenv').config({ path: '.env' });
const TelegramBot = require('node-telegram-bot-api');
const { registerHandlers } = require('./src/handlers');

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error('BOT_TOKEN environment variable is required.');
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });
registerHandlers(bot);

console.log('ArqueoFlow bot is running...');
