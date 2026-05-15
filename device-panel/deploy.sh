#!/usr/bin/env bash
###############################################################################
# device-panel VPS deployment script
# - Installs Node.js 20 (if missing)
# - Kills any process holding port 80
# - Copies project to /opt/device-panel
# - Installs npm dependencies
# - Sets up systemd service for auto-start on boot
#
# Usage (run from inside the extracted project directory, as root):
#   sudo bash deploy.sh
###############################################################################

set -euo pipefail

APP_NAME="device-panel"
INSTALL_DIR="/opt/${APP_NAME}"
SERVICE_NAME="${APP_NAME}.service"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}"
APP_PORT=80
NODE_MAJOR=20

log()  { echo -e "\033[1;36m[deploy]\033[0m $*"; }
warn() { echo -e "\033[1;33m[warn]\033[0m  $*"; }
err()  { echo -e "\033[1;31m[error]\033[0m $*" >&2; }

# ─────────────────────────────────────────────────────────────────────────────
# 1. Pre-flight: must be root
# ─────────────────────────────────────────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
  err "Run as root: sudo bash deploy.sh"
  exit 1
fi

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
log "Source directory: ${SRC_DIR}"

if [[ ! -f "${SRC_DIR}/server.js" || ! -f "${SRC_DIR}/package.json" ]]; then
  err "server.js or package.json not found in ${SRC_DIR}"
  err "Run this script from inside the extracted device-panel directory."
  exit 1
fi

# ─────────────────────────────────────────────────────────────────────────────
# 2. Detect package manager (dnf > yum > apt-get)
# ─────────────────────────────────────────────────────────────────────────────
if   command -v dnf     >/dev/null 2>&1; then PKG="dnf"
elif command -v yum     >/dev/null 2>&1; then PKG="yum"
elif command -v apt-get >/dev/null 2>&1; then PKG="apt-get"
else
  err "No supported package manager (dnf/yum/apt-get) found."
  exit 1
fi
log "Using package manager: ${PKG}"

# ─────────────────────────────────────────────────────────────────────────────
# 3. Install Node.js ${NODE_MAJOR} if missing or too old
# ─────────────────────────────────────────────────────────────────────────────
need_node_install=1
if command -v node >/dev/null 2>&1; then
  CUR_MAJOR="$(node -v | sed -E 's/^v([0-9]+).*/\1/')"
  if [[ "${CUR_MAJOR}" -ge "${NODE_MAJOR}" ]]; then
    log "Node.js v${CUR_MAJOR} already installed (>= v${NODE_MAJOR}) — skipping."
    need_node_install=0
  else
    warn "Node.js v${CUR_MAJOR} is older than required v${NODE_MAJOR}, upgrading."
  fi
fi

if [[ "${need_node_install}" -eq 1 ]]; then
  log "Installing Node.js ${NODE_MAJOR}..."
  if [[ "${PKG}" == "dnf" || "${PKG}" == "yum" ]]; then
    curl -fsSL "https://rpm.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
    ${PKG} install -y nodejs
  else
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
    apt-get install -y nodejs
  fi
fi

log "Node:  $(node -v)"
log "npm:   $(npm -v)"

# ─────────────────────────────────────────────────────────────────────────────
# 4. Kill any process using port ${APP_PORT}
# ─────────────────────────────────────────────────────────────────────────────
log "Checking for processes on port ${APP_PORT}..."

# Stop existing systemd unit first (clean shutdown)
if systemctl list-unit-files | grep -q "^${SERVICE_NAME}"; then
  log "Stopping existing ${SERVICE_NAME}..."
  systemctl stop "${SERVICE_NAME}" || true
fi

# Install lsof / fuser if missing for fallback
if ! command -v lsof >/dev/null 2>&1 && ! command -v fuser >/dev/null 2>&1; then
  if [[ "${PKG}" == "apt-get" ]]; then
    apt-get install -y lsof psmisc || true
  else
    ${PKG} install -y lsof psmisc || true
  fi
fi

PIDS=""
if command -v lsof >/dev/null 2>&1; then
  PIDS="$(lsof -ti tcp:${APP_PORT} || true)"
elif command -v fuser >/dev/null 2>&1; then
  PIDS="$(fuser ${APP_PORT}/tcp 2>/dev/null | tr -s ' ' '\n' | grep -E '^[0-9]+$' || true)"
elif command -v ss >/dev/null 2>&1; then
  PIDS="$(ss -ltnp "sport = :${APP_PORT}" 2>/dev/null \
          | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u || true)"
fi

if [[ -n "${PIDS}" ]]; then
  warn "Killing PIDs on port ${APP_PORT}: ${PIDS}"
  for pid in ${PIDS}; do
    kill -TERM "${pid}" 2>/dev/null || true
  done
  sleep 2
  for pid in ${PIDS}; do
    if kill -0 "${pid}" 2>/dev/null; then
      warn "PID ${pid} still alive — sending SIGKILL"
      kill -KILL "${pid}" 2>/dev/null || true
    fi
  done
else
  log "Port ${APP_PORT} is free."
fi

