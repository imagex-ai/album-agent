import os
import json
import pytest
from datetime import datetime, timezone
from src.core.models import Album, AlbumImage
from src.server import server

def test_album_model_timestamps():
    alb = Album(
        album_id="test_alb_1",
        title="Test Album",
        original_title="Test Album",
        source_page="https://example.com/gallery",
        created_at="2026-01-01 12:00:00 UTC",
        updated_at="2026-01-01 12:00:00 UTC"
    )
    assert alb.created_at == "2026-01-01 12:00:00 UTC"
    assert alb.updated_at == "2026-01-01 12:00:00 UTC"

def test_save_and_load_album_timestamps(tmp_path, monkeypatch):
    monkeypatch.setattr(server, "ALBUMS_DIR", str(tmp_path))
    monkeypatch.setattr(server, "_completed_albums", {})

    alb = Album(
        album_id="sess_test_100",
        title="Session Test 100",
        original_title="Session Test 100",
        source_page="https://example.com/gallery/100",
        images=[
            AlbumImage(
                id="img_1",
                position=1,
                original_url="https://example.com/img1.jpg",
                thumbnail_url="https://example.com/thumb1.jpg"
            )
        ]
    )

    # Save initial album
    server._save_album_to_disk("sess_test_100", alb)
    fpath = os.path.join(str(tmp_path), "sess_test_100.json")
    assert os.path.exists(fpath)

    with open(fpath, "r", encoding="utf-8") as f:
        data = json.load(f)
    assert "created_at" in data
    assert "updated_at" in data
    initial_created = data["created_at"]
    initial_updated = data["updated_at"]

    # Verify reload
    server._completed_albums.clear()
    server._load_albums_from_disk()
    loaded = server._completed_albums["sess_test_100"]
    assert loaded.created_at == initial_created
    assert loaded.updated_at == initial_updated

    # Emulate set cover - updated_at changes but created_at remains immutable
    new_cover = "https://example.com/new_cover.jpg"
    loaded.cover_image_url = new_cover
    new_ts = "2026-02-01 15:30:00 UTC"
    loaded.updated_at = new_ts
    loaded.metadata["updated_at"] = new_ts
    server._save_album_to_disk("sess_test_100", loaded)

    with open(fpath, "r", encoding="utf-8") as f:
        data_after = json.load(f)
    assert data_after["created_at"] == initial_created, "created_at must be strictly immutable"
    assert data_after["updated_at"] == new_ts, "updated_at must reflect recent modification"


def test_legacy_album_backfill_persisted(tmp_path, monkeypatch):
    """Verify legacy albums without created_at receive immutable ctime timestamp persisted to disk."""
    monkeypatch.setattr(server, "ALBUMS_DIR", str(tmp_path))
    monkeypatch.setattr(server, "_completed_albums", {})

    legacy_data = {
        "album_id": "legacy_alb_99",
        "title": "Legacy Album 99",
        "original_title": "Legacy Album 99",
        "source_page": "https://example.com/legacy/99",
        "images": [
            {
                "id": "leg_1",
                "position": 1,
                "original_url": "https://example.com/leg1.jpg",
                "thumbnail_url": "https://example.com/leg1_thumb.jpg"
            }
        ],
        "metadata": {}
    }
    fpath = os.path.join(str(tmp_path), "legacy_alb_99.json")
    with open(fpath, "w", encoding="utf-8") as f:
        json.dump(legacy_data, f)

    server._load_albums_from_disk()
    loaded = server._completed_albums["legacy_alb_99"]
    assert loaded.created_at is not None
    assert loaded.updated_at is not None

    # Verify disk was updated with backfilled created_at
    with open(fpath, "r", encoding="utf-8") as f:
        on_disk = json.load(f)
    assert on_disk.get("created_at") == loaded.created_at
    assert on_disk.get("updated_at") == loaded.updated_at


