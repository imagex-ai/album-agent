@echo off
setlocal enabledelayedexpansion
chcp 65001 > nul
cd /d "%~dp0"

echo ==============================================================
echo   IMAGEX - Compilador do Frontend (Design Original Normal)
echo ==============================================================
echo.

where npm >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERRO] Node.js / npm nao encontrado no PATH do sistema!
    echo Instale o Node.js em https://nodejs.org/ para compilar o frontend.
    echo.
    if "%~1"=="" pause
    exit /b 1
)

if not exist "frontend-mobile-preview" (
    echo [ERRO] Pasta frontend-mobile-preview nao encontrada!
    echo.
    if "%~1"=="" pause
    exit /b 1
)

cd frontend-mobile-preview

if not exist "node_modules" (
    echo [1/2] Dependencias npm nao encontradas. Instalando...
    call npm install
    if !errorlevel! neq 0 (
        set "build_error=!errorlevel!"
        echo [ERRO] Falha ao instalar dependencias npm!
        cd /d "%~dp0"
        if "%~1"=="" pause
        exit /b !build_error!
    )
)

echo [2/2] Compilando frontend com TypeScript e Vite...
call npm run build
if !errorlevel! neq 0 (
    set "build_error=!errorlevel!"
    echo.
    echo [ERRO] Falha na compilacao do frontend Vite/TypeScript!
    cd /d "%~dp0"
    if "%~1"=="" pause
    exit /b !build_error!
)

cd /d "%~dp0"

if not exist "frontend-mobile-preview\dist\index.html" goto :build_missing

echo.
echo ==============================================================
echo  [OK] Design original normal compilado com sucesso!
echo  Arquivos gerados em: frontend-mobile-preview\dist
echo  O servidor agora exibira o design moderno original (IMAGEX).
echo ==============================================================
echo.
if "%~1"=="" pause
exit /b 0

:build_missing
echo.
echo [ERRO] O build finalizou mas index.html nao foi encontrado em dist.
echo.
if "%~1"=="" pause
exit /b 1
