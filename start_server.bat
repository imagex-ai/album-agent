@echo off
chcp 65001 > nul
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
cd /d "%~dp0"

echo Starting server on port 8100...
echo.

if exist "%LOCALAPPDATA%\Python\pythoncore-3.14-64\python.exe" (
    "%LOCALAPPDATA%\Python\pythoncore-3.14-64\python.exe" -m src.main --server --port 8100
) else (
    where py >nul 2>nul
    if %errorlevel% equ 0 (
        py -m src.main --server --port 8100
    ) else (
        python -m src.main --server --port 8100
    )
)

pause
