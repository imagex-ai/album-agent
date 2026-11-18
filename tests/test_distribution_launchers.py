"""Distribution checks with disposable files; never start the real server."""
import ast
import os
from pathlib import Path
import shutil
import subprocess

import pytest

ROOT = Path(__file__).resolve().parents[1]


def test_packaging_spec_is_available_and_both_windows_builders_reference_it():
    spec = ROOT / 'imagex-build.spec'
    assert spec.is_file()
    ast.parse(spec.read_text(encoding='utf-8'))
    for name in ('build_executable.bat', 'test_and_build.bat'):
        script = (ROOT / name).read_text(encoding='utf-8')
        assert 'PyInstaller imagex-build.spec' in script


def test_unix_launcher_uses_an_argument_the_server_accepts():
    tree = ast.parse((ROOT / 'src/main.py').read_text(encoding='utf-8'))
    options = {arg.value for call in ast.walk(tree) if isinstance(call, ast.Call)
               for arg in call.args if isinstance(arg, ast.Constant) and isinstance(arg.value, str)}
    launcher = (ROOT / 'start_server.sh').read_text(encoding='utf-8')
    assert '--server' in options
    assert 'python3 -m src.main --server\n' in launcher
    assert '--server-only' not in launcher


@pytest.mark.skipif(os.name != 'nt', reason='Windows batch launcher test')
def test_frontend_failure_prevents_starting_server(tmp_path):
    for name in ('start_server.bat', 'build_frontend.bat'):
        shutil.copyfile(ROOT / name, tmp_path / name)
    (tmp_path / 'frontend-mobile-preview').mkdir()
    bin_dir = tmp_path / 'mock-bin'
    bin_dir.mkdir()
    (bin_dir / 'npm.cmd').write_text('@echo off\r\nexit /b 17\r\n', encoding='ascii')
    (bin_dir / 'py.cmd').write_text('@echo off\r\necho started>"%IMAGEX_LAUNCH_MARKER%"\r\n', encoding='ascii')
    marker = tmp_path / 'server-started.txt'
    env = os.environ.copy()
    env.update(PATH=str(bin_dir) + os.pathsep + str(Path(os.environ['SystemRoot']) / 'System32'),
               LOCALAPPDATA=str(tmp_path / 'no-installed-python'), IMAGEX_LAUNCH_MARKER=str(marker))
    result = subprocess.run(['cmd.exe', '/d', '/c', str(tmp_path / 'start_server.bat')],
                            cwd=tmp_path, env=env, input='\n', text=True,
                            capture_output=True, timeout=20)
    assert 'Frontend build failed; the server was not started.' in result.stdout
    assert not marker.exists()


@pytest.mark.skipif(os.name != 'nt', reason='Windows batch launcher test')
def test_windows_launcher_starts_server_with_compiled_frontend(tmp_path):
    shutil.copyfile(ROOT / 'start_server.bat', tmp_path / 'start_server.bat')
    dist = tmp_path / 'frontend-mobile-preview' / 'dist'
    dist.mkdir(parents=True)
    (dist / 'index.html').write_text('fixture', encoding='utf-8')
    bin_dir = tmp_path / 'mock-bin'
    bin_dir.mkdir()
    (bin_dir / 'py.cmd').write_text('@echo off\r\necho %* >"%IMAGEX_LAUNCH_MARKER%"\r\n', encoding='ascii')
    marker = tmp_path / 'server-started.txt'
    env = os.environ.copy()
    env.update(PATH=str(bin_dir) + os.pathsep + str(Path(os.environ['SystemRoot']) / 'System32'),
               LOCALAPPDATA=str(tmp_path / 'no-installed-python'), IMAGEX_LAUNCH_MARKER=str(marker))
    result = subprocess.run(['cmd.exe', '/d', '/c', str(tmp_path / 'start_server.bat')], cwd=tmp_path,
                            env=env, input='\n', text=True, capture_output=True, timeout=20)
    assert result.returncode == 0, result.stdout + result.stderr
    assert '-m src.main --server --port 8100' in marker.read_text()


@pytest.mark.skipif(os.name != 'nt', reason='Windows batch launcher test')
@pytest.mark.parametrize('add_fails', [False, True])
def test_firewall_launcher_uses_port_8100_without_touching_windows_firewall(tmp_path, add_fails):
    script = (ROOT / 'allow_firewall.bat').read_text(encoding='utf-8')
    assert 'Set-NetConnectionProfile' not in script
    script = script.replace('net session', 'call "%~dp0mock-admin.cmd" session')
    script = script.replace('netsh advfirewall', 'call "%~dp0mock-netsh.cmd" advfirewall')
    launcher = tmp_path / 'allow_firewall.bat'
    launcher.write_text(script, encoding='utf-8')
    (tmp_path / 'mock-admin.cmd').write_text('@echo off\r\nexit /b 0\r\n', encoding='ascii')
    (tmp_path / 'mock-netsh.cmd').write_text(
        '@echo off\r\necho %* >>"%IMAGEX_FIREWALL_LOG%"\r\n'
        'if "%IMAGEX_FIREWALL_FAIL%"=="1" if "%~3"=="add" exit /b 1\r\nexit /b 0\r\n', encoding='ascii')
    log = tmp_path / 'firewall-commands.txt'
    env = os.environ.copy()
    env.update(IMAGEX_FIREWALL_LOG=str(log), IMAGEX_FIREWALL_FAIL='1' if add_fails else '0')
    result = subprocess.run(['cmd.exe', '/d', '/c', str(launcher)], cwd=tmp_path, env=env,
                            input='\n', text=True, capture_output=True, timeout=20)
    commands = log.read_text(encoding='utf-8')
    assert 'localport=8100' in commands
    assert 'localport=8000' not in commands
    assert ('[ERROR]' in result.stdout) is add_fails
    assert ('SUCCESS!' in result.stdout) is not add_fails
