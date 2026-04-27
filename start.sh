#!/usr/bin/env bash
set -e

echo ""
echo " =========================================="
echo "  AI GATEWAY - Starting..."
echo " =========================================="
echo ""

# Copy .env if not exists
if [ ! -f "server/.env" ]; then
  if [ -f ".env.example" ]; then
    cp .env.example server/.env
    echo " [INFO] Created server/.env from .env.example"
    echo " [WARN] Edit server/.env to set your ADMIN_PASSWORD!"
    echo ""
  fi
fi

# Install server deps
if [ ! -d "server/node_modules" ]; then
  echo " [INFO] Installing server dependencies..."
  (cd server && npm install)
  echo ""
fi

# Install dashboard deps
if [ ! -d "dashboard/node_modules" ]; then
  echo " [INFO] Installing dashboard dependencies..."
  (cd dashboard && npm install)
  echo ""
fi

# Build dashboard
echo " [INFO] Building dashboard..."
(cd dashboard && npm run build) || echo " [WARN] Dashboard build failed"

echo ""
echo " [OK] Starting gateway on http://0.0.0.0:3000"
echo " [OK] Dashboard: http://localhost:3000"
echo " [OK] Press Ctrl+C to stop"
echo ""

cd server && npm run dev
