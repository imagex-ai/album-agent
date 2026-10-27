@echo off
chcp 65001 > nul
setlocal enabledelayedexpansion
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
cd /d "%~dp0"

echo ==============================================================
echo       IMAGEX.AI - Automated Verification and Build Tool
echo ==============================================================
echo.

echo [1/5] Checking Python syntax across core modules...
python -m py_compile src\main.py src\server\server.py src\core\models.py src\core\network_profiles.py src\server\safe_downloader.py src\validator\validator.py src\server\video_service.py
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Syntax errors detected in Python files!
    echo Please resolve the error above before continuing.
    echo.
    pause
    exit /b %errorlevel%
)
echo [OK] All Python files compiled with zero syntax errors!
echo.

echo [2/5] Running SRE i18n e Localization Parity Gatekeeper...
python scripts\verify_full_app_translations.py
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] i18n Translation verification failed!
    echo Build blocked by SRE Gatekeeper due to missing keys or unlocalized text.
    echo.
    pause
    exit /b %errorlevel%
)
echo [OK] Localization parity verified: 100%% mirrored keys, zero regressions!
echo.

echo [3/5] Building Frontend with Vite and TypeScript...
if exist "frontend-mobile-preview" (
    cd frontend-mobile-preview
    if not exist "node_modules" (
        echo Installing npm dependencies...
        call npm install
    )
    call npm run build
    if !errorlevel! neq 0 (
        echo.
        echo [ERROR] Frontend build failed with Vite / TypeScript!
        cd ..
        pause
        exit /b !errorlevel!
    )
    cd ..
    echo [OK] Frontend compiled successfully into the dist folder!
) else (
    echo [WARNING] Directory frontend-mobile-preview not found, skipping...
)
echo.

echo [4/5] Installing Python and build dependencies...
python -m pip install -r requirements-build.txt
if errorlevel 1 (
    echo [ERROR] Python dependency installation failed!
    pause
    exit /b 1
)
python -m playwright install chromium
if errorlevel 1 (
    echo [ERROR] Chromium installation failed!
    pause
    exit /b 1
)
echo [OK] Playwright / Chromium engine ready!
echo.

echo ==============================================================
echo  Would you like to build the standalone executable (.exe) now?
echo  [1] Yes - Build complete binary with PyInstaller (Default)
echo  [2] No  - Verification only, keep ready for "start_server.bat"
echo ==============================================================
set /p CHOICE="Enter choice [1 or 2] (press ENTER for 1): "
if "%CHOICE%"=="" set CHOICE=1
if "%CHOICE%"=="2" (
    echo.
    echo ==============================================================
    echo  Verification complete! The application is tested and ready.
    echo  To launch in development server mode, run "start_server.bat".
    echo ==============================================================
    pause
    exit /b 0
)

echo.
echo [5/5] Building standalone executable with PyInstaller...
python -m PyInstaller main.spec --noconfirm

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] PyInstaller executable build failed!
    pause
    exit /b %errorlevel%
)

echo.
echo ==============================================================
echo  SUCCESS! Executable built and available at: dist\IMAGEX_AI.exe
echo ==============================================================
pause
