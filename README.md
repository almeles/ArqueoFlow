# ArqueoFlow

Telegram bot for daily cash reconciliation (*Arqueo*) with multi-user support, currency conversion, and target-amount tracking.

## Features

- **Auth**: Users register via `/start`. Admin approves/rejects pending users. Admin IDs are set via `ADMIN_IDS` env variable.
- **Routes**: Admin creates routes and assigns them to users.
- **Currency Rates** (`💱 Tasas de Cambio`): Admin sets NIO-per-unit exchange rates (e.g. USD → NIO). Foreign currency amounts entered during an arqueo are automatically converted.
- **Daily Targets** (`💰 Fijar Monto Liquidación`): Admin sets a target payout amount (in NIO/Córdobas) per route per day.
- **Arqueo Flow**: Users count bills and coins denomination-by-denomination. Optionally add foreign currency amounts (converted at stored rates). A reconciliation summary is shown:
  - **Total Arqueado** — actual cash counted (converted to NIO)
  - **Total Esperado** — target set by admin for today's route
  - **Diferencia** — difference, labelled as `✅ CUADRADO`, `❌ FALTANTE`, or `⚠️ SOBRANTE`

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env and set:
#   TELEGRAM_TOKEN=<your_bot_token_from_BotFather>
#   ADMIN_IDS=<comma-separated_Telegram_user_IDs>

# 3. Start the bot
npm start

# Development (auto-restart on file change)
npm run dev
```

## Project Structure

```
arqueoflow/
├── src/
│   ├── index.js   # Bot handlers and conversation state machine
│   └── db.js      # SQLite schema and query helpers
├── data/          # SQLite database files (auto-created, git-ignored)
├── .env.example
└── package.json
```

## Database Schema

| Table | Purpose |
|-------|---------|
| `users` | Registered Telegram users with role (`pending`/`user`/`admin`/`rejected`) and assigned route |
| `routes` | Named routes that users can be assigned to |
| `currency_rates` | Exchange rates (e.g. `USD → NIO`) set by admin |
| `arqueos` | Persisted arqueo records with denomination JSON and NIO total |
| `daily_targets` | Per-route daily liquidation targets (NIO), unique on `(date, route_id)` |
