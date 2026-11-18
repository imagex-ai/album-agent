"""Service for managing user's favorite online videos from ProfileHub creators/performers."""
import json
import os
import re
import tempfile
import time
import unicodedata
from pathlib import Path
from typing import Any, Dict, List, Optional

FAVORITES_FILE = Path("data/favorite_profile_videos.json")


def _clean_str(val: Optional[str]) -> str:
    return (val or "").strip()


def _slugify(name: Optional[str]) -> str:
    """Normalizes creator name to canonical slug, e.g. 'Lena Paul' -> 'lena-paul'."""
    if not name:
        return ""
    # Strip common suffixes like (ImageX)
    cleaned = re.sub(r"\(imagex\)", "", name, flags=re.I).strip()
    # Normalize unicode accents
    nfkd = unicodedata.normalize("NFKD", cleaned)
    ascii_str = "".join([c for c in nfkd if not unicodedata.combining(c)])
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", ascii_str).strip("-").lower()
    return slug


def _matches_video(fav: Dict[str, Any], v_id: str, orig_url: str) -> bool:
    """Checks if a favorite entry matches by video ID or canonical page URL."""
    f_id = _clean_str(fav.get("id"))
    f_orig = _clean_str(fav.get("originalUrl") or fav.get("sourceUrl") or fav.get("url"))

    if v_id and f_id and v_id == f_id:
        return True
    if orig_url and f_orig and (orig_url == f_orig or orig_url.rstrip("/") == f_orig.rstrip("/")):
        return True

    # Check Pornhub viewkey match
    m_vkey1 = re.search(r"viewkey=([a-zA-Z0-9]+)", orig_url)
    m_vkey2 = re.search(r"viewkey=([a-zA-Z0-9]+)", f_orig)
    if m_vkey1 and m_vkey2 and m_vkey1.group(1) == m_vkey2.group(1):
        return True

    # Check ID containing viewkey
    if m_vkey1 and f_id and m_vkey1.group(1) in f_id:
        return True
    if m_vkey2 and v_id and m_vkey2.group(1) in v_id:
        return True

    return False


def load_favorite_videos() -> List[Dict[str, Any]]:
    """Loads all favorite profile videos from data/favorite_profile_videos.json."""
    if not FAVORITES_FILE.exists():
        return []
    try:
        with open(FAVORITES_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, list) else []
    except Exception:
        return []


def save_favorite_videos(videos: List[Dict[str, Any]]) -> None:
    """Atomically saves favorite videos using a temporary file."""
    FAVORITES_FILE.parent.mkdir(parents=True, exist_ok=True)
    temp_fd, temp_path = tempfile.mkstemp(
        dir=FAVORITES_FILE.parent, prefix="fav_vids_", suffix=".tmp"
    )
    try:
        with os.fdopen(temp_fd, "w", encoding="utf-8") as f:
            json.dump(videos, f, ensure_ascii=False, indent=2)
        os.replace(temp_path, FAVORITES_FILE)
    except Exception:
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except OSError:
                pass
        raise


def toggle_favorite_video(video_data: Dict[str, Any]) -> Dict[str, Any]:
    """Toggles favorite status for a profile video.

    If already favorited, removes it. If not, adds to top of list with complete metadata.
    """
    v_id = _clean_str(video_data.get("id"))
    orig_url = _clean_str(
        video_data.get("originalUrl")
        or video_data.get("sourceUrl")
        or video_data.get("url")
        or video_data.get("pageUrl")
    )

    if not v_id and not orig_url:
        raise ValueError("Video ID or URL is required to favorite")

    videos = load_favorite_videos()
    existing_index = next(
        (i for i, v in enumerate(videos) if _matches_video(v, v_id, orig_url)),
        -1,
    )

    if existing_index >= 0:
        removed = videos.pop(existing_index)
        save_favorite_videos(videos)
        return {
            "favorited": False,
            "id": v_id or removed.get("id"),
            "video": removed,
            "total": len(videos),
        }
    else:
        # Determine artist name & slug
        raw_artist = (
            video_data.get("artistName")
            or video_data.get("performer")
            or video_data.get("folder")
            or video_data.get("uploader")
            or ""
        )
        artist_slug = _slugify(raw_artist)

        title = _clean_str(video_data.get("title")) or "Vídeo sem título"
        thumb = _clean_str(video_data.get("thumbnailUrl") or video_data.get("coverUrl"))
        dur = _clean_str(video_data.get("duration"))
        res = _clean_str(video_data.get("resolution")) or "HD"
        views = _clean_str(video_data.get("views"))
        stream_url = _clean_str(video_data.get("streamUrl"))
        if not stream_url and orig_url:
            stream_url = f"/api/proxy-video-stream?url={orig_url}"

        canonical_id = v_id
        if not canonical_id:
            m_vkey = re.search(r"viewkey=([a-zA-Z0-9]+)", orig_url)
            canonical_id = f"v-{m_vkey.group(1)}" if m_vkey else f"v-fav_{int(time.time()*1000)}"

        entry = {
            "id": canonical_id,
            "title": title,
            "subtitle": f"{dur} • {res} • {views}" if (dur and views) else (dur or res or views),
            "thumbnailUrl": thumb,
            "duration": dur,
            "resolution": res,
            "views": views,
            "originalUrl": orig_url,
            "streamUrl": stream_url,
            "artistName": raw_artist,
            "artistSlug": artist_slug,
            "folder": video_data.get("folder") or (f"{raw_artist} (ImageX)" if raw_artist else "ProfileHub"),
            "type": "video",
            "isFavorite": True,
            "added_at": int(time.time()),
        }
        videos.insert(0, entry)
        save_favorite_videos(videos)
        return {
            "favorited": True,
            "id": canonical_id,
            "video": entry,
            "total": len(videos),
        }


def get_favorites_for_performer(performer_name_or_slug: str) -> List[Dict[str, Any]]:
    """Returns list of favorited videos matching a specific performer name or slug."""
    target_slug = _slugify(performer_name_or_slug)
    if not target_slug:
        return load_favorite_videos()

    videos = load_favorite_videos()
    return [
        v for v in videos
        if v.get("artistSlug") == target_slug
        or _slugify(v.get("artistName", "")) == target_slug
        or _slugify(v.get("folder", "")) == target_slug
    ]


def get_favorite_video_ids() -> List[str]:
    """Returns a list of all favorited video IDs."""
    videos = load_favorite_videos()
    return [v["id"] for v in videos if v.get("id")]


def is_video_favorited(video_id: str, url: str = "") -> bool:
    """Checks if a video is favorited."""
    videos = load_favorite_videos()
    return any(_matches_video(v, video_id, url) for v in videos)
