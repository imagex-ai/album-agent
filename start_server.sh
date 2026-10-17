#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

echo "=============================================================="
echo "      IMAGEX.AI - Servidor Local (Linux / macOS)"
echo "=============================================================="
echo ""

# Ativar ambiente virtual se existir
if [ -d "venv" ]; then
    source venv/bin/activate
elif [ -d ".venv" ]; then
    source .venv/bin/activate
fi

export PYTHONUTF8=1
export PYTHONIOENCODING=utf-8

# 1. Dependencias Python
if ! python3 -c "import playwright, fastapi, uvicorn, PIL" 2>/dev/null; then
    echo "[INFO] Instalando dependencias essenciais do requirements.txt..."
    pip3 install -r requirements.txt || true
    python3 -m playwright install chromium || true
fi

# 2. Compilar frontend se dist nao existir
if [ ! -f "frontend-mobile-preview/dist/index.html" ] && [ -d "frontend-mobile-preview" ]; then
    echo "[INFO] Frontend compilado nao encontrado. Compilando com Vite..."
    cd frontend-mobile-preview
    if [ ! -d "node_modules" ]; then
        npm install
    fi
    npm run build
    cd ..
    echo "[OK] Frontend compilado em dist!"
fi

python3 -m src.main --server-only
