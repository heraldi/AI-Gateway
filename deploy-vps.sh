#!/usr/bin/env bash
# VPS deployment script using Docker Compose
# Usage: bash deploy-vps.sh
set -e

echo ""
echo " ========================================"
echo "  AI GATEWAY - VPS Deploy"
echo " ========================================"

# Check Docker
if ! command -v docker &>/dev/null; then
  echo " [ERROR] Docker not found. Install: https://docs.docker.com/engine/install/"
  exit 1
fi

# Create .env from example if not present
if [ ! -f ".env" ]; then
  cp .env.example .env
  echo " [INFO] Created .env — EDIT IT before continuing!"
  echo ""
  echo " Important settings to change:"
  echo "   ADMIN_PASSWORD=your-secure-password"
  echo "   JWT_SECRET=your-random-secret"
  echo "   EXTENSION_TOKEN=your-extension-token"
  echo ""
  read -p " Press Enter after editing .env to continue..."
fi

# Build and start
echo " [INFO] Building Docker image..."
docker compose build

echo " [INFO] Starting services..."
docker compose up -d

echo ""
echo " [OK] Gateway is running!"
echo " [OK] Dashboard: http://$(hostname -I | awk '{print $1}'):${PORT:-3000}"
echo ""
echo " Useful commands:"
echo "   docker compose logs -f          # view logs"
echo "   docker compose down             # stop"
echo "   docker compose pull && docker compose up -d  # update"
