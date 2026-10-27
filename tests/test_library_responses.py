"""Pure response tests: no server startup, library writes or remote requests."""
import ast
import asyncio
import gzip
import json
import threading
import time
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Dict, List, Optional

import httpx
import pytest
from fastapi import FastAPI, HTTPException, Query, Request, Response

from src.server.library_responses import LibraryResponseCache, accepts_gzip, album_page


def records(count=51):
    return [{"session_id": str(i), "album_id": str(i), "title": "Álbum", "images": [{"id": str(i)}], "total_images": 1} for i in range(count)]


def test_cursor_pages_preserve_complete_records_and_optional_preview_limit():
    source = records()
    first = album_page(source, limit=24)
    # A new album inserted before the cursor must not duplicate or skip the rest.
    second = album_page([records(1)[0], *source], after=first[-1]["session_id"], limit=24)
    assert [a["session_id"] for a in first + second] == [str(i) for i in range(48)]
    preview = album_page(source, limit=1, limit_images=0)[0]
    assert preview["images"] == [] and preview["total_images"] == 1
    assert source[0]["images"]
    with pytest.raises(KeyError):
        album_page(source, after="deleted", limit=24)


def test_encoding_is_cached_bounded_and_invalidated_for_a_new_snapshot():
    cache = LibraryResponseCache(max_bytes=1000)
    source = records(2)
    body = cache.encode(source, "page", source, True)
    assert json.loads(gzip.decompress(body)) == source
    assert cache.encode(source, "page", source, True) is body
    changed = records(3)
    assert len(json.loads(gzip.decompress(cache.encode(changed, "page", changed, True)))) == 3
    for i in range(100):
        cache.encode(changed, i, records(2))
    assert cache._size <= 1000


def test_gzip_negotiation_respects_explicit_opt_out():
    assert accepts_gzip('gzip, deflate, br')
    assert accepts_gzip('*;q=0.5')
    assert not accepts_gzip('gzip;q=0, *;q=1')
    assert not accepts_gzip('br, gzip; q=0.0')


def isolated_app():
    # Compile the actual decorated routes without importing server.py (its
    # startup initializes real media services and persistent jobs).
    source = Path(__file__).parents[1] / "src/server/server.py"
    tree = ast.parse(source.read_text(encoding="utf-8"))
    selected = [node for node in tree.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in {"list_albums", "get_all_jobs"}]
    app = FastAPI()
    data = records()
    state = {
        "app": app, "Request": Request, "Response": Response, "Query": Query,
        "HTTPException": HTTPException, "Optional": Optional, "List": List, "Dict": Dict, "Any": Any,
        "threading": threading, "json": json, "asyncio": asyncio,
        "album_page": album_page,
        "accepts_gzip": accepts_gzip,
        "hashlib": __import__("hashlib"), "re": __import__("re"),
        "_album_response_lock": threading.RLock(), "_album_response_cache": LibraryResponseCache(),
        "_summaries_dirty": False, "_cached_album_summaries": data,
        "_load_albums_from_disk": lambda: None, "_load_jobs_from_disk": lambda: None,
        "_active_jobs": {"one": {"session_id": "one", "status": "completed"}},
    }
    exec(compile(ast.Module(body=selected, type_ignores=[]), str(source), "exec"), state)

    @app.get('/health')
    async def health():
        return {"ok": True}
    return app, state


@pytest.mark.asyncio
async def test_real_routes_page_compress_validate_and_revalidate_jobs():
    app, _ = isolated_app()
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://fixture") as client:
        page = await client.get('/api/albums?limit=24')
        assert len(page.json()) == 24
        assert page.headers['X-Library-Paging'] == 'cursor'
        assert page.headers['content-encoding'] == 'gzip'
        assert (await client.get('/api/albums?after=23&limit=24')).json()[0]['session_id'] == '24'
        assert len((await client.get('/api/albums')).json()) == 51
        assert (await client.get('/api/albums?after=deleted&limit=24')).status_code == 409
        assert (await client.get('/api/albums?limit=0')).status_code == 422
        first = await client.get('/api/jobs')
        assert first.json()[0]['session_id'] == 'one'
        second = await client.get('/api/jobs', headers={"If-None-Match": first.headers['etag']})
        assert second.status_code == 304 and second.content == b''


@pytest.mark.asyncio
async def test_album_encoding_does_not_block_the_async_event_loop():
    app, state = isolated_app()
    started = threading.Event()
    original = state['_album_response_cache'].encode

    def slow_encoding(*args, **kwargs):
        started.set()
        time.sleep(0.15)
        return original(*args, **kwargs)
    state['_album_response_cache'].encode = slow_encoding
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://fixture") as client:
        pending = asyncio.create_task(client.get('/api/albums?limit=24'))
        for _ in range(100):
            if started.is_set():
                break
            await asyncio.sleep(0.001)
        assert started.is_set()
        health = await client.get('/health')
        assert health.status_code == 200
        assert not pending.done(), 'Health must respond while album encoding is still running'
        assert (await pending).status_code == 200


@pytest.mark.asyncio
async def test_invalidation_during_summary_build_is_not_lost():
    app, state = isolated_app()
    state.update({"_summaries_dirty": True, "_cached_album_summaries": [], "_album_summary_revision": 0, "_disk_album_mtimes": {}})
    entries = {str(i): SimpleNamespace(metadata={}, created_at=str(i), updated_at=str(i), is_favorite=False, record=record) for i, record in enumerate(records(3))}
    state['_completed_albums'] = entries
    invalidated = False

    def summary(album):
        nonlocal invalidated
        if not invalidated:
            invalidated = True
            state['_album_summary_revision'] += 1
        return {**album.record}
    state['AgentDebugger'] = SimpleNamespace(get_ui_summary=summary)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://fixture") as client:
        assert len((await client.get('/api/albums?limit=24')).json()) == 3
        assert state['_summaries_dirty'] is True
        assert len((await client.get('/api/albums?limit=24')).json()) == 3
        assert state['_summaries_dirty'] is False
