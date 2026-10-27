@echo off
chcp 65001 > nul
cd /d "%~dp0"

echo ========================================================
echo  Iniciando Servidor Local e Cloudflare Tunnel juntos
echo ========================================================
echo.

start "Album Agent Server" cmd /k "start_server.bat"
timeout /t 3 /nobreak > nul
start "Cloudflare Tunnel" cmd /k "start_cloudflare_tunnel.bat"