# ─────────────────────────────────────────────────────────────────────────────
# 5. Copy project to ${INSTALL_DIR} (via /tmp staging — avoids the
#    "source inside destination" disaster where rsync --delete eats the
#    source files when the user extracts the tarball INTO ${INSTALL_DIR}.)
# ─────────────────────────────────────────────────────────────────────────────
log "Deploying to ${INSTALL_DIR}..."
mkdir -p "${INSTALL_DIR}"

# Resolve real paths so we can detect overlap reliably.
REAL_SRC="$(readlink -f "${SRC_DIR}")"
REAL_DST="$(readlink -f "${INSTALL_DIR}")"

if [[ "${REAL_SRC}" == "${REAL_DST}" ]]; then
  log "Source already at ${INSTALL_DIR} — skipping copy."
else
  # Always stage in /tmp first, then sync from the staging copy.
  # This way ${SRC_DIR} can safely live inside ${INSTALL_DIR}.
  STAGE_DIR="$(mktemp -d /tmp/device-panel-stage.XXXXXX)"
  log "Staging files in ${STAGE_DIR}..."
  trap 'rm -rf "${STAGE_DIR}"' EXIT

  (cd "${SRC_DIR}" && tar --exclude='./.git' \
                          --exclude='./node_modules' \
                          --exclude='./android-sdk' \
                          --exclude='./builds' \
                          --exclude='./*.tar.gz' \
                          -cf - .) | (cd "${STAGE_DIR}" && tar -xf -)

  # Make sure rsync is available; install if not.
  if ! command -v rsync >/dev/null 2>&1; then
    warn "rsync missing — installing..."
    ${PKG} install -y rsync || true
  fi

  log "Syncing staged files to ${INSTALL_DIR}..."
  if command -v rsync >/dev/null 2>&1; then
    # NOTE: keep node_modules in destination intact (faster re-deploy).
    rsync -a --delete \
      --exclude 'node_modules' \
      "${STAGE_DIR}/" "${INSTALL_DIR}/"
  else
    # rsync still unavailable — manual copy (preserves node_modules).
    (cd "${STAGE_DIR}" && tar -cf - .) | (cd "${INSTALL_DIR}" && tar -xf -)
  fi

  rm -rf "${STAGE_DIR}"
  trap - EXIT

  # Clean up the leftover nested folder if user extracted inside ${INSTALL_DIR}.
  case "${REAL_SRC}" in
    "${REAL_DST}"/*)
      log "Removing leftover extraction folder: ${REAL_SRC}"
      rm -rf "${REAL_SRC}"
      ;;
  esac
fi

# ─────────────────────────────────────────────────────────────────────────────
# 6. Install npm dependencies (production)
# ─────────────────────────────────────────────────────────────────────────────
log "Installing npm dependencies in ${INSTALL_DIR}..."
cd "${INSTALL_DIR}"
npm install --omit=dev --no-audit --no-fund

# ─────────────────────────────────────────────────────────────────────────────
# 7. Allow Node.js to bind privileged port 80 without root (optional safety)
# ─────────────────────────────────────────────────────────────────────────────
if command -v setcap >/dev/null 2>&1; then
  NODE_BIN="$(readlink -f "$(command -v node)")"
  setcap 'cap_net_bind_service=+ep' "${NODE_BIN}" 2>/dev/null || true
  log "Granted CAP_NET_BIND_SERVICE to ${NODE_BIN}"
fi

# ─────────────────────────────────────────────────────────────────────────────
# 8. Create systemd unit
# ─────────────────────────────────────────────────────────────────────────────
log "Writing ${SERVICE_FILE}..."
cat > "${SERVICE_FILE}" <<EOF
[Unit]
Description=device-panel Node.js server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=${INSTALL_DIR}
ExecStart=$(command -v node) ${INSTALL_DIR}/server.js
Restart=always
RestartSec=3
StandardOutput=journal
StandardError=journal
Environment=NODE_ENV=production
Environment=PORT=${APP_PORT}
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
EOF

# ─────────────────────────────────────────────────────────────────────────────
# 9. Enable and start
# ─────────────────────────────────────────────────────────────────────────────
log "Reloading systemd & enabling ${SERVICE_NAME}..."
systemctl daemon-reload
systemctl enable "${SERVICE_NAME}"
systemctl restart "${SERVICE_NAME}"

sleep 2
if systemctl is-active --quiet "${SERVICE_NAME}"; then
  log "${SERVICE_NAME} is RUNNING."
else
  err "${SERVICE_NAME} failed to start. Recent logs:"
  journalctl -u "${SERVICE_NAME}" -n 40 --no-pager || true
  exit 1
fi

# ─────────────────────────────────────────────────────────────────────────────
# 10. Done
# ─────────────────────────────────────────────────────────────────────────────
PUB_IP="$(curl -s --max-time 3 https://checkip.amazonaws.com 2>/dev/null || echo '<server-ip>')"
log "─────────────────────────────────────────────────────────"
log "Deployment complete!"
log "  Install dir : ${INSTALL_DIR}"
log "  Service     : ${SERVICE_NAME}"
log "  Port        : ${APP_PORT}"
log "  URL         : http://${PUB_IP}/"
log ""
log "Useful commands:"
log "  systemctl status  ${SERVICE_NAME}"
log "  systemctl restart ${SERVICE_NAME}"
log "  journalctl -u ${SERVICE_NAME} -f"
log "─────────────────────────────────────────────────────────"
