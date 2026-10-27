"""Regression tests with disposable data and production code isolated from app startup.

Importing server.py starts library/cloud maintenance. Load only the units under
test so these checks cannot migrate the user's real library or start downloads.
"""
import ast
import json
import logging
import os
from pathlib import Path
import shutil
import sys
import threading
import time
from datetime import datetime, timezone
from types import SimpleNamespace
from typing import Any, Dict, List, Optional

import pytest
from fastapi import HTTPException

ROOT = Path(__file__).resolve().parents[1]


def load_unit(relative_path, name, namespace, methods=None):
    tree = ast.parse((ROOT / relative_path).read_text(encoding="utf-8"))
    node = next(node for node in tree.body if getattr(node, "name", None) == name)
    node.decorator_list = []
    if methods is not None:
        node.body = [child for child in node.body if getattr(child, "name", None) in methods]
    exec(compile(ast.Module(body=[node], type_ignores=[]), str(ROOT / relative_path), "exec"), namespace)
    return namespace[name]


@pytest.fixture
def trash(tmp_path, monkeypatch):
    cloud = SimpleNamespace(is_connected=lambda: False, upload_json=lambda *args: None)
    monkeypatch.setitem(sys.modules, "src.server.video_service", SimpleNamespace(
        cloud_storage=cloud, is_auto_cloud_sync_enabled=lambda: False))
    namespace = dict(globals(), __package__="src.server", __spec__=None)
    service_class = load_unit("src/server/trash_service.py", "TrashService", namespace)
    service = service_class(str(tmp_path))
    Path(service.albums_dir).mkdir(exist_ok=True)
    return service


@pytest.fixture
def videos(tmp_path):
    service_class = load_unit("src/server/video_service.py", "VideoService", dict(globals()),
                              {"delete_folder", "_load_metadata", "_save_metadata"})
    service = service_class()
    service.base_dir = str(tmp_path)
    service.metadata_file = str(tmp_path / "metadata.json")
    service._meta_lock = threading.RLock()
    service._last_hf_meta_sync = time.time()  # Cloud sync is irrelevant to local file moves.
    service.is_auto_sync_enabled = lambda: False
    return service


def put_album(trash, images=None):
    path = Path(trash.albums_dir) / "album.json"
    path.write_text(json.dumps({"title": "Sample", "images": images or []}), encoding="utf-8")
    return path


def run_sync_route(coroutine):
    """These async routes contain no await; avoid a live event loop or startup hooks."""
    try:
        coroutine.send(None)
    except StopIteration as completed:
        return completed.value
    raise AssertionError("Route now needs asynchronous dependencies; update isolation fixture")


def album_delete_route(trash):
    namespace = dict(globals(), trash_service=trash, _completed_albums={"album": object()},
                     _disk_album_mtimes={"album.json": 1}, _summaries_dirty=False, _album_summary_revision=0,
                     _load_albums_from_disk=lambda: None,
                     AgentDebugger=SimpleNamespace(get_ui_summary=lambda album: {"title": "Sample", "images": []}))
    load_unit("src/server/server.py", "_mark_album_summaries_dirty", namespace)
    return load_unit("src/server/server.py", "delete_album", namespace), namespace


def test_album_move_failure_preserves_disk_and_memory(trash, monkeypatch):
    path = put_album(trash)
    original = path.read_bytes()
    route, namespace = album_delete_route(trash)
    monkeypatch.setattr(shutil, "move", lambda *args: (_ for _ in ()).throw(OSError("disk move failed")))
    with pytest.raises(HTTPException) as error:
        run_sync_route(route("album"))
    assert error.value.status_code == 500
    assert path.read_bytes() == original
    assert "album" in namespace["_completed_albums"]
    assert trash.list_all_items() == []


def test_album_delete_and_restore_round_trip(trash):
    path = put_album(trash)
    original = path.read_bytes()
    route, namespace = album_delete_route(trash)
    response = run_sync_route(route("album"))
    assert response["deleted"] is True
    assert not path.exists()
    assert "album" not in namespace["_completed_albums"]
    assert trash.restore_item(response["trash_item"]["id"])
    assert path.read_bytes() == original
    assert trash.list_all_items() == []


def test_failed_trash_metadata_save_rolls_back_album_move(trash, monkeypatch):
    path = put_album(trash)
    monkeypatch.setattr(trash, "_save_meta", lambda value: False)
    assert trash.move_album_to_trash("album", {"images": []}) is None
    assert path.exists()
    assert not (Path(trash.trash_albums_dir) / "album.json").exists()


def test_failed_trash_metadata_save_rolls_back_album_restore(trash, monkeypatch):
    path = put_album(trash)
    item = trash.move_album_to_trash("album", {"images": []})
    original_save = trash._save_meta
    monkeypatch.setattr(trash, "_save_meta", lambda value: False)
    assert trash.restore_item(item["id"]) is None
    assert not path.exists()
    assert (Path(trash.trash_albums_dir) / "album.json").exists()
    assert item["id"] in trash._load_meta()
    monkeypatch.setattr(trash, "_save_meta", original_save)
    assert trash.restore_item(item["id"])
    assert path.exists()


def test_restore_different_photos_with_empty_ids(trash):
    kept = {"id": None, "candidate_id": "keep", "position": 0, "original_url": "https://example.test/keep.jpg"}
    deleted = {"id": None, "candidate_id": "restore", "position": 1, "original_url": "https://example.test/restore.jpg"}
    path = put_album(trash, [kept])
    item = trash.move_photos_to_trash("album", "Sample", [deleted])[0]
    assert trash.restore_item(item["id"])
    assert [photo["candidate_id"] for photo in json.loads(path.read_text())["images"]] == ["keep", "restore"]
    assert not trash.list_all_items()


