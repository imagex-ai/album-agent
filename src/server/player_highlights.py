"""Bounded, silent player enhancement; no library migration or startup imports.

Server-owned local files, stored heatmaps and bounded temporary original media
are analyzed. The frozen detector's narrative-only fallback is never published.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import math
import os
import sqlite3
import time
from contextlib import closing
from pathlib import Path
from typing import Callable

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

ANALYZED_METHODS = frozenset({"yt_dlp_heatmap", "fast_resampled_audio_crescendo"})
RETRY_SECONDS = 5 * 60  # Avoid repeated analysis of silent/unavailable media.


def analyzed_result(result):
    if not isinstance(result, dict) or result.get("detection_method") not in ANALYZED_METHODS:
        return None
    highlights = result.get("highlights")
    if not isinstance(highlights, list) or not highlights:
        return None
    for item in highlights:
        if not isinstance(item, dict):
            return None
        start, end = item.get("start"), item.get("end")
        if (isinstance(start, bool) or isinstance(end, bool)
                or not isinstance(start, (float, int)) or not isinstance(end, (float, int))
                or not math.isfinite(start) or not math.isfinite(end) or start < 0 or end <= start):
            return None
    return result


class PlayerHighlightService:
    def __init__(self, cache_path: Path, load_video: Callable, analyze: Callable, remote_media=None):
        self.cache_path = Path(cache_path)
        self.load_video = load_video
        self.analyze = analyze
        self.remote_media = remote_media
        self.slots = asyncio.Semaphore(1)
        self.inflight = {}
        self.retry_after = {}

    def _cached(self, key, value=None):
        self.cache_path.parent.mkdir(parents=True, exist_ok=True)
        # sqlite's transaction context commits but does not close the handle;
        # close explicitly so temporary caches are removable on Windows.
        with closing(sqlite3.connect(self.cache_path)) as db, db:
            db.execute("CREATE TABLE IF NOT EXISTS highlights (identity TEXT PRIMARY KEY, result TEXT NOT NULL)")
            if value is not None:
                db.execute("INSERT OR REPLACE INTO highlights VALUES (?, ?)", (key, json.dumps(value)))
                return value
            row = db.execute("SELECT result FROM highlights WHERE identity = ?", (key,)).fetchone()
            return analyzed_result(json.loads(row[0])) if row else None

    def _resolve(self, video_id, source_record=None):
        video = source_record if source_record is not None else self.load_video(video_id)
        if not video:
            return {}
        path = video.get("full_path")
        local = path if path and os.path.isfile(path) else None
        heatmap = video.get("heatmap_data")
        if not local and not heatmap:
            if self.remote_media and video.get('source_url'):
                key = self._identity(video_id, video, None, heatmap)
                cached = self._cached(key)
                if cached:
                    return cached
                with self.remote_media(video) as remote_path:
                    return self._analyze_resolved(video_id, video, remote_path, heatmap, remote=True, source_record=source_record)
            return {}  # A duration alone cannot establish a real highlight.
        return self._analyze_resolved(video_id, video, local, heatmap, source_record=source_record)

    @staticmethod
    def _identity(video_id, video, stamp, heatmap):
        return hashlib.sha256(json.dumps([video_id, video.get('full_path'), video.get('source_url'), stamp, heatmap], sort_keys=True).encode()).hexdigest()

    def _analyze_resolved(self, video_id, video, local, heatmap, remote=False, source_record=None):
        path = video.get('full_path')
        stamp = (os.stat(local).st_mtime_ns, os.stat(local).st_size) if local else None
        key = self._identity(video_id, video, None if remote else stamp, heatmap)
        cached = self._cached(key)
        if cached:
            return cached
        result = analyzed_result(self.analyze(
            video_path=local, duration=video.get("duration_seconds") or 0,
            heatmap_data=heatmap,
        ))
        if not result:
            return {}
        # Recheck existence/identity after the slow operation: never resurrect a
        # deleted library entry or attach the result to a replaced source.
        current = source_record if source_record is not None else self.load_video(video_id)
        if not current or current.get("full_path") != path or current.get("source_url") != video.get("source_url"):
            return {}
        if local and (not os.path.isfile(local) or (os.stat(local).st_mtime_ns, os.stat(local).st_size) != stamp):
            return {}
        return self._cached(key, result)

    async def resolve(self, video_id, *, source_record=None):
        if self.retry_after.get(video_id, 0) > time.monotonic():
            return {}
        task = self.inflight.get(video_id)
        if task is None:
            # No server backlog: client retries silently on a later visit.
            if self.inflight:
                return {}
            async def run():
                try:
                    async with self.slots:
                        result = await asyncio.to_thread(self._resolve, video_id, source_record)
                    if not result:
                        self.retry_after[video_id] = time.monotonic() + RETRY_SECONDS
                    return result
                except Exception:
                    self.retry_after[video_id] = time.monotonic() + RETRY_SECONDS
                    return {}
                finally:
                    self.inflight.pop(video_id, None)
            task = asyncio.create_task(run())
            self.inflight[video_id] = task
        # Client disconnect must not free the slot while its worker still runs.
        return await asyncio.shield(task)


class HighlightRequest(BaseModel):
    video_id: str = Field(min_length=1, max_length=1024)


class SourceHighlightRequest(BaseModel):
    source_url: str = Field(min_length=1, max_length=4096)


def analysis_source_url(url):
    # Installed watch adapters validate exact media routes. A profile, album,
    # arbitrary CDN URL or unknown provider cannot enter the library endpoint.
    from .profile_hub_comments import youtube_identity
    from .profile_hub_comment_sources import html_comment_source
    identity = youtube_identity(url)
    if identity:
        return identity[1]
    source = html_comment_source(url)
    if source is None:
        raise ValueError('Unsupported analysis source')
    return source.normalize_url(url)


def player_highlight_router(service: PlayerHighlightService):
    router = APIRouter()

    @router.post("/api/player-highlights/resolve")
    async def resolve_highlights(body: HighlightRequest):
        return await service.resolve(body.video_id)

    @router.post('/api/player-highlights/resolve-source')
    async def resolve_source_highlights(body: SourceHighlightRequest):
        try:
            canonical = analysis_source_url(body.source_url)
        except ValueError as error:
            raise HTTPException(422, detail={'code':'invalid_analysis_source'}) from error
        identity = 'source:' + hashlib.sha256(canonical.encode()).hexdigest()
        return await service.resolve(identity, source_record={'source_url':canonical})

    return router
