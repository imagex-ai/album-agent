"""
IMAGEX.AI Auto-Update Engine
Provides automatic GitHub release discovery, semver comparison,
and one-click autonomous updates for BOTH:
1. Source / Git Clone repositories (git pull + npm run build)
2. Standalone Windows Executables (.exe / PyInstaller)
"""

import os
import sys
import re
import json
import time
import shutil
import logging
import threading
import subprocess
import urllib.request
import urllib.error
from typing import Dict, Any, Optional, Tuple

logger = logging.getLogger("imagex_updater")
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("[%(levelname)s] %(asctime)s - updater: %(message)s"))
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
FRONTEND_DIR = os.path.join(ROOT_DIR, "frontend-mobile-preview")

# Thread safety
_update_lock = threading.Lock()
_cached_check: Optional[Dict[str, Any]] = None
_last_check_time: float = 0.0
CHECK_CACHE_TTL: float = 900.0  # 15 minutes

_update_state: Dict[str, Any] = {
    "status": "idle",       # "idle", "in_progress", "completed", "error"
    "progress": 0,          # 0 to 100
    "step": "",             # current step label
    "message": "",          # user-facing description
    "error": None,
    "logs": []
}


def parse_version(v: str) -> Tuple[int, ...]:
    """Extracts numeric tuple from version strings like 'v5.5.0' or '5.5'."""
    if not v:
        return (0, 0, 0)
    cleaned = re.sub(r'^[^\d]*', '', str(v).strip())
    parts = re.findall(r'\d+', cleaned)
    return tuple(int(p) for p in parts) if parts else (0, 0, 0)


def is_frozen() -> bool:
    """Checks whether the application is running as a compiled standalone executable (PyInstaller)."""
    return getattr(sys, "frozen", False)


def get_repo_name() -> str:
    """Extracts GitHub owner/repo from git remote or falls back to default repository."""
    if not is_frozen():
        try:
            out = subprocess.check_output(
                ["git", "remote", "get-url", "origin"],
                cwd=ROOT_DIR,
                text=True,
                stderr=subprocess.DEVNULL,
                timeout=3
            ).strip()
            m = re.search(r'github\.com[:/]([a-zA-Z0-9_\-\.]+)/([a-zA-Z0-9_\-\.]+?)(?:\.git)?$', out)
            if m:
                return f"{m.group(1)}/{m.group(2)}"
        except Exception:
            pass
    return "jardieljw/album-agent"


def is_git_repo() -> bool:
    """Checks whether the application is running from a valid git clone."""
    return os.path.isdir(os.path.join(ROOT_DIR, ".git"))


def check_for_updates(current_version: str, force: bool = False) -> Dict[str, Any]:
    """
    Checks GitHub Releases API for the latest release.
    Returns release information, comparison with current_version, and asset metadata.
    Results are cached in memory for CHECK_CACHE_TTL seconds unless force=True.
    """
    global _cached_check, _last_check_time
    now = time.time()

    with _update_lock:
        if not force and _cached_check is not None and (now - _last_check_time < CHECK_CACHE_TTL):
            return dict(_cached_check)

    repo = get_repo_name()
    api_url = f"https://api.github.com/repos/{repo}/releases/latest"

    headers = {
        "User-Agent": "IMAGEX-AI-App-AutoUpdater",
        "Accept": "application/vnd.github.v3+json"
    }
    github_token = os.environ.get("GITHUB_TOKEN")
    if github_token:
        headers["Authorization"] = f"Bearer {github_token}"

    try:
        req = urllib.request.Request(api_url, headers=headers)
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode("utf-8"))

        latest_tag = data.get("tag_name", "")
        release_name = data.get("name") or latest_tag
        release_notes = data.get("body") or ""
        published_at = data.get("published_at") or ""
        html_url = data.get("html_url") or f"https://github.com/{repo}/releases"

        cur_v = parse_version(current_version)
        lat_v = parse_version(latest_tag)
        update_available = lat_v > cur_v

        # Check for binary .exe asset in the release
        exe_asset_url = None
        exe_asset_name = None
        exe_asset_size = 0
        for asset in data.get("assets", []):
            name = asset.get("name", "").lower()
            if name.endswith(".exe"):
                exe_asset_url = asset.get("browser_download_url")
                exe_asset_name = asset.get("name")
                exe_asset_size = asset.get("size", 0)
                break

        result = {
            "update_available": update_available,
            "current_version": current_version,
            "latest_version": latest_tag,
            "release_name": release_name,
            "release_notes": release_notes,
            "published_at": published_at,
            "html_url": html_url,
            "is_git_repo": is_git_repo(),
            "is_frozen": is_frozen(),
            "has_exe_asset": bool(exe_asset_url),
            "exe_asset_url": exe_asset_url,
            "exe_asset_name": exe_asset_name,
            "exe_asset_size": exe_asset_size,
            "repository": repo,
            "checked_at": now,
            "error": None
        }

        with _update_lock:
            _cached_check = result
            _last_check_time = now

        return result

    except urllib.error.HTTPError as e:
        logger.warning(f"GitHub Releases HTTP check failed: {e.code} {e.reason}")
        return {
            "update_available": False,
            "current_version": current_version,
            "latest_version": current_version,
            "release_name": "",
            "release_notes": "",
            "published_at": "",
            "html_url": "",
            "is_git_repo": is_git_repo(),
            "is_frozen": is_frozen(),
            "has_exe_asset": False,
            "repository": repo,
            "checked_at": now,
            "error": f"HTTP {e.code}: {e.reason}"
        }
    except Exception as e:
        logger.warning(f"Error checking GitHub for updates: {e}")
        return {
            "update_available": False,
            "current_version": current_version,
            "latest_version": current_version,
            "release_name": "",
            "release_notes": "",
            "published_at": "",
            "html_url": "",
            "is_git_repo": is_git_repo(),
            "is_frozen": is_frozen(),
            "has_exe_asset": False,
            "repository": repo,
            "checked_at": now,
            "error": str(e)
        }


