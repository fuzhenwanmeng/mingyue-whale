@echo off
setlocal
cd /d "%~dp0"

rem Keep this file ASCII-only and CRLF-terminated: cmd.exe mis-parses UTF-8 text and
rem LF-only line endings inside batch constructs (seen 2026-10-22 as "'cho' is not recognized").

rem Fixed DSH entry: ensure 127.0.0.1:6100 (forwarder) and write it into config.
rem Falls back to detect-dsh-port if the fixed entry cannot start.
where node >nul 2>nul
if errorlevel 1 goto no_node

if not defined DSH_HOME set "DSH_HOME=%USERPROFILE%\.dsh"

node tools\ensure-dsh-entry.mjs

echo.
echo Starting qq-bridge  -  console: http://127.0.0.1:3100   (Ctrl+C to stop)
echo.
node src\bridge.js

echo.
echo qq-bridge exited.
pause
exit /b 0

:no_node
echo [ERROR] node.exe not found. Install Node.js 22.13+ or add it to PATH.
pause
exit /b 1
