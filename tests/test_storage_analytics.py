import pytest
import asyncio
from src.server.server import get_storage_analytics
from src.server.video_service import cloud_storage

@pytest.mark.asyncio
async def test_storage_analytics_returns_real_data():
    res = await get_storage_analytics()
    assert isinstance(res, dict)
    assert "cloud_huggingface" in res
    assert "render_local" in res
    assert "stream_only" in res
    assert "albums" in res
    assert "local_storage" in res

    # Verify Local Storage stats
    loc = res["local_storage"]
    assert "total_app_bytes" in loc
    assert "videos_bytes" in loc
    assert "videos_count" in loc
    assert "cache_bytes" in loc
    assert "drive_free_bytes" in loc
    assert "drive_total_bytes" in loc
    assert loc["total_app_bytes"] >= 0

    # Verify Hugging Face stats
    hf = res["cloud_huggingface"]
    assert "is_connected" in hf
    assert "total_bytes_used" in hf
    assert isinstance(hf["total_bytes_used"], (int, float))

    # Verify Render Local disk stats
    render = res["render_local"]
    assert "total_bytes_used" in render
    assert "videos_count" in render
    assert isinstance(render["videos_count"], int)
    assert render["videos_count"] >= 0

    # Verify Stream Only stats
    stream = res["stream_only"]
    assert "videos_count" in stream
    assert stream["videos_count"] >= 0

    # Verify Albums stats
    albums = res["albums"]
    assert "total_albums" in albums
    assert "total_photos" in albums
    assert "total_size_bytes" in albums
    assert albums["total_albums"] >= 0
    assert albums["total_photos"] >= 0
    assert albums["total_size_bytes"] >= 0