@pytest.mark.asyncio
async def test_toggle_album_favorite_persistence(tmp_path, monkeypatch):
    """Verify toggle_album_favorite toggles and persists favorite status on disk without altering created_at."""
    monkeypatch.setattr(server, "ALBUMS_DIR", str(tmp_path))
    monkeypatch.setattr(server, "_completed_albums", {})

    alb = Album(
        album_id="fav_test_1",
        title="Fav Test Album",
        original_title="Fav Test Album",
        source_page="https://example.com/fav/1",
        created_at="2026-03-01 10:00:00 UTC",
        updated_at="2026-03-01 10:00:00 UTC",
        images=[]
    )
    server._save_album_to_disk("fav_test_1", alb)
    server._completed_albums["fav_test_1"] = alb

    # Toggle to favorite
    res = await server.toggle_album_favorite("fav_test_1")
    assert res["status"] == "ok"
    assert res["is_favorite"] is True

    fpath = os.path.join(str(tmp_path), "fav_test_1.json")
    with open(fpath, "r", encoding="utf-8") as f:
        data = json.load(f)
    assert data.get("is_favorite") is True
    assert data.get("created_at") == "2026-03-01 10:00:00 UTC"

    # Toggle back to unfavorite
    res2 = await server.toggle_album_favorite("fav_test_1")
    assert res2["is_favorite"] is False
    with open(fpath, "r", encoding="utf-8") as f:
        data2 = json.load(f)
    assert data2.get("is_favorite") is False
    assert data2.get("created_at") == "2026-03-01 10:00:00 UTC"


def test_video_timestamps_and_immutability(tmp_path):
    """Verify video created_at is strictly immutable and updated_at updates on modifications."""
    from src.server.video_service import VideoService
    import time

    vs = VideoService(str(tmp_path))

    # 1. Create a dummy video file
    folder_path = tmp_path / "Geral"
    folder_path.mkdir(parents=True, exist_ok=True)
    video_file = folder_path / "sample_video.mp4"
    video_file.write_bytes(b"dummy video content")

    # 2. Add entry to metadata with an initial created_at and updated_at
    initial_created = "2026-01-01 10:00:00"
    initial_updated = "2026-01-01 10:00:00"
    meta = {
        "v_sample_1": {
            "title": "Initial Video Title",
            "filename": "sample_video.mp4",
            "rel_path": "Geral/sample_video.mp4",
            "folder": "Geral",
            "created_at": initial_created,
            "updated_at": initial_updated,
            "is_favorite": False,
            "storage_location": "local"
        }
    }
    vs._save_metadata(meta)

    # 3. Verify get_video_by_id returns both timestamps
    v = vs.get_video_by_id("v_sample_1")
    assert v is not None
    assert v["created_at"] == initial_created
    assert v["updated_at"] == initial_updated

    # 4. Rename video: updated_at changes, created_at strictly unchanged
    time.sleep(0.01)
    res_rename = vs.rename_video("v_sample_1", "Updated Video Title")
    assert res_rename is True

    v_after_rename = vs.get_video_by_id("v_sample_1")
    assert v_after_rename["title"] == "Updated Video Title"
    assert v_after_rename["created_at"] == initial_created, "created_at must be strictly immutable on rename"
    assert v_after_rename["updated_at"] != initial_updated, "updated_at must change on rename"

    # 5. Toggle favorite: created_at unchanged, updated_at updated
    time.sleep(0.01)
    new_fav = vs.toggle_favorite("v_sample_1")
    assert new_fav is True
    v_after_fav = vs.get_video_by_id("v_sample_1")
    assert v_after_fav["is_favorite"] is True
    assert v_after_fav["created_at"] == initial_created, "created_at must be strictly immutable on favorite toggle"

    # 6. Move video to new folder: created_at unchanged, updated_at updated
    time.sleep(0.01)
    v_moved = vs.move_video("v_sample_1", "Trailers")
    assert v_moved is not None
    assert v_moved["folder"] == "Trailers"
    assert v_moved["created_at"] == initial_created, "created_at must be strictly immutable on move"

    # 7. Check list_all_videos includes both timestamps
    all_videos = vs.list_all_videos()
    assert len(all_videos) == 1
    assert all_videos[0]["created_at"] == initial_created
    assert all_videos[0]["updated_at"] is not None

    # 8. Check _update_single_metadata preserves created_at when update_timestamp=True
    vs._update_single_metadata(vid_id="v_sample_1", cloud_url="https://cloud.example.com/v.mp4", update_timestamp=True)
    v_meta = vs.get_video_by_id("v_sample_1")
    assert v_meta["cloud_url"] == "https://cloud.example.com/v.mp4"
    assert v_meta["created_at"] == initial_created, "created_at must remain immutable after _update_single_metadata"


