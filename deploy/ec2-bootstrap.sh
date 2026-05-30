#!/usr/bin/env bash
# Bootstrap script for a fresh Ubuntu 24.04 EC2 instance (c7i.2xlarge recommended).
# Run as root or with sudo.

set -euo pipefail

echo "=== Trading Engine EC2 Bootstrap ==="

# ── Docker ────────────────────────────────────────────────────────────────────
if ! command -v docker &>/dev/null; then
  echo "Installing Docker..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
fi

if ! command -v docker-compose &>/dev/null; then
  echo "Installing docker-compose..."
  curl -SL "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" \
    -o /usr/local/bin/docker-compose
  chmod +x /usr/local/bin/docker-compose
fi

# ── Clone / pull repo ─────────────────────────────────────────────────────────
REPO_DIR="/opt/trading-engine"
if [ -d "$REPO_DIR/.git" ]; then
  echo "Pulling latest..."
  git -C "$REPO_DIR" pull
else
  echo "Cloning repo..."
  git clone https://github.com/notandruu/protoperps.git "$REPO_DIR"
fi

# ── Environment ───────────────────────────────────────────────────────────────
cd "$REPO_DIR"
if [ ! -f .env ]; then
  cp .env.example .env
  echo "IMPORTANT: Edit .env before starting (set TRADER_ID, etc.)"
fi

# ── nginx ─────────────────────────────────────────────────────────────────────
if ! command -v nginx &>/dev/null; then
  apt-get install -y nginx
fi
cp "$REPO_DIR/deploy/nginx.conf" /etc/nginx/sites-available/trading-engine
ln -sf /etc/nginx/sites-available/trading-engine /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# ── Start stack ───────────────────────────────────────────────────────────────
cd "$REPO_DIR/infra"
docker-compose -f docker-compose.yml pull 2>/dev/null || true
docker-compose -f docker-compose.yml up -d --build

echo ""
echo "=== Stack started ==="
echo "  Dashboard:  http://$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4)"
echo "  API:        http://$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4)/api"
echo "  API docs:   http://$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4)/api/docs"
