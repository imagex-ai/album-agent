@echo off
setlocal
chcp 65001 > nul
set PYTHONUTF8=1
cd /d "%~dp0"
echo ==============================================
echo  Building IMAGEX.AI (Frontend + Executable)
echo ==============================================
echo.

echo [1/3] Building Frontend with Vite...
cd frontend-mobile-preview
call npm.cmd install
if errorlevel 1 goto :error
call npm.cmd run build
if errorlevel 1 goto :error
cd ..

echo.
echo [2/3] Installing Python and build dependencies...
python -m pip install -r requirements-build.txt
if errorlevel 1 goto :error
python -m playwright install chromium
if errorlevel 1 goto :error

echo.
echo [3/3] Generating executable with PyInstaller...
python -m PyInstaller main.spec --noconfirm
if errorlevel 1 goto :error

echo.
echo ==============================================
echo  Done! Executable generated at dist\IMAGEX_AI.exe
echo ==============================================
pause
exit /b 0

:error
echo.
echo [ERROR] Build failed. Check the messages above.
pause
exit /b 1
