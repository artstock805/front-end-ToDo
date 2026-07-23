@echo off
title Todo App - Public Tunnel
cd /d C:\Users\ssei8\todo-app
set "CF=C:\Program Files (x86)\cloudflared\cloudflared.exe"
set "LOG=%~dp0public-log.txt"
echo [START] %DATE% %TIME% > "%LOG%"

echo ============================================
echo    Todo App - Publish to Internet (Cloudflare)
echo ============================================
echo.

if not exist "%CF%" goto :nocf
echo cloudflared OK >> "%LOG%"

netstat -ano | findstr ":3456" | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 goto :srv_up
echo [1/2] Starting server...
echo starting server >> "%LOG%"
start "Todo App Server" /min cmd /c "cd /d C:\Users\ssei8\todo-app && node server.js"
ping -n 4 127.0.0.1 >nul
goto :tunnel
:srv_up
echo [1/2] Server already running.
echo server already running >> "%LOG%"

:tunnel
echo [2/2] Starting tunnel... please wait a few seconds.
echo starting tunnel >> "%LOG%"
echo.
echo   Share the https://....trycloudflare.com URL shown below.
echo   (Closing this window disconnects everyone.)
echo.
"%CF%" tunnel --url http://localhost:3456 2>> "%LOG%"
echo tunnel exited >> "%LOG%"
echo.
echo Tunnel stopped. You can close this window.
pause
goto :eof

:nocf
echo [!] cloudflared NOT found:
echo     "%CF%"
echo     Install: winget install --id Cloudflare.cloudflared
echo cloudflared missing >> "%LOG%"
echo.
pause
