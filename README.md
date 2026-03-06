# ArqueoFlow — Telegram Bot

A lightweight Telegram bot for managing route accounting directly within Telegram using Inline Keyboards. No Docker, no cloud database — just Node.js and a local SQLite file.

---

## Features

- **Inline Keyboard UI** — zero-command interaction after `/start`
- **Nuevo Registro** — add income (*ingreso*) or expense (*gasto*) with amount and description
- **Ver Mis Registros** — list today's records with Edit ✏️ and Delete ❌ buttons per row
- **Cerrar Caja / Exportar** — generates a CSV file and sends it directly to the chat with a daily summary
- **SQLite storage** — single `arqueo.db` file, no external database required

---

## Tech Stack

| Package | Purpose |
|---|---|
| `node-telegram-bot-api` | Telegram Bot API client |
| `sqlite3` | Local SQLite database |
| `csv-writer` | CSV export generation |
| `dotenv` | Environment variable management |

---

## File Structure

```
arqueoflow/
├── src/
│   ├── index.js      # Entry point — initialises DB & bot
│   ├── db.js         # SQLite schema + CRUD helpers
│   └── handlers.js   # All bot logic and inline keyboard flows
├── .env.example      # Environment variable template
├── .gitignore
├── package.json
└── README.md
```

---

## Prerequisites

- **Node.js 16+** — install via `nvm` or the NodeSource repository
- A **Telegram Bot Token** from [@BotFather](https://t.me/BotFather)

---

## Installation & Setup on a VPS (Ubuntu/Debian)

### 1. Install Node.js (if not already installed)

```bash
# Using NodeSource (Node 20 LTS)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify
node -v   # should print v20.x.x
npm -v
```

### 2. Clone the repository

```bash
git clone https://github.com/almeles/ArqueoFlow.git
cd ArqueoFlow
```

### 3. Install dependencies

```bash
npm install
```

### 4. Configure environment variables

```bash
cp .env.example .env
nano .env          # or vim .env
```

Set your bot token:

```
TELEGRAM_TOKEN=your_telegram_bot_token_here
```

### 5. Run the bot

**Direct (for testing):**

```bash
node src/index.js
```

**With PM2 (recommended for production):**

```bash
# Install PM2 globally
sudo npm install -g pm2

# Start the bot
pm2 start src/index.js --name arqueoflow

# Save the process list so it restarts on reboot
pm2 save
pm2 startup    # follow the printed command

# Monitor
pm2 logs arqueoflow
pm2 status
```

---

## Usage

1. Open the bot in Telegram and send `/start`.
2. The main menu appears with three options:

   | Button | Action |
   |---|---|
   | ➕ Nuevo Registro | Start the registration flow |
   | 👀 Ver Mis Registros | List today's records |
   | 📉 Cerrar Caja / Exportar | Get daily summary + CSV export |

3. Follow the on-screen prompts — all interaction is handled via inline buttons and typed values.

---

## Database

Records are stored in `arqueo.db` (SQLite) next to the project root. The schema is created automatically on first run:

```sql
CREATE TABLE records (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  username   TEXT,
  type       TEXT    NOT NULL,   -- 'ingreso' | 'gasto'
  amount     REAL    NOT NULL,
  concept    TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);
```

---

## Updating

```bash
git pull
npm install       # install any new packages
pm2 restart arqueoflow
```

---

## License

MIT
