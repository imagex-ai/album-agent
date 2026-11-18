@echo off
:: Check Administrator Privileges
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo Requesting Administrator privileges to allow local network/mobile access...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

chcp 65001 > nul
cls
echo ===================================================================
echo   ALLOWING MOBILE / LOCAL NETWORK ACCESS IN WINDOWS FIREWALL
echo ===================================================================
echo.

echo [1/2] Removing old IMAGEX firewall rules...
netsh advfirewall firewall delete rule name="ImageX Servidor 8100 (Entrada)" >nul 2>&1
netsh advfirewall firewall delete rule name="ImageX Servidor 8000 (Entrada)" >nul 2>&1

echo [2/2] Adding INBOUND rule for port 8100 TCP (Profiles: Public, Private, Domain)...
netsh advfirewall firewall add rule name="ImageX Servidor 8100 (Entrada)" dir=in action=allow protocol=TCP localport=8100 profile=any
if errorlevel 1 (
    echo [ERROR] Could not add the firewall rule. Check your permissions.
    pause
    exit /b 1
)

echo.
echo ===================================================================
echo   SUCCESS! Port 8100 is open in Windows Firewall!
echo ===================================================================
echo.
echo On your mobile device (connected to the same Wi-Fi), open the browser and access:
echo.
echo   http://IP-DO-SEU-COMPUTADOR:8100
echo   Execute ipconfig para encontrar o endereco IPv4 do computador.
echo.
echo Troubleshooting tips if page does not load:
echo   - Check Wi-Fi settings on mobile device
echo   - Temporarily disable 'Limit IP Address Tracking' on iOS if enabled
echo   - Turn off VPN or iCloud Private Relay if enabled
echo ===================================================================
echo.
pause
