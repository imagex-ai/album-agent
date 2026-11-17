"""Isolated update tests: no application startup, network or personal files."""
import io
import struct
import sys
import subprocess
from pathlib import Path
from unittest.mock import patch

import pytest

from src.updater import updater


def windows_executable_fixture():
    return Path(sys.executable).read_bytes()


class Response:
    def __init__(self, payload, content_length):
        self.stream = io.BytesIO(payload)
        self.content_length = content_length

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def getheader(self, _name, _default=0):
        return str(self.content_length)

    def read(self, size):
        return self.stream.read(size)


@pytest.mark.parametrize("payload,length,expected", [
    (b"", 0, 0),
    (b"not an executable", 17, 17),
    (windows_executable_fixture()[:-1], len(windows_executable_fixture()), len(windows_executable_fixture())),
    (windows_executable_fixture(), len(windows_executable_fixture()), len(windows_executable_fixture()) + 1),
], ids=["empty", "not-pe", "truncated", "wrong-size"])
def test_bad_download_never_schedules_replacement(tmp_path, payload, length, expected):
    original = tmp_path / "app.exe"
    original.write_bytes(b"original")
    with patch.object(updater.sys, "executable", str(original)), \
         patch.object(updater.urllib.request, "urlopen", return_value=Response(payload, length)), \
         patch.object(updater.subprocess, "Popen") as launch:
        with pytest.raises(ValueError, match="update_invalid_download"):
            updater._execute_frozen_exe_update("https://example.invalid/fixture.exe", expected)
        launch.assert_not_called()
    assert original.read_bytes() == b"original"
    assert list(tmp_path.iterdir()) == [original]


def test_valid_download_creates_backup_and_restore_handoff_without_claiming_success(tmp_path):
    original = tmp_path / "app.exe"
    original.write_bytes(b"original")
    payload = windows_executable_fixture()
    updater._update_state["status"] = "in_progress"
    with patch.object(updater.sys, "executable", str(original)), \
         patch.object(updater.urllib.request, "urlopen", return_value=Response(payload, len(payload))), \
         patch.object(updater.subprocess, "Popen") as launch, \
         patch.object(updater.time, "sleep"), \
         patch.object(updater.os, "_exit"):
        updater._execute_frozen_exe_update("https://example.invalid/fixture.exe", len(payload))
    env = launch.call_args.kwargs["env"]
    script = Path(launch.call_args.args[0][-1]).read_text()
    assert Path(env["IMAGEX_UPDATE_NEW"]).read_bytes() == payload
    assert env["IMAGEX_UPDATE_BACKUP"] != str(original)
    assert 'goto restore' in script and 'fc /b' in script
    assert updater._update_state["status"] == "in_progress"
    assert original.read_bytes() == b"original"


def test_failed_download_is_reported_as_error_by_update_sequence(tmp_path):
    original = tmp_path / "app.exe"
    original.write_bytes(b"original")
    check = {"exe_asset_url": "https://example.invalid/fixture.exe", "exe_asset_size": 100}
    with patch.object(updater, "_cached_check", check), \
         patch.object(updater, "is_frozen", return_value=True), \
         patch.object(updater.sys, "executable", str(original)), \
         patch.object(updater.urllib.request, "urlopen", return_value=Response(b"", 0)), \
         patch.object(updater.subprocess, "Popen") as launch:
        updater._execute_update_sequence()
    assert updater.get_update_status()["status"] == "error"
    assert updater.get_update_status()["error"] == "update_invalid_download"
    launch.assert_not_called()
    assert original.read_bytes() == b"original"


@pytest.mark.parametrize("case", ["swap", "rollback", "backup_failure"])
def test_windows_copy_and_rollback_with_temporary_files(tmp_path, case):
    original = tmp_path / "app.exe"
    old = b"original fixture"
    original.write_bytes(old)
    payload = windows_executable_fixture()
    with patch.object(updater.sys, "executable", str(original)), \
         patch.object(updater.urllib.request, "urlopen", return_value=Response(payload, len(payload))), \
         patch.object(updater.subprocess, "Popen") as launch, \
         patch.object(updater.time, "sleep"), patch.object(updater.os, "_exit"):
        updater._execute_frozen_exe_update("https://example.invalid/fixture.exe", len(payload))
    env = launch.call_args.kwargs["env"]
    script = Path(launch.call_args.args[0][-1])
    # Exercise the real copy/rollback commands but never start either executable.
    body = script.read_text().replace('start "" "%IMAGEX_UPDATE_CURRENT%"', 'rem launch suppressed')
    script.write_text(body)
    if case == "rollback":
        Path(env["IMAGEX_UPDATE_NEW"]).unlink()
    if case == "backup_failure":
        env["IMAGEX_UPDATE_BACKUP"] = str(tmp_path / "missing-directory" / "backup.exe")
    result = subprocess.run(["cmd.exe", "/d", "/c", str(script)], env=env, cwd=tmp_path,
                            capture_output=True, timeout=12, creationflags=subprocess.CREATE_NO_WINDOW)
    assert result.returncode == 0
    assert original.read_bytes() == (payload if case == "swap" else old)
    if case != "backup_failure":
        assert Path(env["IMAGEX_UPDATE_BACKUP"]).read_bytes() == old


def test_corrupt_pe_section_offsets_are_rejected(tmp_path):
    payload = bytearray(windows_executable_fixture())
    pe_offset = struct.unpack_from("<I", payload, 60)[0]
    optional_size = struct.unpack_from("<H", payload, pe_offset + 20)[0]
    section_table = pe_offset + 24 + optional_size
    struct.pack_into("<I", payload, section_table + 20, len(payload) + 1)
    candidate = tmp_path / "corrupt.exe"
    candidate.write_bytes(payload)
    with pytest.raises(ValueError, match="update_invalid_download"):
        updater._validate_downloaded_executable(str(candidate), len(payload), len(payload))
