import pytest
import json
from unittest.mock import AsyncMock, patch
from starlette.testclient import TestClient
from src.server.multi_album_service import (
    DiscoveryRequest,
    DiscoveredAlbumItem,
    DiscoveryResponse,
    MultiAlbumService,
    router
)
from fastapi import FastAPI

test_app = FastAPI()
test_app.include_router(router)
client = TestClient(test_app)

def test_discovery_request_defaults():
    req = DiscoveryRequest(url="https://example.com/galleries")
    assert req.max_pages == 50
    assert req.max_related == 0
    assert req.performer_name is None

def test_discovery_invalid_url():
    resp = client.post("/api/multi-album/discover-stream", json={"url": "not_a_valid_url"})
    assert resp.status_code == 400

@pytest.mark.asyncio
async def test_multi_page_pagination_detection():
    # Mock page 1 and page 2 HTML
    page1_html = """
    <html>
      <body>
        <div class="gallery-item">
          <a href="/album/nature-1" title="Nature Walk 1">
            <img src="/thumb1.jpg" alt="Nature 1" />
          </a>
        </div>
        <div class="pagination">
          <span class="current">1</span>
          <a class="next" href="/galleries?page=2">Next &raquo;</a>
        </div>
      </body>
    </html>
    """

    page2_html = """
    <html>
      <body>
        <div class="gallery-item">
          <a href="/album/nature-2" title="Nature Walk 2">
            <img src="/thumb2.jpg" alt="Nature 2" />
          </a>
        </div>
        <div class="pagination">
          <a href="/galleries?page=1">1</a>
          <span class="current">2</span>
        </div>
      </body>
    </html>
    """

    class MockResponse:
        def __init__(self, text, status_code=200):
            self.text = text
            self.status_code = status_code

    async def mock_get(url, *args, **kwargs):
        if "page=2" in url:
            return MockResponse(page2_html)
        return MockResponse(page1_html)

    req = DiscoveryRequest(url="https://example.com/galleries", max_pages=3)

    events = []
    with patch("httpx.AsyncClient.get", side_effect=mock_get):
        async for chunk in MultiAlbumService.stream_discover_albums(req):
            if chunk.startswith("data: "):
                payload = json.loads(chunk[6:].strip())
                events.append(payload)

    album_events = [e for e in events if e.get("type") == "album"]
    page_events = [e for e in events if e.get("type") == "page"]
    done_events = [e for e in events if e.get("type") == "done"]

    assert len(page_events) >= 2
    assert any(a["album"]["url"] == "https://example.com/album/nature-1" for a in album_events)
    assert any(a["album"]["url"] == "https://example.com/album/nature-2" for a in album_events)
    assert len(done_events) == 1
    assert done_events[0]["pages_scanned"] >= 2
