#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

echo "=============================================================="
echo "      IMAGEX.AI - Cross-Platform Verification & Build Tool"
echo "=============================================================="
echo ""

# Activate virtual environment if present
if [ -d "venv" ]; then
    source venv/bin/activate
elif [ -d ".venv" ]; then
    source .venv/bin/activate
fi

export PYTHONUTF8=1
export PYTHONIOENCODING=utf-8

echo "[1/5] Checking Python syntax across core modules..."
python3 -m py_compile src/main.py src/server/server.py src/core/models.py src/core/network_profiles.py src/server/safe_downloader.py src/validator/validator.py src/server/video_service.py
echo "[OK] All Python files compiled with zero syntax errors!"
echo ""

echo "[2/5] Running SRE i18n & Localization Parity Gatekeeper..."
python3 scripts/verify_full_app_translations.py
echo "[OK] Localization parity verified: 100% mirrored keys, zero regressions!"
echo ""

echo "[3/5] Building Frontend with Vite and TypeScript..."
if [ -d "frontend-mobile-preview" ]; then
    cd frontend-mobile-preview
    if [ ! -d "node_modules" ]; then
        echo "Installing npm dependencies..."
        npm install || echo "[NOTICE] Offline environment: skipping npm install..."
    fi
    if [ -d "node_modules" ]; then
        npm run build
        echo "[OK] Frontend compiled successfully into the dist folder!"
    else
        echo "[NOTICE] node_modules not present, skipping Vite build (will build on user machine)."
    fi
    cd ..
else
    echo "[WARNING] Directory frontend-mobile-preview not found, skipping..."
fi
echo ""

echo "[4/5] Verifying Playwright browser dependencies..."
if python3 -m playwright install chromium; then
    echo "[OK] Playwright / Chromium engine ready!"
else
    echo "[WARNING] Chromium installation failed; browser-based features may be unavailable."
fi
echo ""

echo "[5/5] Running isolated media classification checks..."
python3 -m pytest tests/test_media_classification.py -q -p no:cacheprovider
echo "[OK] Isolated checks completed. Other test suites were not run."
echo ""
echo "=============================================================="
echo "  Initial checks complete. To launch the server:"
echo "  To launch the server, run ./start_server.sh"
echo "=============================================================="