def get_update_status() -> Dict[str, Any]:
    """Returns a snapshot of the current update execution state."""
    with _update_lock:
        return dict(_update_state)


def _log_state(step: str, message: str, progress: int, log_line: Optional[str] = None):
    """Internal helper to safely update the progress state."""
    with _update_lock:
        _update_state["step"] = step
        _update_state["message"] = message
        _update_state["progress"] = progress
        if log_line:
            _update_state["logs"].append(log_line)
            logger.info(f"[{progress}%] {log_line}")


def _run_subprocess(cmd: list, cwd: str, step_name: str, base_progress: int) -> str:
    """Executes a CLI command and records output safely."""
    _log_state(step_name, f"Executando: {' '.join(cmd)}", base_progress, f">> {' '.join(cmd)}")
    use_shell = sys.platform == "win32"
    proc = subprocess.Popen(
        cmd,
        cwd=cwd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        shell=use_shell
    )
    output_lines = []
    if proc.stdout:
        for line in iter(proc.stdout.readline, ''):
            if not line:
                break
            clean_line = line.strip()
            if clean_line:
                output_lines.append(clean_line)
                with _update_lock:
                    _update_state["logs"].append(clean_line)
        proc.stdout.close()
    proc.wait()

    if proc.returncode != 0:
        err_msg = f"Falha no comando {' '.join(cmd)} (código {proc.returncode})"
        _log_state(step_name, err_msg, base_progress, f"ERRO: {err_msg}")
        raise RuntimeError(err_msg)

    return "\n".join(output_lines)


def _execute_frozen_exe_update(exe_url: str):
    """
    Downloads the new .exe binary from GitHub Release Assets and swaps
    the current executable safely via an atomic Windows batch launcher.
    """
    current_exe = os.path.abspath(sys.executable)
    exe_dir = os.path.dirname(current_exe)
    new_exe = os.path.join(exe_dir, "IMAGEX_AI_update.exe")
    bat_file = os.path.join(exe_dir, "apply_update.bat")

    _log_state("exe_download", "Iniciando download do novo executável...", 15, f"Baixando de: {exe_url}")

    req = urllib.request.Request(exe_url, headers={"User-Agent": "IMAGEX-AI-App-AutoUpdater"})
    with urllib.request.urlopen(req, timeout=30) as response, open(new_exe, "wb") as out_file:
        total_size = int(response.getheader("Content-Length", 0))
        downloaded = 0
        block_size = 65536

        while True:
            buffer = response.read(block_size)
            if not buffer:
                break
            downloaded += len(buffer)
            out_file.write(buffer)
            if total_size > 0:
                pct = 15 + int((downloaded / total_size) * 75)
                _log_state("exe_download", f"Baixando executável ({downloaded // (1024*1024)}MB / {total_size // (1024*1024)}MB)...", pct)

    _log_state("exe_swap", "Criando script de substituição atômica...", 92, "Preparando reinício com a nova versão...")

    # Windows batch script to swap the executable after current process exits
    bat_content = f"""@echo off
chcp 65001 > nul
timeout /t 2 /nobreak > nul
if exist "{new_exe}" (
    copy /y "{new_exe}" "{current_exe}" > nul
    del "{new_exe}" > nul
)
start "" "{current_exe}"
del "%~f0"
"""
    with open(bat_file, "w", encoding="utf-8") as f:
        f.write(bat_content)

    with _update_lock:
        _update_state["status"] = "completed"
        _update_state["progress"] = 100
        _update_state["step"] = "completed"
        _update_state["message"] = "Executável atualizado com sucesso! Reiniciando a aplicação..."
        _update_state["logs"].append("✓ Executável novo baixado. Reiniciando via apply_update.bat...")

    # Launch batch script in detached process and exit
    subprocess.Popen(
        ["cmd.exe", "/c", bat_file],
        cwd=exe_dir,
        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP | getattr(subprocess, "DETACHED_PROCESS", 0x00000008)
    )
    time.sleep(1.0)
    os._exit(0)


