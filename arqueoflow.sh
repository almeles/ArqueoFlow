#!/usr/bin/env bash
# ============================================================
#  ArqueoFlow — Installer / Updater
# ============================================================

set -euo pipefail

# ── ANSI colours ─────────────────────────────────────────────
GREEN='\033[0;32m'
CYAN='\033[0;36m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
RESET='\033[0m'

ok()   { echo -e "${GREEN}[✔]${RESET} $*"; }
info() { echo -e "${CYAN}[i]${RESET} $*"; }
warn() { echo -e "${YELLOW}[!]${RESET} $*"; }
err()  { echo -e "${RED}[✘]${RESET} $*" >&2; }
die()  { err "$*"; exit 1; }

# ── ASCII Art Header ─────────────────────────────────────────
print_header() {
  echo -e "${CYAN}"
  cat << 'EOF'
    _                            ___ _
   / \   _ __ __ _ _   _  ___  / __\ | _____      __
  / _ \ | '__/ _` | | | |/ _ \/ _\ | |/ _ \ \ /\ / /
 / ___ \| | | (_| | |_| |  __/ /   | | (_) \ V  V /
/_/   \_\_|  \__, |\__,_|\___\/    |_|\___/ \_/\_/
              |___/
EOF
  echo -e "${RESET}"
  echo -e "${BOLD}  Cash-Audit Telegram Bot — Automated Installer${RESET}"
  echo -e "  ─────────────────────────────────────────────"
  echo
}

# ── Helpers ───────────────────────────────────────────────────
require_cmd() {
  command -v "$1" &>/dev/null
}

apt_install() {
  sudo apt-get install -y "$@" -qq
}

# ── 1. System Prep ────────────────────────────────────────────
system_prep() {
  info "Updating apt package list…"
  sudo apt-get update -qq

  for pkg in curl git wget; do
    if require_cmd "$pkg"; then
      ok "$pkg is already installed."
    else
      info "Installing $pkg…"
      apt_install "$pkg"
      ok "$pkg installed."
    fi
  done
}

# ── 2. Node.js (v18+) ─────────────────────────────────────────
ensure_node() {
  local required=18

  if require_cmd node; then
    local version
    version=$(node -e "process.stdout.write(process.versions.node.split('.')[0])" 2>/dev/null) || version=0
    if [[ "$version" -ge "$required" ]]; then
      ok "Node.js v$(node --version | tr -d 'v') detected (>= ${required})."
      return
    else
      warn "Node.js v${version} is too old (need >= ${required}). Upgrading…"
    fi
  else
    info "Node.js not found. Installing via NodeSource…"
  fi

  curl -fsSL "https://deb.nodesource.com/setup_${required}.x" | sudo -E bash -
  apt_install nodejs
  ok "Node.js $(node --version) installed."
}

# ── 3. Repo Setup ─────────────────────────────────────────────
setup_repo() {
  local repo_url="https://github.com/almeles/ArqueoFlow.git"
  local folder="ArqueoFlow"

  if [[ -d "$folder" ]]; then
    echo
    warn "The '$folder' directory already exists."
    echo -e "  ${BOLD}[1]${RESET} Update   — git pull (keep .env & data)"
    echo -e "  ${BOLD}[2]${RESET} Reinstall — delete and clone fresh"
    echo
    local choice
    read -rp "$(echo -e "${CYAN}Choose [1/2]:${RESET} ")" choice

    case "$choice" in
      1)
        info "Pulling latest changes…"
        git -C "$folder" pull --ff-only
        ok "Repository updated."
        ;;
      2)
        warn "Deleting '$folder' and re-cloning…"
        rm -rf "$folder"
        git clone "$repo_url" "$folder"
        ok "Repository cloned."
        ;;
      *)
        die "Invalid choice. Aborting."
        ;;
    esac
  else
    info "Cloning ArqueoFlow…"
    git clone "$repo_url" "$folder"
    ok "Repository cloned."
  fi

  cd "$folder"
}

# ── 4. Install Dependencies ───────────────────────────────────
install_deps() {
  info "Installing npm dependencies…"
  npm install --loglevel=error
  ok "Dependencies installed."
}