def test_restore_uploaded_photo_without_any_id(trash):
    path = put_album(trash, [{"id": None, "position": 1, "original_url": "local://albums/album/a.jpg"}])
    photo = {"id": None, "position": 2, "original_url": "local://albums/album/b.jpg"}
    item = trash.move_photos_to_trash("album", "Sample", [photo])[0]
    assert trash.restore_item(item["id"])
    assert len(json.loads(path.read_text())["images"]) == 2


def test_restoring_already_present_photo_does_not_duplicate(trash):
    photo = {"id": "photo-1", "position": 1, "original_url": "https://example.test/a.jpg"}
    path = put_album(trash, [photo])
    item = trash.move_photos_to_trash("album", "Sample", [photo])[0]
    assert trash.restore_item(item["id"])
    assert len(json.loads(path.read_text())["images"]) == 1


def test_restore_photo_with_missing_parent_keeps_trash_entry(trash):
    photo = {"candidate_id": "photo-1", "position": 1}
    item = trash.move_photos_to_trash("missing", "Missing", [photo])[0]
    assert trash.restore_item(item["id"]) is None
    assert item["id"] in trash._load_meta()


def test_restore_photo_into_trashed_parent(trash):
    put_album(trash)
    photo = {"candidate_id": "photo-1", "position": 1}
    item = trash.move_photos_to_trash("album", "Sample", [photo])[0]
    album_item = trash.move_album_to_trash("album", {"images": []})
    assert trash.restore_item(item["id"])
    assert trash.restore_item(album_item["id"])
    assert len(json.loads((Path(trash.albums_dir) / "album.json").read_text())["images"]) == 1


def test_failed_photo_restore_write_preserves_album_and_trash(trash, monkeypatch):
    path = put_album(trash)
    original = path.read_bytes()
    item = trash.move_photos_to_trash("album", "Sample", [{"candidate_id": "a", "position": 1}])[0]
    monkeypatch.setattr(os, "replace", lambda *args: (_ for _ in ()).throw(OSError("disk write failed")))
    assert trash.restore_item(item["id"]) is None
    assert path.read_bytes() == original
    assert item["id"] in trash._load_meta()


def video_fixture(service, names=("clip.mp4",)):
    source = Path(service.base_dir) / "Trips"
    source.mkdir()
    meta = {}
    for index, name in enumerate(names):
        (source / name).write_bytes(f"video {index}".encode())
        meta[f"video-{index}"] = {"id": f"video-{index}", "rel_path": f"Trips/{name}", "folder": "Trips", "is_favorite": True}
    service._save_metadata(meta)
    return source, meta


def test_delete_video_folder_preserves_files_ids_and_metadata(videos):
    source, meta = video_fixture(videos)
    assert videos.delete_folder("Trips") is True
    assert not source.exists()
    entry = videos._load_metadata()["video-0"]
    assert entry["id"] == "video-0" and entry["is_favorite"] is True
    assert (Path(videos.base_dir) / entry["rel_path"]).read_bytes() == b"video 0"


def test_delete_folder_name_collision_keeps_both_video_contents(videos):
    video_fixture(videos)
    geral = Path(videos.base_dir) / "Geral"
    geral.mkdir()
    (geral / "clip.mp4").write_bytes(b"existing video")
    assert videos.delete_folder("Trips") is True
    entry = videos._load_metadata()["video-0"]
    assert entry["rel_path"] != "Geral/clip.mp4"
    assert (Path(videos.base_dir) / entry["rel_path"]).read_bytes() == b"video 0"
    assert (geral / "clip.mp4").read_bytes() == b"existing video"


def test_delete_folder_move_failure_rolls_back_completed_moves(videos, monkeypatch):
    source, meta = video_fixture(videos, ("a.mp4", "b.mp4"))
    original_move = shutil.move
    calls = 0
    def fail_second_move(src, dst):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise OSError("simulated move failure")
        return original_move(src, dst)
    monkeypatch.setattr(shutil, "move", fail_second_move)
    assert videos.delete_folder("Trips") is False
    assert (source / "a.mp4").read_bytes() == b"video 0"
    assert (source / "b.mp4").read_bytes() == b"video 1"
    assert videos._load_metadata() == meta


def test_delete_folder_failed_metadata_save_rolls_back_files(videos, monkeypatch):
    source, meta = video_fixture(videos)
    monkeypatch.setattr(videos, "_save_metadata", lambda value: False)
    assert videos.delete_folder("Trips") is False
    assert (source / "clip.mp4").read_bytes() == b"video 0"
    assert videos._load_metadata() == meta


def test_delete_folder_preserves_unexpected_subfolder(videos):
    source, meta = video_fixture(videos)
    nested = source / "nested"
    nested.mkdir()
    (nested / "keep.txt").write_text("keep", encoding="utf-8")
    assert videos.delete_folder("Trips") is False
    assert (nested / "keep.txt").read_text() == "keep"
    assert (source / "clip.mp4").exists()
    assert videos._load_metadata() == meta


def test_delete_stream_only_folder_preserves_url(videos):
    videos._save_metadata({"stream": {"id": "stream", "folder": "Trips", "rel_path": "Trips/clip.mp4", "custom_stream_url": "https://example.test/video.mp4"}})
    assert videos.delete_folder("Trips") is True
    entry = videos._load_metadata()["stream"]
    assert entry["folder"] == "Geral"
    assert entry["custom_stream_url"] == "https://example.test/video.mp4"


def test_default_video_folder_cannot_be_deleted(videos):
    assert videos.delete_folder("Geral") is False
