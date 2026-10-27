# -*- coding: utf-8 -*-
"""
Tests for Web Video Scraper Multi-Page Pagination Crawler.
Validates multi-page link seeking, limits enforcement, pagination deduplication, and endpoint contracts.
"""

import pytest
from fastapi.testclient import TestClient
from src.core.network_profiles import _b64d
from src.server.server import app, ScanPageVideosRequest


@pytest.fixture
def client():
    return TestClient(app)


def test_scan_page_videos_request_model_defaults():
    """Validates that ScanPageVideosRequest has generous multi-page defaults."""
    req = ScanPageVideosRequest(url="https://example.com/videos")
    assert req.url == "https://example.com/videos"
    assert req.max_items == 5000
    assert req.max_pages == 50

    custom_req = ScanPageVideosRequest(url="https://example.com/tag/test", max_items=120, max_pages=3)
    assert custom_req.max_items == 120
    assert custom_req.max_pages == 3


def test_scan_page_invalid_url(client):
    """Validates that scanning an invalid URL returns a 400 bad request."""
    response = client.post("/api/video-scraper/scan-page", json={"url": "ftp://invalid-url"})
    assert response.status_code == 400

    empty_response = client.post("/api/video-scraper/scan-page", json={"url": ""})
    assert empty_response.status_code == 400


def test_scan_page_multi_page_live_seeker(client):
    """
    Live test against real pagination:
    Ensures that when given a tag/playlist URL, it actively seeks next pages
    and extracts more than a single page's count (e.g. > 64 videos across 2+ pages).
    """
    # Request 2 pages with a limit of 100 items
    payload = {
        "url": _b64d("aHR0cHM6Ly93d3cuZXBvcm5lci5jb20vdGFnL3Bvdi1wYXdnLw=="),
        "max_items": 100,
        "max_pages": 2
    }
    response = client.post("/api/video-scraper/scan-page", json=payload)
    assert response.status_code == 200
    data = response.json()

    assert data["success"] is True
    assert "videos" in data
    assert "pages_scanned" in data
    # Verified: Page 1 has 64 items, so with 2 pages and max_items=100, it should have scanned 2 pages and found 100 videos!
    assert data["pages_scanned"] >= 2
    assert len(data["videos"]) == 100
    assert data["total_found"] >= 100

    # Ensure videos from page 2 are tagged with page_found == 2
    p2_items = [v for v in data["videos"] if v.get("page_found") == 2]
    assert len(p2_items) > 0

    # Ensure no duplicate video IDs exist in the result
    video_ids = [v["id"] for v in data["videos"]]
    assert len(video_ids) == len(set(video_ids))


def test_scan_page_stream_realtime_events(client):
    """
    Validates that /api/video-scraper/scan-page-stream yields real-time SSE events
    as each page is crawled, allowing dynamic UI loading.
    """
    import json

    payload = {
        "url": _b64d("aHR0cHM6Ly93d3cuZXBvcm5lci5jb20vdGFnL3Bvdi1wYXdnLw=="),
        "max_items": 75,
        "max_pages": 2
    }
    events = []
    with client.stream("POST", "/api/video-scraper/scan-page-stream", json=payload) as response:
        assert response.status_code == 200
        for line in response.iter_lines():
            if line and line.startswith("data:"):
                raw_json = line[5:].strip()
                if raw_json:
                    events.append(json.loads(raw_json))

    # Must contain page events and a complete event
    page_events = [ev for ev in events if ev.get("type") == "page"]
    complete_events = [ev for ev in events if ev.get("type") == "complete"]

    assert len(page_events) >= 1
    assert len(complete_events) == 1
    assert page_events[0]["page_number"] == 1
    assert "new_videos" in page_events[0]
    assert len(page_events[0]["new_videos"]) > 0
    assert complete_events[0]["success"] is True
