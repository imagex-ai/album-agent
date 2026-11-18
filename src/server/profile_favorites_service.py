"""Service for managing user's favorite creators/profiles."""
import json
import os
import tempfile
import time
from pathlib import Path
from typing import Any, Dict, List
from threading import RLock
from urllib.parse import urlsplit, urlunsplit
from functools import wraps

FAVORITES_FILE = Path("data/favorite_profiles.json")
_favorites_lock = RLock()


def _locked(operation):
    @wraps(operation)
    def call(*args, **kwargs):
        with _favorites_lock:
            return operation(*args, **kwargs)
    return call


def _clean_url(url: str) -> str:
    value = (url or "").strip()
    parts = urlsplit(value)
    if parts.scheme in ("http", "https"):
        return urlunsplit((parts.scheme, parts.netloc.lower(), parts.path.rstrip("/"), parts.query, ""))
    return value.rstrip("/")


def set_favorite_profile(profile_data: Dict[str, Any], favorited: bool) -> Dict[str, Any]:
    """Idempotent desired-state write; legacy POST keeps its toggle contract."""
    if not isinstance(profile_data.get("url"), str):
        raise ValueError("Profile URL is required")
    url = _clean_url(profile_data["url"])
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname or parts.username or parts.password:
        raise ValueError("A valid HTTP profile URL is required")
    with _favorites_lock:
        profiles = load_favorite_profiles(strict=True)
        existing = next((value for value in profiles if _clean_url(value.get("url", "")) == url), None)
        if favorited and existing is None:
            return toggle_favorite_profile(profile_data)
        if not favorited and existing is not None:
            remove_favorite_profile(url)
        return {"favorited": favorited, "url": url, "profile": existing, "total": len(load_favorite_profiles())}


def load_favorite_profiles(strict=False) -> List[Dict[str, Any]]:
    """Loads all favorite profiles from data/favorite_profiles.json."""
    if not FAVORITES_FILE.exists():
        return []
    try:
        with open(FAVORITES_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            if not isinstance(data, list) and strict:
                raise ValueError("Favorite profiles file is invalid")
            return data if isinstance(data, list) else []
    except Exception:
        if strict:
            raise
        return []


def save_favorite_profiles(profiles: List[Dict[str, Any]]) -> None:
    """Atomically saves favorite profiles using a temporary file."""
    FAVORITES_FILE.parent.mkdir(parents=True, exist_ok=True)
    temp_fd, temp_path = tempfile.mkstemp(
        dir=FAVORITES_FILE.parent, prefix="fav_prof_", suffix=".tmp"
    )
    try:
        with os.fdopen(temp_fd, "w", encoding="utf-8") as f:
            json.dump(profiles, f, ensure_ascii=False, indent=2)
            f.flush()
            os.fsync(f.fileno())
        os.replace(temp_path, FAVORITES_FILE)
    except Exception:
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except OSError:
                pass
        raise


@_locked
def toggle_favorite_profile(profile_data: Dict[str, Any]) -> Dict[str, Any]:
    """Toggles favorite status for a profile.

    If exists, removes it. If not, adds to top of list.
    """
    raw_url = profile_data.get("url") or profile_data.get("id") or ""
    url = _clean_url(raw_url)
    if not url:
        raise ValueError("Profile URL or ID is required")

    profiles = load_favorite_profiles(strict=True)
    existing_index = next(
        (i for i, p in enumerate(profiles) if _clean_url(p.get("url", "")) == url),
        -1,
    )

    if existing_index >= 0:
        removed = profiles.pop(existing_index)
        save_favorite_profiles(profiles)
        return {
            "favorited": False,
            "url": url,
            "profile": removed,
            "total": len(profiles),
        }
    else:
        # Unknown source metadata stays unknown; presentation owns localization.
        name = profile_data.get("name")
        name = name.strip() if isinstance(name, str) else None
        new_entry = {
            "url": url,
            "name": name or None,
            "handle": profile_data.get("handle") or "",
            "avatar_url": profile_data.get("avatar_url")
            or profile_data.get("avatarUrl")
            or "",
            "cover_url": profile_data.get("cover_url")
            or profile_data.get("coverUrl")
            or "",
            "added_at": profile_data.get("added_at") or int(time.time()),
            "stats": profile_data.get("stats") or {},
        }
        profiles.insert(0, new_entry)
        save_favorite_profiles(profiles)
        return {
            "favorited": True,
            "url": url,
            "profile": new_entry,
            "total": len(profiles),
        }


@_locked
def remove_favorite_profile(url: str) -> bool:
    """Removes a favorite profile by url."""
    clean = _clean_url(url)
    if not clean:
        return False
    profiles = load_favorite_profiles(strict=True)
    initial_len = len(profiles)
    profiles = [p for p in profiles if _clean_url(p.get("url", "")) != clean]
    if len(profiles) != initial_len:
        save_favorite_profiles(profiles)
        return True
    return False