# ── 5. Configuration (.env) ───────────────────────────────────
configure_env() {
  if [[ -f ".env" ]]; then
    ok ".env file already exists — skipping configuration."
    return
  fi

  echo
  info "Let's configure your bot."
  echo

  local token admin_id

  while true; do
    read -rp "$(echo -e "${CYAN}Enter your TELEGRAM_BOT_TOKEN:${RESET} ")" token
    [[ -n "$token" ]] && break
    err "TELEGRAM_BOT_TOKEN cannot be empty."
  done

  while true; do
    read -rp "$(echo -e "${CYAN}Enter your ADMIN_ID (numeric Telegram user ID):${RESET} ")" admin_id
    [[ "$admin_id" =~ ^[0-9]+$ ]] && break
    err "ADMIN_ID must be a numeric value."
  done

  cat > .env << EOF
TELEGRAM_BOT_TOKEN=${token}
ADMIN_ID=${admin_id}
TIMEZONE=America/Managua
DB_PATH=./arqueo.db
EOF

  ok ".env file created."
}

# ── 6. PM2 Process Management ─────────────────────────────────
setup_pm2() {
  info "Installing PM2 globally…"
  sudo npm install -g pm2 --loglevel=error
  ok "PM2 installed."

  # Stop existing process if running
  if pm2 describe arqueoflow &>/dev/null; then
    info "Stopping existing 'arqueoflow' PM2 process…"
    pm2 stop arqueoflow || true
    pm2 delete arqueoflow || true
  fi

  info "Starting ArqueoFlow with PM2…"
  pm2 start src/index.js --name arqueoflow
  ok "Process started."

  pm2 save
  ok "PM2 process list saved."

  info "Configuring PM2 startup hook…"
  local startup_output startup_cmd
  startup_output=$(pm2 startup 2>&1 || true)

  # Extract the sudo command PM2 prints (e.g. "sudo env PATH=... pm2 startup ...")
  startup_cmd=$(echo "$startup_output" \
    | grep -E "^[[:space:]]*sudo[[:space:]]" \
    | head -n1 \
    | sed 's/^[[:space:]]*//' || true)

  if [[ -n "$startup_cmd" ]]; then
    # Validate the command only contains expected characters before running
    if echo "$startup_cmd" | grep -qE "^sudo[[:space:]]+(env[[:space:]]+)?PATH="; then
      info "Running startup command: ${startup_cmd}"
      eval "$startup_cmd"
      ok "Startup hook configured."
    else
      warn "Unexpected startup command format — please run it manually:"
      echo "  $startup_cmd"
    fi
  else
    warn "If PM2 printed a command above, copy-paste and run it to enable auto-start on reboot."
  fi
}

# ── 7. Validation ─────────────────────────────────────────────
validate() {
  echo
  info "Checking PM2 status…"
  pm2 status

  if pm2 describe arqueoflow 2>/dev/null | grep -q "online"; then
    echo
    ok "${BOLD}ArqueoFlow is ONLINE and running!${RESET}"

    # Try to resolve bot username via Telegram API
    local token
    token=$(grep -E "^TELEGRAM_BOT_TOKEN=" .env 2>/dev/null | cut -d= -f2- || true)

    if [[ -n "$token" ]]; then
      local username
      username=$(curl -sf "https://api.telegram.org/bot${token}/getMe" \
        | sed 's/.*"username":"\([^"]*\)".*/\1/' \
        | grep -v '^{' || true)
      if [[ -n "$username" && "$username" != *"{"* ]]; then
        ok "Bot Username: ${CYAN}@${username}${RESET}"
      fi
    fi

    echo
    echo -e "${GREEN}${BOLD}════════════════════════════════════════${RESET}"
    echo -e "${GREEN}${BOLD}   Installation complete! Bot is live.  ${RESET}"
    echo -e "${GREEN}${BOLD}════════════════════════════════════════${RESET}"
  else
    err "ArqueoFlow does not appear to be online."
    err "Run 'pm2 logs arqueoflow' to inspect errors."
    exit 1
  fi
}

# ── Main ──────────────────────────────────────────────────────
main() {
  print_header
  system_prep
  ensure_node
  setup_repo
  install_deps
  configure_env
  setup_pm2
  validate
}

main "$@"
