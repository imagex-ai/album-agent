@echo off
chcp 65001 > nul
cd /d "%~dp0"

echo ========================================================
echo  Iniciando Cloudflare Tunnel para o Servidor Local (:8100)
echo ========================================================
echo.

set CF_PATH="C:\Program Files (x86)\cloudflared\cloudflared.exe"

if exist %CF_PATH% (
    %CF_PATH% tunnel --url http://127.0.0.1:8100
) else (
    where cloudflared >nul 2>nul
    if %errorlevel% equ 0 (
        cloudflared tunnel --url http://127.0.0.1:8100
    ) else (
        echo [ERRO] cloudflared.exe nao encontrado.
        pause
    )
)

pause
