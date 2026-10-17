# -*- coding: utf-8 -*-
"""
Unit & Integration tests for Multi-Album Per-Album Image Inspection & Subset Selection:
- _unwrap_image_url_for_match
- _filter_album_by_selected_urls
- POST /api/multi-album/preview-album
"""

import urllib.parse
from fastapi.testclient import TestClient
from src.core.models import Album, AlbumImage
from src.server.server import (
    app,
    _unwrap_image_url_for_match,
    _filter_album_by_selected_urls,
    _multi_album_preview_cache,
)


def test_unwrap_image_url_for_match_handles_proxy_and_direct_urls():
    raw_url = "https://cdn.example.com/albums/99/photo_01.jpg"
    proxied = f"/api/proxy-image?url={urllib.parse.quote(raw_url, safe='')}&referer=https://example.com"
    assert _unwrap_image_url_for_match(raw_url) == raw_url
    assert _unwrap_image_url_for_match(proxied) == raw_url
    assert _unwrap_image_url_for_match("") == ""


def test_filter_album_by_selected_urls_filters_exact_subset_and_updates_counts():
    sample_album = Album(
        album_id="test-session-123",
        title="Test Subset Album",
        original_title="Test Subset Album",
        source_page="https://example.com/album/123",
        images=[
            AlbumImage(
                id="img-1",
                position=1,
                original_url="https://cdn.example.com/img1.jpg",
                thumbnail_url="https://cdn.example.com/thumb1.jpg",
                media_type="image",
            ),
            AlbumImage(
                id="img-2",
                position=2,
                original_url="/api/proxy-image?url=" + urllib.parse.quote("https://cdn.example.com/img2.gif", safe=""),
                thumbnail_url="https://cdn.example.com/thumb2.gif",
                media_type="gif",
                is_animated=True,
                format="gif",
            ),
            AlbumImage(
                id="img-3",
                position=3,
                original_url="https://cdn.example.com/img3.jpg",
                thumbnail_url="https://cdn.example.com/thumb3.jpg",
                media_type="image",
            ),
            AlbumImage(
                id="img-4",
                position=4,
                original_url="https://cdn.example.com/img4.jpg",
                thumbnail_url="https://cdn.example.com/thumb4.jpg",
                media_type="image",
            ),
        ],
    )

    selected = [
        "https://cdn.example.com/img2.gif",
        "https://cdn.example.com/img4.jpg",
    ]
    filtered = _filter_album_by_selected_urls(sample_album, selected)

    assert len(filtered.images) == 2
    assert [img.id for img in filtered.images] == ["img-2", "img-4"]
    assert [img.position for img in filtered.images] == [1, 2]
    assert filtered.telemetry.originals_resolved == 2
    assert filtered.metadata["custom_selected_count"] == 2
    assert filtered.cover_image_url == "https://cdn.example.com/thumb2.gif"


def test_filter_album_by_selected_urls_edge_cases():
    sample_album = Album(
        album_id="edge-case-1",
        title="Edge Case Album",
        original_title="Edge Case Album",
        source_page="https://example.com/album/edge",
        images=[
            AlbumImage(id="1", position=1, original_url="https://cdn.example.com/a.jpg", thumbnail_url="https://cdn.example.com/a.jpg"),
            AlbumImage(id="2", position=2, original_url="https://cdn.example.com/b.jpg", thumbnail_url="https://cdn.example.com/b.jpg"),
        ],
    )

    untouched = _filter_album_by_selected_urls(sample_album, None)
    assert len(untouched.images) == 2

    non_matching = _filter_album_by_selected_urls(sample_album, ["https://cdn.example.com/nonexistent.jpg"])
    assert len(non_matching.images) == 2


def test_preview_album_endpoint_returns_cached_album_images():
    client = TestClient(app)
    test_url = "https://example.com/gallery/preview-test-999"
    _multi_album_preview_cache[test_url] = Album(
        album_id="preview-999",
        title="Preview Cached Album",
        original_title="Preview Cached Album",
        source_page=test_url,
        images=[
            AlbumImage(
                id="p-1",
                position=1,
                thumbnail_url="https://cdn.example.com/p1_thumb.jpg",
                original_url="https://cdn.example.com/p1_full.jpg",
                width=1920,
                height=1080,
                file_size=204800,
                format="jpeg",
                media_type="image",
                is_animated=False,
                title="Photo 1",
            ),
            AlbumImage(
                id="p-2",
                position=2,
                thumbnail_url="https://cdn.example.com/p2_thumb.gif",
                original_url="https://cdn.example.com/p2_full.gif",
                width=800,
                height=1200,
                file_size=512000,
                format="gif",
                media_type="gif",
                is_animated=True,
                title="Anim 2",
            ),
        ],
    )

    try:
        resp = client.post(
            "/api/multi-album/preview-album",
            json={"url": test_url, "title": "Preview Cached Album"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        assert data["total_images"] == 2
        assert len(data["images"]) == 2
        assert data["images"][0]["original_url"] == "https://cdn.example.com/p1_full.jpg"
        assert data["images"][1]["media_type"] == "gif"
    finally:
        _multi_album_preview_cache.pop(test_url, None)


def test_subset_saved_album_in_completed_albums_does_not_poison_preview_album():
    """
    Regression test for Bug 1:
    When a user saves only 1 of 3 images from an album into _completed_albums,
    subsequent calls to /api/multi-album/preview-album must still return all 3
    original album images from _multi_album_preview_cache rather than the 1-image
    subset stored in _completed_albums.
    """
    from src.server.server import _completed_albums

    client = TestClient(app)
    test_url = "https://example.com/gallery/subset-save-regression-777"
    full_album = Album(
        album_id="full-777",
        title="Full 3-Image Album",
        original_title="Full 3-Image Album",
        source_page=test_url,
        images=[
            AlbumImage(
                id="f-1",
                position=1,
                thumbnail_url="https://cdn.example.com/f1_thumb.jpg",
                original_url="https://cdn.example.com/f1_full.jpg",
                media_type="image",
            ),
            AlbumImage(
                id="f-2",
                position=2,
                thumbnail_url="https://cdn.example.com/f2_thumb.jpg",
                original_url="https://cdn.example.com/f2_full.jpg",
                media_type="image",
            ),
            AlbumImage(
                id="f-3",
                position=3,
                thumbnail_url="https://cdn.example.com/f3_thumb.gif",
                original_url="https://cdn.example.com/f3_full.gif",
                media_type="gif",
                is_animated=True,
                format="gif",
            ),
        ],
    )

    # Simulate caching full album before filtering & saving a 1-image subset into _completed_albums
    _multi_album_preview_cache[test_url] = full_album.model_copy(deep=True)
    subset_album = _filter_album_by_selected_urls(
        full_album.model_copy(deep=True),
        ["https://cdn.example.com/f2_full.jpg"],
    )
    assert subset_album.metadata.get("is_subset_selection") is True
    assert subset_album.metadata.get("original_total_count") == 3
    assert len(subset_album.images) == 1

    _completed_albums["subset-session-777"] = subset_album

    try:
        resp = client.post(
            "/api/multi-album/preview-album",
            json={"url": test_url, "title": "Full 3-Image Album"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        # Must return all 3 images, NOT the 1-image subset!
        assert data["total_images"] == 3
        assert [img["original_url"] for img in data["images"]] == [
            "https://cdn.example.com/f1_full.jpg",
            "https://cdn.example.com/f2_full.jpg",
            "https://cdn.example.com/f3_full.gif",
        ]
    finally:
        _multi_album_preview_cache.pop(test_url, None)
        _completed_albums.pop("subset-session-777", None)