@pytest.mark.asyncio
async def test_album_stream_refresh_updates_updated_at(tmp_path, monkeypatch):
    """Verify refresh_album_streams_endpoint updates album updated_at while preserving created_at."""
    monkeypatch.setattr(server, "ALBUMS_DIR", str(tmp_path))
    monkeypatch.setattr(server, "_completed_albums", {})

    initial_created = "2026-05-01 10:00:00 UTC"
    initial_updated = "2026-05-01 10:00:00 UTC"
    alb = Album(
        album_id="stream_alb_1",
        title="Stream Album",
        original_title="Stream Album",
        source_page="https://example.com/video/1",
        created_at=initial_created,
        updated_at=initial_updated,
        images=[
            AlbumImage(
                id="img_v1",
                candidate_id="cand_v1",
                position=1,
                media_type="video",
                original_url="https://example.com/old_stream.mp4",
                thumbnail_url="https://example.com/thumb.jpg"
            )
        ]
    )
    server._save_album_to_disk("stream_alb_1", alb)
    server._completed_albums["stream_alb_1"] = alb

    async def mock_refresh(album):
        album.images[0].video_stream_url = "https://cdn.example.com/new_stream.mp4"
        return [{"candidate_id": "cand_v1", "new_url": "https://cdn.example.com/new_stream.mp4"}], []

    monkeypatch.setattr(server, "_refresh_album_video_streams", mock_refresh)

    res = await server.refresh_album_streams_endpoint("stream_alb_1")
    assert res["success"] is True
    assert res["refreshed"] == 1

    fpath = os.path.join(str(tmp_path), "stream_alb_1.json")
    with open(fpath, "r", encoding="utf-8") as f:
        data = json.load(f)

    assert data["created_at"] == initial_created, "created_at must remain immutable on stream refresh"
    assert data["updated_at"] != initial_updated, "updated_at must update on stream refresh"
    assert data["metadata"]["created_at"] == initial_created
    assert data["metadata"]["updated_at"] == data["updated_at"]


@pytest.mark.asyncio
async def test_album_move_updates_updated_at(tmp_path, monkeypatch):
    """Verify move_albums updates updated_at on moved albums while keeping created_at immutable."""
    monkeypatch.setattr(server, "ALBUMS_DIR", str(tmp_path))
    monkeypatch.setattr(server, "_completed_albums", {})

    initial_created = "2026-06-01 12:00:00 UTC"
    initial_updated = "2026-06-01 12:00:00 UTC"
    alb = Album(
        album_id="move_alb_1",
        title="Move Album",
        original_title="Move Album",
        source_page="https://example.com/gallery/move",
        folder="Geral",
        created_at=initial_created,
        updated_at=initial_updated,
        images=[]
    )
    server._save_album_to_disk("move_alb_1", alb)
    server._completed_albums["move_alb_1"] = alb

    from src.server.server import MoveAlbumsRequest
    req = MoveAlbumsRequest(album_ids=["move_alb_1"], target_folder="Favorites")
    res = await server.move_albums(req)
    assert res["success"] is True
    assert res["moved"] == 1

    fpath = os.path.join(str(tmp_path), "move_alb_1.json")
    with open(fpath, "r", encoding="utf-8") as f:
        data = json.load(f)

    assert data["folder"] == "Favorites"
    assert data["created_at"] == initial_created, "created_at must remain immutable on folder move"
    assert data["updated_at"] != initial_updated, "updated_at must update on folder move"


@pytest.mark.asyncio
async def test_album_folder_rename_updates_updated_at(tmp_path, monkeypatch):
    """Verify rename_album_folder updates updated_at on assigned albums while preserving created_at."""
    monkeypatch.setattr(server, "ALBUMS_DIR", str(tmp_path))
    monkeypatch.setattr(server, "_completed_albums", {})
    monkeypatch.setattr(server, "_load_custom_album_folders", lambda: ["OldFolder"])
    monkeypatch.setattr(server, "_save_custom_album_folders", lambda folders: None)

    initial_created = "2026-07-01 14:00:00 UTC"
    initial_updated = "2026-07-01 14:00:00 UTC"
    alb = Album(
        album_id="fren_alb_1",
        title="Folder Rename Album",
        original_title="Folder Rename Album",
        source_page="https://example.com/gallery/fren",
        folder="OldFolder",
        created_at=initial_created,
        updated_at=initial_updated,
        images=[]
    )
    server._save_album_to_disk("fren_alb_1", alb)
    server._completed_albums["fren_alb_1"] = alb

    from src.server.server import RenameAlbumFolderRequest
    req = RenameAlbumFolderRequest(old_name="OldFolder", new_name="NewFolder")
    res = await server.rename_album_folder(req)
    assert res["success"] is True

    fpath = os.path.join(str(tmp_path), "fren_alb_1.json")
    with open(fpath, "r", encoding="utf-8") as f:
        data = json.load(f)

    assert data["folder"] == "NewFolder"
    assert data["created_at"] == initial_created, "created_at must remain immutable on folder rename"
    assert data["updated_at"] != initial_updated, "updated_at must update on folder rename"

