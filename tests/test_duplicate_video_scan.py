"""Disposable fixtures: never import server startup or touch the real library."""
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path
from types import SimpleNamespace

import pytest
from tests.test_local_data_safety import trash

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('src.server.duplicate_video_scan', ROOT / 'src/server/duplicate_video_scan.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def fixture_scanner(tmp_path):
    base = tmp_path / 'videos'
    base.mkdir()
    metadata = tmp_path / 'metadata.json'
    metadata.write_text(json.dumps({'remote': {'custom_stream_url': 'https://remote.invalid/a'}}))
    service = SimpleNamespace(base_dir=str(base), metadata_file=str(metadata), _find_video_id=lambda rel, meta: rel)
    return module.DuplicateVideoScanner(service), base


def completed(scanner, scan_id):
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        state = scanner.snapshot(scan_id)
        if state['status'] != 'running':
            return state
        time.sleep(.01)
    raise AssertionError('scan did not complete')


def test_matching_bytes_only_and_changed_file_is_rejected(tmp_path):
    scanner, base = fixture_scanner(tmp_path)
    (base / 'a.mp4').write_bytes(b'abc')
    (base / 'b.mp4').write_bytes(b'abc')
    (base / 'c.mp4').write_bytes(b'xyz')
    (base / 'unique.mp4').write_bytes(b'longer')
    state = completed(scanner, scanner.start())
    assert state['status'] == 'completed'
    assert [set(g['videoIds']) for g in state['groups']] == [{'a.mp4', 'b.mp4'}]
    assert state['loaded'] == state['total'] == 3
    assert state['skipped'] == 1
    scan_id = next(iter(scanner.jobs))
    assert scanner.validate(scan_id, 'a.mp4', base / 'a.mp4')
    assert not scanner.validate(scan_id, 'a.mp4', base / 'b.mp4')
    (base / 'b.mp4').write_bytes(b'new bytes')
    assert not scanner.validate(scan_id, 'a.mp4', base / 'a.mp4')


def test_unsupported_files_are_not_reported_as_videos(tmp_path):
    scanner, base = fixture_scanner(tmp_path)
    (base / 'a.ts').write_bytes(b'abc')
    (base / 'b.ts').write_bytes(b'abc')
    state = completed(scanner, scanner.start())
    assert state['status'] == 'completed'
    assert state['groups'] == []
    assert state['total'] == 0


def test_frame_comparison_finds_reencoded_local_video(tmp_path):
    scanner, base = fixture_scanner(tmp_path)
    exe = module.ffmpeg_path()
    if not exe:
        pytest.skip('ffmpeg unavailable')
    first, second, unrelated = (base / name for name in ('a.mp4', 'b.mp4', 'c.mp4'))
    def run(*args):
        subprocess.run([exe, '-hide_banner', '-loglevel', 'error', '-y', *map(str, args)], check=True, capture_output=True)
    run('-f','lavfi','-i','testsrc=size=96x96:rate=5:duration=5','-c:v','mpeg4',first)
    run('-i',first,'-vf','scale=128:128','-c:v','mpeg4','-q:v','5',second)
    run('-f','lavfi','-i','color=red:size=96x96:rate=5:duration=5','-c:v','mpeg4',unrelated)
    scan_id=scanner.start('similar')
    state=completed(scanner, scan_id)
    assert state['status']=='completed'
    assert [set(group['videoIds']) for group in state['groups']] == [{'a.mp4','b.mp4'}]
    assert state['groups'][0]['reason']=='similar'
    assert scanner.validate(scan_id,'a.mp4',first)


def test_video_trash_move_failure_does_not_claim_success(trash, monkeypatch):
    path = Path(trash.videos_dir) / 'video.mp4'
    path.parent.mkdir(exist_ok=True)
    path.write_bytes(b'video')
    monkeypatch.setattr(shutil, 'move', lambda *args: (_ for _ in ()).throw(OSError('failed')))
    assert trash.move_video_to_trash({'id':'video', 'full_path':str(path), 'filename':path.name, 'storage_location':'local'}) is None
    assert path.read_bytes() == b'video'
    assert trash.list_all_items() == []


def test_video_trash_metadata_failure_rolls_back_move(trash, monkeypatch):
    path = Path(trash.videos_dir) / 'video.mp4'
    path.parent.mkdir(exist_ok=True)
    path.write_bytes(b'video')
    monkeypatch.setattr(trash, '_save_meta', lambda data: False)
    assert trash.move_video_to_trash({'id':'video', 'full_path':str(path), 'filename':path.name, 'storage_location':'local'}) is None
    assert path.read_bytes() == b'video'
    assert trash.list_all_items() == []


def test_video_trash_never_overwrites_existing_recovery(trash):
    path = Path(trash.videos_dir) / 'video.mp4'
    path.parent.mkdir(exist_ok=True)
    path.write_bytes(b'new')
    old = Path(trash.trash_videos_dir) / 'video_video.mp4'
    old.write_bytes(b'old')
    assert trash.move_video_to_trash({'id':'video', 'full_path':str(path), 'filename':path.name, 'storage_location':'local'}) is None
    assert path.read_bytes() == b'new'
    assert old.read_bytes() == b'old'


def test_video_trash_and_restore_round_trip(trash, monkeypatch):
    path = Path(trash.videos_dir) / 'Geral' / 'video.mp4'
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b'recoverable video')
    metadata = {}
    fake_service = SimpleNamespace(_load_metadata=lambda: metadata, _save_metadata=lambda data: True)
    monkeypatch.setattr(sys.modules['src.server.video_service'], 'video_service', fake_service, raising=False)
    item = trash.move_video_to_trash({'id':'video', 'full_path':str(path), 'filename':path.name,
                                      'folder':'Geral', 'rel_path':'Geral/video.mp4', 'storage_location':'local'})
    assert item and not path.exists()
    assert trash.restore_item(item['id'])
    assert path.read_bytes() == b'recoverable video'
    assert trash.list_all_items() == []
