"""Persistent Profile Hub user library (History, Liked, Favorites, Custom Playlists).

Stores user-owned organization lists in dedicated atomic JSON files under ``data/``,
isolated from personal album/video extraction libraries and with read-only merge
compatibility for legacy ``data/favorite_profile_videos.json``.
"""
from __future__ import annotations

from functools import wraps
import hashlib
import json
import os
from pathlib import Path
import re
from threading import RLock
import tempfile
import time
from typing import Any, Dict, List, Optional
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
import uuid

from fastapi import APIRouter, HTTPException

from . import profile_video_favorites_service as legacy_video_favorites

WATCH_HISTORY_FILE = Path("data/profile_hub_watch_history.json")
LIKED_MEDIA_FILE = Path("data/profile_hub_liked_videos.json")
FAVORITE_MEDIA_FILE = Path("data/profile_hub_favorite_media.json")
PLAYLISTS_FILE = Path("data/profile_hub_playlists.json")

MAX_WATCH_HISTORY = 500
ALLOWED_FAVORITE_MEDIA_KINDS = ("video", "album", "playlist", "gif")
ALLOWED_LIBRARY_KINDS = ("video", "album", "playlist", "gif")

_library_lock = RLock()

router = APIRouter(prefix="/api/profile-hub/library", tags=["Profile Hub Library"])


def _locked(operation):
    @wraps(operation)
    def call(*args, **kwargs):
        with _library_lock:
            return operation(*args, **kwargs)

    return call


def _clean_str(value: Any, limit: int = 2048) -> str:
    if not isinstance(value, str):
        return ""
    return value.strip()[:limit]


def _normalize_url(value: Any) -> str:
    raw = _clean_str(value, 4096)
    if not raw:
        return ""
    if raw.startswith("demo:"):
        return raw
    parts = urlsplit(raw)
    if parts.scheme not in ("http", "https") or not parts.netloc:
        return ""
    if parts.username or parts.password:
        return ""
    sorted_query = urlencode(sorted(parse_qsl(parts.query, keep_blank_values=False)))
    return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), parts.path.rstrip("/"), sorted_query, ""))


def canonical_media_key(item: Dict[str, Any]) -> str:
    """Computes a URL-safe, path-safe canonical key for a media item."""
    if not isinstance(item, dict):
        return ""
    raw_url = _clean_str(
        item.get("sourceUrl") or item.get("originalUrl") or item.get("url") or item.get("pageUrl"),
        4096,
    )
    if raw_url:
        m_vkey = re.search(r"viewkey=([a-zA-Z0-9_-]+)", raw_url)
        if m_vkey:
            return f"ph-{m_vkey.group(1)}"
        norm = _normalize_url(raw_url)
        if norm:
            digest = hashlib.sha1(norm.encode("utf-8")).hexdigest()[:20]
            return f"url-{digest}"
    raw_id = _clean_str(item.get("id") or item.get("key"), 128)
    if raw_id:
        safe = re.sub(r"[^a-zA-Z0-9._-]+", "-", raw_id).strip("-")
        if safe:
            return f"id-{safe[:80]}"
    return ""


def _coerce_media_kind(raw_kind: Any, *, strict_favorite: bool = False) -> str:
    kind = _clean_str(raw_kind, 32).lower()
    if kind in ("photo_grid", "photos"):
        kind = "album"
    if strict_favorite:
        if kind not in ALLOWED_FAVORITE_MEDIA_KINDS:
            raise ValueError("Favorites only support video, album, playlist, or gif items")
        return kind
    if kind in ALLOWED_LIBRARY_KINDS:
        return kind
    return "video"


def _clean_tags(value: Any) -> List[str]:
    if not isinstance(value, list):
        return []
    seen = set()
    cleaned: List[str] = []
    for raw in value[:30]:
        tag = _clean_str(raw, 64)
        if tag and tag.lower() not in seen:
            seen.add(tag.lower())
            cleaned.append(tag)
    return cleaned


def _clean_qualities(value: Any) -> List[Dict[str, Any]]:
    if not isinstance(value, list):
        return []
    out: List[Dict[str, Any]] = []
    for entry in value[:12]:
        if not isinstance(entry, dict):
            continue
        url = _clean_str(entry.get("url"), 4096)
        label = _clean_str(entry.get("label"), 64)
        if url or label:
            out.append({"label": label or "HD", "url": url})
    return out


