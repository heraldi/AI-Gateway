@echo off
title AI Gateway
color 0B

echo.
echo  ==========================================
echo   AI GATEWAY - Starting...
echo  ==========================================
echo.

:: Copy .env if not exists
if not exist "server\.env" (
    if exist ".env.example" (
        copy ".env.example" "server\.env" >nul
        echo  [INFO] Created server\.env from .env.example
        echo  [WARN] Edit server\.env to set your ADMIN_PASSWORD!
        echo.
    )
)

:: Install server deps if needed
if not exist "server\node_modules" (
    echo  [INFO] Installing server dependencies...
    cd server && npm install && cd ..
    echo.
)

:: Install dashboard deps if needed
if not exist "dashboard\node_modules" (
    echo  [INFO] Installing dashboard dependencies...
    cd dashboard && npm install && cd ..
    echo.
)

:: Build dashboard
echo  [INFO] Building dashboard...
cd dashboard && npm run build 2>nul && cd ..
if errorlevel 1 (
    echo  [WARN] Dashboard build failed - running without UI
)

echo.
echo  [OK] Starting gateway on http://localhost:3000
echo  [OK] Dashboard: http://localhost:3000
echo  [OK] Press Ctrl+C to stop
echo.

cd server && npm run dev
