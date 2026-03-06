# ArqueoFlow

Telegram bot for **Route Cash Count** (Arqueo de Rutas).  
Records cash-by-denomination tallies per bus route, stores them in SQLite, and allows CSV export.

---

## Features

- Select a route from a fixed list (10081, 10083, 10090, 10091, 10094, 10547, 10548, 10565, 10026, 10027, 10076).
- Perform a cash count by denomination ($1000, $500, $200, $100, $50, $25, $20, $10, $5, $1).
- Save completed arqueos to SQLite.
- List and delete your own arqueos for the current day.
- Admin `/export` command to download all data as CSV.

---

## Project structure

```
index.js        – Bot entry point (state machine, handlers)
db.js           – SQLite initialisation and CRUD helpers
utils.js        – Formatting, keyboard builders, CSV serialiser
package.json
.env.example    – Required environment variables
arqueo.db       – Auto-created SQLite file (gitignored)
```

---

## VPS Deployment

### 1 – Install Node.js (v18 LTS recommended)

```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v   # should print v18.x.x
```

### 2 – Install pm2

```bash
sudo npm install -g pm2
```

### 3 – Clone and configure the bot

```bash
git clone https://github.com/almeles/ArqueoFlow.git
cd ArqueoFlow
npm install

cp .env.example .env
nano .env   # fill in BOT_TOKEN and ADMIN_IDS
```

### 4 – Start with pm2

```bash
pm2 start index.js --name arqueoflow
pm2 save
pm2 startup   # follow the printed command to enable auto-start on reboot
```

### Useful pm2 commands

| Command | Description |
|---------|-------------|
| `pm2 status` | Show running processes |
| `pm2 logs arqueoflow` | Tail live logs |
| `pm2 restart arqueoflow` | Restart after config change |
| `pm2 stop arqueoflow` | Stop the bot |

---

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `BOT_TOKEN` | ✅ | Telegram bot token from @BotFather |
| `ADMIN_IDS` | ⬜ | Comma-separated Telegram user IDs with admin rights |
| `DB_PATH` | ⬜ | Path to SQLite file (default: `./arqueo.db`) |

---

## Bot commands

| Command / Button | Description |
|-----------------|-------------|
| `/start` | Show main menu |
| `/help` | List available commands |
| `💵 Nuevo Arqueo` | Start a new cash count session |
| `📄 Mis Arqueos Hoy` | List today's saved arqueos |
| `/export` | *(Admin only)* Download all arqueos as CSV |