def _normalize_media_item(
    raw: Dict[str, Any],
    *,
    strict_favorite: bool = False,
    existing: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    if not isinstance(raw, dict):
        raise ValueError("Media payload must be an object")
    key = canonical_media_key(raw)
    if not key:
        raise ValueError("Media item requires an id or sourceUrl")
    kind = _coerce_media_kind(
        raw.get("kind") or raw.get("type") or (existing or {}).get("kind"),
        strict_favorite=strict_favorite,
    )

    def pick(field: str, *alts: str, default: str = "") -> str:
        for name in (field, *alts):
            val = _clean_str(raw.get(name), 4096)
            if val:
                return val
        if existing:
            prev = _clean_str(existing.get(field), 4096)
            if prev:
                return prev
        return default

    tags = _clean_tags(raw.get("tags")) or _clean_tags((existing or {}).get("tags"))
    qualities = _clean_qualities(raw.get("qualities")) or _clean_qualities((existing or {}).get("qualities"))
    photos_raw = raw.get("photos") if isinstance(raw.get("photos"), list) else (existing or {}).get("photos")
    photos = [p for p in (photos_raw or []) if isinstance(p, str) and p.strip()][:200]
    published_at = raw.get("publishedAt") if isinstance(raw.get("publishedAt"), (int, float)) else (existing or {}).get("publishedAt")
    image_count = raw.get("imageCount") if isinstance(raw.get("imageCount"), int) else (existing or {}).get("imageCount")
    playlist_count = raw.get("playlistCount") if isinstance(raw.get("playlistCount"), int) else (existing or {}).get("playlistCount")

    normalized: Dict[str, Any] = {
        "key": key,
        "id": pick("id", default=key),
        "kind": kind,
        "title": pick("title", default=""),
        "sourceUrl": pick("sourceUrl", "originalUrl", "url", "pageUrl"),
        "thumbnailUrl": pick("thumbnailUrl", "coverUrl"),
        "videoUrl": pick("videoUrl", "streamUrl"),
        "masterHlsUrl": pick("masterHlsUrl"),
        "qualities": qualities,
        "duration": pick("duration"),
        "resolution": pick("resolution"),
        "creatorId": pick("creatorId"),
        "creatorName": next(
            (
                v
                for v in (
                    _clean_str(raw.get("creatorName"), 256),
                    _clean_str(raw.get("artistName"), 256),
                    _clean_str(raw.get("performer"), 256),
                    _clean_str(raw.get("uploader"), 256),
                    _clean_str((existing or {}).get("creatorName"), 256),
                )
                if v and v.lower() not in {"unknown creator", "criador desconhecido", "unknown"}
            ),
            "",
        ),
        "creatorHandle": pick("creatorHandle"),
        "creatorAvatar": pick("creatorAvatar", "avatarUrl"),
        "creatorUrl": pick("creatorUrl", "authorUrl", "profileUrl"),
        "platform": pick("platform"),
        "category": pick("category"),
        "publishedAt": int(published_at) if isinstance(published_at, (int, float)) else None,
        "publishedDateText": pick("publishedDateText"),
        "tags": tags,
        "photos": photos,
        "imageCount": image_count,
        "playlistCount": playlist_count,
        "addedAt": int((existing or {}).get("addedAt") or raw.get("addedAt") or time.time() * 1000),
    }
    return normalized


def _load_json_list(path: Path, *, strict: bool = True) -> List[Dict[str, Any]]:
    if not path.exists():
        return []
    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except Exception as exc:
        if strict:
            raise RuntimeError(f"Corrupted library file {path.name}: {exc}") from exc
        return []
    if not isinstance(data, list):
        if strict:
            raise RuntimeError(f"Invalid library structure in {path.name}")
        return []
    return [entry for entry in data if isinstance(entry, dict)]


def _save_json_list(path: Path, items: List[Dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_path = tempfile.mkstemp(dir=path.parent, prefix=f".{path.stem}_", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(items, handle, ensure_ascii=False, indent=2)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_path, path)
    except Exception:
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except OSError:
                pass
        raise


def _legacy_video_to_library_item(raw: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    try:
        item = _normalize_media_item(
            {
                **raw,
                "kind": "video",
                "addedAt": int(raw["added_at"] * 1000)
                if isinstance(raw.get("added_at"), (int, float))
                else int(time.time() * 1000),
            },
            strict_favorite=True,
        )
        item["legacySource"] = True
        return item
    except ValueError:
        return None


def _merged_favorites_locked() -> List[Dict[str, Any]]:
    items = [entry for entry in _load_json_list(FAVORITE_MEDIA_FILE, strict=True) if entry.get("kind") in ALLOWED_FAVORITE_MEDIA_KINDS]
    seen_keys = {entry.get("key") for entry in items if entry.get("key")}
    for legacy in legacy_video_favorites.load_favorite_videos():
        converted = _legacy_video_to_library_item(legacy)
        if converted and converted["key"] not in seen_keys:
            items.append(converted)
            seen_keys.add(converted["key"])
    return items


@_locked
def get_library_state() -> Dict[str, Any]:
    return {
        "history": _load_json_list(WATCH_HISTORY_FILE, strict=True),
        "liked": _load_json_list(LIKED_MEDIA_FILE, strict=True),
        "favorites": _merged_favorites_locked(),
        "playlists": _load_json_list(PLAYLISTS_FILE, strict=True),
    }


@_locked
def record_watch_history(raw_item: Dict[str, Any], *, enrich_only: bool = False) -> List[Dict[str, Any]]:
    history = _load_json_list(WATCH_HISTORY_FILE, strict=True)
    incoming_key = canonical_media_key(raw_item)
    if not incoming_key:
        raise ValueError("Watch history item requires id or sourceUrl")
    existing_idx = next((idx for idx, entry in enumerate(history) if entry.get("key") == incoming_key), -1)
    if enrich_only and existing_idx < 0:
        return history
    if enrich_only and existing_idx >= 0:
        existing = history[existing_idx]
        merged = _normalize_media_item(raw_item, existing=existing)
        merged["watchedAt"] = existing.get("watchedAt") or int(time.time() * 1000)
        merged["watchCount"] = max(1, int(existing.get("watchCount") or 1))
        history[existing_idx] = merged
        _save_json_list(WATCH_HISTORY_FILE, history)
        return history
    existing = history.pop(existing_idx) if existing_idx >= 0 else None
    merged = _normalize_media_item(raw_item, existing=existing)
    now_ms = int(time.time() * 1000)
    merged["watchedAt"] = int(raw_item.get("watchedAt")) if isinstance(raw_item.get("watchedAt"), (int, float)) else now_ms
    merged["watchCount"] = int((existing or {}).get("watchCount") or 0) + 1
    history.insert(0, merged)
    if len(history) > MAX_WATCH_HISTORY:
        history = history[:MAX_WATCH_HISTORY]
    _save_json_list(WATCH_HISTORY_FILE, history)
    return history


@_locked
def remove_watch_history_item(item_key: str) -> List[Dict[str, Any]]:
    clean = _clean_str(item_key, 128)
    history = _load_json_list(WATCH_HISTORY_FILE, strict=True)
    next_history = [entry for entry in history if entry.get("key") != clean and entry.get("id") != clean]
    if len(next_history) != len(history):
        _save_json_list(WATCH_HISTORY_FILE, next_history)
    return next_history


@_locked
def clear_watch_history() -> List[Dict[str, Any]]:
    _load_json_list(WATCH_HISTORY_FILE, strict=True)
    _save_json_list(WATCH_HISTORY_FILE, [])
    return []


@_locked
def set_liked_media(raw_item: Dict[str, Any], liked: bool) -> Dict[str, Any]:
    if not isinstance(liked, bool):
        raise ValueError("liked boolean is required")
    items = _load_json_list(LIKED_MEDIA_FILE, strict=True)
    key = canonical_media_key(raw_item)
    if not key:
        raise ValueError("Media item requires id or sourceUrl")
    existing_idx = next((idx for idx, entry in enumerate(items) if entry.get("key") == key), -1)
    if liked:
        existing = items.pop(existing_idx) if existing_idx >= 0 else None
        normalized = _normalize_media_item(raw_item, existing=existing)
        normalized["likedAt"] = int((existing or {}).get("likedAt") or time.time() * 1000)
        items.insert(0, normalized)
        _save_json_list(LIKED_MEDIA_FILE, items)
        return {"liked": True, "item": normalized, "items": items, "total": len(items)}
    removed = items.pop(existing_idx) if existing_idx >= 0 else None
    if removed is not None:
        _save_json_list(LIKED_MEDIA_FILE, items)
    return {"liked": False, "item": removed, "items": items, "total": len(items)}


@_locked
def set_favorite_media(raw_item: Dict[str, Any], favorited: bool) -> Dict[str, Any]:
    if not isinstance(favorited, bool):
        raise ValueError("favorited boolean is required")
    items = _load_json_list(FAVORITE_MEDIA_FILE, strict=True)
    key = canonical_media_key(raw_item)
    if not key:
        raise ValueError("Media item requires id or sourceUrl")

    # Always validate allowed media kind (reject creators/profiles).
    _coerce_media_kind(raw_item.get("kind") or raw_item.get("type"), strict_favorite=True)

    existing_idx = next((idx for idx, entry in enumerate(items) if entry.get("key") == key), -1)
    if favorited:
        existing = items.pop(existing_idx) if existing_idx >= 0 else None
        normalized = _normalize_media_item(raw_item, strict_favorite=True, existing=existing)
        items.insert(0, normalized)
        _save_json_list(FAVORITE_MEDIA_FILE, items)
        return {"favorited": True, "item": normalized, "items": _merged_favorites_locked(), "total": len(items)}

    removed = items.pop(existing_idx) if existing_idx >= 0 else None
    if removed is not None:
        _save_json_list(FAVORITE_MEDIA_FILE, items)

    # If the removed video also lived in legacy favorite_profile_videos.json, remove only that entry cleanly.
    v_id = _clean_str(raw_item.get("id"), 128)
    orig_url = _clean_str(raw_item.get("sourceUrl") or raw_item.get("originalUrl") or raw_item.get("url"), 4096)
    legacy_videos = legacy_video_favorites.load_favorite_videos()
    if any(legacy_video_favorites._matches_video(v, v_id, orig_url) for v in legacy_videos):
        next_legacy = [v for v in legacy_videos if not legacy_video_favorites._matches_video(v, v_id, orig_url)]
        legacy_video_favorites.save_favorite_videos(next_legacy)

    merged = _merged_favorites_locked()
    return {"favorited": False, "item": removed, "items": merged, "total": len(merged)}


@_locked
def create_playlist(name: str, description: str = "", playlist_id: Optional[str] = None) -> Dict[str, Any]:
    clean_name = _clean_str(name, 120)
    if not clean_name:
        raise ValueError("Playlist name is required")
    playlists = _load_json_list(PLAYLISTS_FILE, strict=True)
    now_ms = int(time.time() * 1000)
    new_id = _clean_str(playlist_id, 64) or f"pl-{uuid.uuid4().hex[:10]}"
    if any(pl.get("id") == new_id for pl in playlists):
        new_id = f"pl-{uuid.uuid4().hex[:10]}"
    playlist = {
        "id": new_id,
        "name": clean_name,
        "description": _clean_str(description, 400),
        "coverUrl": "",
        "createdAt": now_ms,
        "updatedAt": now_ms,
        "items": [],
    }
    playlists.insert(0, playlist)
    _save_json_list(PLAYLISTS_FILE, playlists)
    return {"playlist": playlist, "playlists": playlists}


@_locked
def update_playlist(playlist_id: str, name: Optional[str] = None, description: Optional[str] = None) -> Dict[str, Any]:
    playlists = _load_json_list(PLAYLISTS_FILE, strict=True)
    target = next((pl for pl in playlists if pl.get("id") == playlist_id), None)
    if target is None:
        raise LookupError("Playlist not found")
    if name is not None:
        clean_name = _clean_str(name, 120)
        if not clean_name:
            raise ValueError("Playlist name cannot be empty")
        target["name"] = clean_name
    if description is not None:
        target["description"] = _clean_str(description, 400)
    target["updatedAt"] = int(time.time() * 1000)
    _save_json_list(PLAYLISTS_FILE, playlists)
    return {"playlist": target, "playlists": playlists}


@_locked
def delete_playlist(playlist_id: str) -> Dict[str, Any]:
    playlists = _load_json_list(PLAYLISTS_FILE, strict=True)
    next_playlists = [pl for pl in playlists if pl.get("id") != playlist_id]
    if len(next_playlists) == len(playlists):
        raise LookupError("Playlist not found")
    _save_json_list(PLAYLISTS_FILE, next_playlists)
    return {"deleted": True, "id": playlist_id, "playlists": next_playlists}


def _refresh_playlist_cover(playlist: Dict[str, Any]) -> None:
    items = playlist.get("items") or []
    first_thumb = next((entry.get("thumbnailUrl") for entry in items if isinstance(entry, dict) and entry.get("thumbnailUrl")), "")
    playlist["coverUrl"] = first_thumb or ""


@_locked
def set_playlist_item(playlist_id: str, raw_item: Dict[str, Any], present: bool) -> Dict[str, Any]:
    if not isinstance(present, bool):
        raise ValueError("present boolean is required")
    playlists = _load_json_list(PLAYLISTS_FILE, strict=True)
    playlist = next((pl for pl in playlists if pl.get("id") == playlist_id), None)
    if playlist is None:
        raise LookupError("Playlist not found")
    items = playlist.setdefault("items", [])
    key = canonical_media_key(raw_item)
    if not key:
        raise ValueError("Media item requires id or sourceUrl")
    existing_idx = next((idx for idx, entry in enumerate(items) if isinstance(entry, dict) and entry.get("key") == key), -1)
    if present:
        existing = items.pop(existing_idx) if existing_idx >= 0 else None
        normalized = _normalize_media_item(raw_item, existing=existing)
        items.insert(0, normalized)
    elif existing_idx >= 0:
        items.pop(existing_idx)
    playlist["updatedAt"] = int(time.time() * 1000)
    _refresh_playlist_cover(playlist)
    _save_json_list(PLAYLISTS_FILE, playlists)
    return {"playlist": playlist, "playlists": playlists, "present": present}


def _run_route(operation):
    try:
        return operation()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/state")
async def api_get_library_state():
    return _run_route(get_library_state)


@router.post("/history")
async def api_record_watch_history(payload: Dict[str, Any]):
    item = payload.get("item") if isinstance(payload.get("item"), dict) else payload
    enrich_only = bool(payload.get("enrichOnly"))
    history = _run_route(lambda: record_watch_history(item, enrich_only=enrich_only))
    return {"history": history}


@router.delete("/history/{item_key}")
async def api_remove_history_item(item_key: str):
    history = _run_route(lambda: remove_watch_history_item(item_key))
    return {"history": history}


@router.delete("/history")
async def api_clear_history():
    history = _run_route(clear_watch_history)
    return {"history": history}


@router.put("/liked")
async def api_set_liked_media(payload: Dict[str, Any]):
    item = payload.get("item")
    liked = payload.get("liked")
    return _run_route(lambda: set_liked_media(item, liked))


@router.put("/favorites")
async def api_set_favorite_media(payload: Dict[str, Any]):
    item = payload.get("item")
    favorited = payload.get("favorited")
    return _run_route(lambda: set_favorite_media(item, favorited))


@router.post("/playlists")
async def api_create_playlist(payload: Dict[str, Any]):
    name = payload.get("name", "")
    description = payload.get("description", "")
    playlist_id = payload.get("id")
    return _run_route(lambda: create_playlist(name, description, playlist_id=playlist_id))


@router.patch("/playlists/{playlist_id}")
async def api_update_playlist(playlist_id: str, payload: Dict[str, Any]):
    name = payload.get("name")
    description = payload.get("description")
    return _run_route(lambda: update_playlist(playlist_id, name=name, description=description))


@router.delete("/playlists/{playlist_id}")
async def api_delete_playlist(playlist_id: str):
    return _run_route(lambda: delete_playlist(playlist_id))


@router.put("/playlists/{playlist_id}/items")
async def api_set_playlist_item(playlist_id: str, payload: Dict[str, Any]):
    item = payload.get("item")
    present = payload.get("present")
    return _run_route(lambda: set_playlist_item(playlist_id, item, present))
