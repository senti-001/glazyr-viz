@echo off
setlocal
cd /d "%~dp0"
echo [*] IGNITING PERCEPTION ENGINE (v0.2.6)...
echo [*] NERVE CENTER: 127.0.0.1:6379
echo [*] MODE: PRO-IGNITION (SMITHERY-STANDALONE)
echo.

set GCP_REDIS_HOST=127.0.0.1
set GCP_REDIS_PORT=6379
set NODE_ENV=production
set BACKEND_URL=https://mcp.glazyr.com

node dist/index.js --stdio
pause
