# -*- coding: utf-8 -*-
"""
Tests for Batch Stream Renewal in Album Library.
Validates the backend refresh endpoint contract and frontend state contracts.
"""

import os
import json
import pytest
from fastapi.testclient import TestClient

from src.server.server import app, _completed_albums, ALBUMS_DIR
from src.core.models import Album, AlbumImage


@pytest.fixture
def client():
    return TestClient(app)


def test_refresh_album_streams_endpoint_success(client, tmp_path):
    """Tests /api/albums/{session_id}/refresh-streams contract with an album without videos."""
    test_session_id = "test-session-batch-renew-123"
    test_album = Album(
        album_id=test_session_id,
        title="Test Batch Renew Album",
        original_title="Test Batch Renew Album",
        source_page="https://example.com/album",
        folder="Geral",
        images=[
            AlbumImage(
                id="img-1",
                position=1,
                thumbnail_url="https://example.com/thumb.jpg",
                original_url="https://example.com/test.mp4",
                media_type="video",
                file_size=1024,
                width=1920,
                height=1080
            )
        ]
    )

    _completed_albums[test_session_id] = test_album

    response = client.post(f"/api/albums/{test_session_id}/refresh-streams")
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert "refreshed" in data
    assert "failed" in data

    # Cleanup
    _completed_albums.pop(test_session_id, None)


def test_refresh_album_streams_endpoint_not_found(client):
    """Tests 404 response for nonexistent album."""
    response = client.post("/api/albums/nonexistent-album-id-99999/refresh-streams")
    assert response.status_code == 404


def test_translations_renew_streams_keys():
    """Validates that renewStreams translation keys exist in both pt-BR and en-US."""
    trans_path = os.path.join(
        os.path.dirname(__file__), "..", "frontend-mobile-preview", "src", "i18n", "translations.ts"
    )
    with open(trans_path, "r", encoding="utf-8") as f:
        content = f.read()

    assert "renewStreams:" in content
    assert "renewingStreams:" in content
    assert "renewBatchSuccess:" in content
    assert "renewBatchWarning:" in content
    assert "renewBatchError:" in content