def _execute_update_sequence():
    """Background worker that applies the update autonomously."""
    global _update_state
    try:
        with _update_lock:
            _update_state["status"] = "in_progress"
            _update_state["progress"] = 5
            _update_state["step"] = "init"
            _update_state["message"] = "Iniciando processo autônomo de atualização..."
            _update_state["error"] = None
            _update_state["logs"] = ["Iniciando verificação do ambiente local..."]

        # Case A: Executable Mode (sys.frozen)
        if is_frozen():
            check_data = _cached_check or {}
            exe_url = check_data.get("exe_asset_url")
            if not exe_url:
                raise RuntimeError(
                    "Esta versão não possui um executável (.exe) anexado no GitHub Releases. "
                    "Acesse o link do GitHub para baixar o release ou atualizar pelo código-fonte."
                )
            _execute_frozen_exe_update(exe_url)
            return

        # Case B: Source / Git Repository Mode
        if not is_git_repo():
            raise RuntimeError(
                "O diretório atual não é um repositório git clonado. "
                "Para atualizar automaticamente, o app requer execução via repositório git ou executável oficial."
            )

        # 1. Fetch
        _log_state("git_fetch", "Buscando novas atualizações no GitHub...", 20, "Conectando ao GitHub (git fetch)...")
        _run_subprocess(["git", "fetch", "origin", "main"], ROOT_DIR, "git_fetch", 25)

        # 2. Pull
        _log_state("git_pull", "Mesclando as novidades do app (git pull)...", 45, "Atualizando código-fonte local...")
        _run_subprocess(["git", "pull", "origin", "main"], ROOT_DIR, "git_pull", 50)

        # 3. Dependencies check
        req_file = os.path.join(ROOT_DIR, "requirements.txt")
        if os.path.exists(req_file):
            _log_state("pip_check", "Verificando dependências Python...", 65, "Validando pacotes do backend...")
            try:
                _run_subprocess(
                    [sys.executable, "-m", "pip", "install", "-r", "requirements.txt", "--quiet"],
                    ROOT_DIR,
                    "pip_check",
                    70
                )
            except Exception as e:
                _log_state("pip_check", "Dependências Python verificadas com aviso.", 72, f"Aviso pip: {e}")

        # 4. Frontend Build
        if os.path.exists(FRONTEND_DIR):
            _log_state("npm_build", "Compilando nova interface com Vite...", 80, "Gerando bundle otimizado de produção...")
            npm_cmd = "npm.cmd" if sys.platform == "win32" else "npm"
            _run_subprocess([npm_cmd, "run", "build"], FRONTEND_DIR, "npm_build", 90)

        # 5. Success
        with _update_lock:
            _update_state["status"] = "completed"
            _update_state["progress"] = 100
            _update_state["step"] = "completed"
            _update_state["message"] = "Atualização concluída com sucesso! Pronto para reiniciar."
            _update_state["logs"].append("✓ Todas as etapas foram concluídas com êxito!")

        logger.info("Autonomous update finished successfully.")

    except Exception as e:
        logger.error(f"Autonomous update encountered an error: {e}", exc_info=True)
        with _update_lock:
            _update_state["status"] = "error"
            _update_state["error"] = str(e)
            _update_state["message"] = f"Erro durante a atualização: {e}"
            _update_state["logs"].append(f"FALHA: {e}")


def apply_update_async() -> Dict[str, Any]:
    """Starts the autonomous update process in a detached background thread."""
    with _update_lock:
        if _update_state["status"] == "in_progress":
            return {"status": "in_progress", "message": "Uma atualização já está em andamento."}

        _update_state["status"] = "in_progress"
        _update_state["progress"] = 0
        _update_state["step"] = "starting"
        _update_state["message"] = "Preparando atualização..."
        _update_state["error"] = None
        _update_state["logs"] = []

    worker = threading.Thread(target=_execute_update_sequence, name="AppAutoUpdaterWorker", daemon=True)
    worker.start()
    return {"status": "started", "message": "Atualização iniciada em segundo plano."}


def restart_server(delay_seconds: float = 2.0, port: int = 8100):
    """
    Spawns a new server process and cleanly terminates the current one
    after a short delay to allow client responses to flush.
    """
    def _delayed_restart():
        time.sleep(delay_seconds)
        logger.info("Restarting server process...")
        try:
            if is_frozen():
                cmd = [sys.executable, "--server", "--port", str(port)]
            else:
                cmd = [sys.executable, "-m", "src.main", "--server", "--port", str(port)]

            if sys.platform == "win32":
                subprocess.Popen(
                    cmd,
                    cwd=ROOT_DIR if not is_frozen() else os.path.dirname(sys.executable),
                    creationflags=subprocess.CREATE_NEW_PROCESS_GROUP | getattr(subprocess, "DETACHED_PROCESS", 0x00000008)
                )
            else:
                subprocess.Popen(cmd, cwd=ROOT_DIR, start_new_session=True)
        except Exception as e:
            logger.error(f"Failed to spawn new server process: {e}")
        finally:
            os._exit(0)

    t = threading.Thread(target=_delayed_restart, daemon=True)
    t.start()
    return {"status": "restarting", "message": f"Servidor reiniciando em {delay_seconds} segundos."}
