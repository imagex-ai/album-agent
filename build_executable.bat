@echo off
chcp 65001 > nul
set PYTHONUTF8=1
echo ==============================================
echo  Building IMAGEX.AI (Frontend + Executable)
echo ==============================================
echo.

echo [1/3] Building Frontend with Vite...
cd frontend-mobile-preview
call npm.cmd install
call npm.cmd run build
cd ..

echo.
echo [2/3] Checking Playwright dependencies...
python -c "import playwright" >nul 2>&1
if %errorlevel% neq 0 (
    echo Installing requirements and Playwright...
    python -m pip install -r requirements.txt
)
python -m playwright install chromium

echo.
echo [3/3] Generating executable with PyInstaller...
python -m PyInstaller --clean --onefile --noconsole --paths . --collect-all src --collect-all webview --collect-all playwright --add-data "frontend-mobile-preview/dist;frontend-mobile-preview/dist" --hidden-import=uvicorn.logging --hidden-import=uvicorn.loops.auto --hidden-import=uvicorn.protocols.http.auto --hidden-import=uvicorn.lifespan.on src/main.py

echo.
echo ==============================================
echo  Done! Executable generated at dist\main.exe
echo ==============================================
pause