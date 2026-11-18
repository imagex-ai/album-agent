@echo off
chcp 65001 > nul
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
cd /d "%~dp0"

echo ==============================================================
echo       IMAGEX - Iniciando Servidor Local (Porta 8100)
echo ==============================================================
echo.

:: Garante que o frontend moderno original esteja compilado
if not exist "frontend-mobile-preview\dist\index.html" (
    echo [UI] Frontend compilado nao encontrado. Compilando design original...
    call "%~dp0build_frontend.bat" --no-pause
    if errorlevel 1 (
        echo [ERROR] Frontend build failed; the server was not started.
        pause
        exit /b 1
    )
    echo.
)

echo Starting server on port 8100...
echo.

if exist "%LOCALAPPDATA%\Python\pythoncore-3.14-64\python.exe" (
    "%LOCALAPPDATA%\Python\pythoncore-3.14-64\python.exe" -m src.main --server --port 8100
) else (
    where py >nul 2>nul
    if not errorlevel 1 (
        py -m src.main --server --port 8100
    ) else (
        python -m src.main --server --port 8100
    )
)

pause
