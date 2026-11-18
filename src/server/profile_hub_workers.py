"""Native Lexbor HTML extractors and persistent multiprocess worker pool for Profile Hub.

Designed to be lightweight and completely isolated from application startup,
database initialization, or personal media library state so worker processes
spawn cleanly on Windows and PyInstaller executables.
"""
from __future__ import annotations

import asyncio
import atexit
from concurrent.futures import ProcessPoolExecutor
from concurrent.futures.process import BrokenProcessPool
from datetime import datetime, timezone
import hashlib
import json
import math
import multiprocessing
import os
import re
import threading
from typing import Any
from urllib.parse import quote, urljoin, urlsplit, urlunsplit

from selectolax.lexbor import LexborHTMLParser

# Minimum HTML payload size (bytes) to offload single-page extraction to a child process.
# Smaller snippets are faster to parse in-process with native Lexbor (~0.05ms vs ~1ms IPC).
WORKER_OFFLOAD_MIN_BYTES = 32 * 1024
DEFAULT_MAX_WORKERS = min(4, max(2, os.cpu_count() or 2))

_pool_lock = threading.Lock()
_worker_pool: ProcessPoolExecutor | None = None


# Source labels may contain nested JSON; bound traversal independently of HTML size.
MAX_PROFILE_BIO_DEPTH = 8
PROFILE_BIO_TEXT_KEYS = ("name", "text", "value", "label")


def profile_bio_text(value: Any, depth: int = 0) -> str | None:
    """Read human-facing source labels, never IDs, URLs or object reprs."""
    if depth > MAX_PROFILE_BIO_DEPTH or isinstance(value, bool):
        return None
    if isinstance(value, str):
        return value.strip() or None
    if isinstance(value, (int, float)):
        return str(value) if math.isfinite(value) else None
    if isinstance(value, dict):
        for key in PROFILE_BIO_TEXT_KEYS:
            text = profile_bio_text(value.get(key), depth + 1)
            if text is not None:
                return text
    if isinstance(value, list):
        parts = [text for item in value if (text := profile_bio_text(item, depth + 1)) is not None]
        return ", ".join(parts) or None
    return None


def http_url(base: str, value: str | None) -> str | None:
    if not value:
        return None
    candidate = urljoin(base, value.strip())
    parts = urlsplit(candidate)
    if parts.scheme not in ("http", "https") or not parts.netloc:
        return None
    return urlunsplit((parts.scheme, parts.netloc, parts.path, parts.query, ""))


def image_url(
    base: str,
    attrs: dict,
    keys: tuple[str, ...] = ("data-src", "data-original", "data-lazy-src", "src"),
) -> str | None:
    """Prefer lazy-loaded source URLs and preserve the exact CDN filename."""
    for attr in keys:
        value = attrs.get(attr) or ""
        if (
            not value
            or value.startswith("data:")
            or any(token in value.lower() for token in ("blank.gif", "1px.", "placeholder", "transparent.gif"))
        ):
            continue
        url = http_url(base, value)
        if url:
            return url
    return None


def extract_eporner_videos_lexbor(source_url: str, html: str | LexborHTMLParser):
    """Extract canonical and raw video card lists from a single Eporner listing page."""
    tree = html if isinstance(html, LexborHTMLParser) else LexborHTMLParser(html)
    canonical, raw = [], []
    for node in tree.css("div.mb"):
        node_classes = set((node.attributes.get("class") or "").lower().split())
        if node_classes & {"mbplaylist", "mbphoto", "mbphoto2"}:
            continue
        content = node.css_first(".mbcontent")
        link = content.css_first("a") if content is not None else None
        image = content.css_first("img") if content is not None else None
        if content is not None and link is None:
            link = node.css_first(".mbcontent a")
        if content is not None and image is None:
            image = node.css_first(".mbcontent img")
        if link is None or image is None:
            continue

        v_url = http_url(source_url, link.attributes.get("href", "") or "")
        if not v_url or re.search(r"/(?:playlist|gallery|photo)/", urlsplit(v_url).path, re.I):
            continue

        v_id_match = re.search(r"video-([a-zA-Z0-9]+)", v_url)
        v_id = v_id_match.group(1) if v_id_match else ""

        title_holder = node.css_first(".mbtit")
        tit_a = title_holder.css_first("a") if title_holder is not None else None
        if title_holder is not None and tit_a is None:
            tit_a = node.css_first(".mbtit a")

        quality_holder = node.css_first(".mvhdico")
        hd_sp = quality_holder.css_first("span") if quality_holder is not None else None
        if quality_holder is not None and hd_sp is None:
            hd_sp = node.css_first(".mvhdico span")

        dur_sp = node.css_first(".mbtim")
        vie_sp = node.css_first(".mbvie")

        v_title = tit_a.text(separator="", strip=True) if tit_a is not None else (image.attributes.get("alt") or "")
        v_thumb = image_url(source_url, image.attributes)
        v_dur = dur_sp.text(separator="", strip=True) if dur_sp is not None else ""
        v_res = hd_sp.text(separator="", strip=True) if hd_sp is not None else ""
        v_views = vie_sp.text(separator="", strip=True) if vie_sp is not None else ""

        canonical.append({
            "id": f"v-{v_id}" if v_id else "",
            "title": v_title,
            "subtitle": v_views if v_views else v_res,
            "thumbnailUrl": v_thumb,
            "duration": v_dur,
            "resolution": v_res,
            "timeAgo": "",
            "type": "video",
            "originalUrl": v_url,
            "streamUrl": f"/api/proxy-video-stream?url={v_url}",
        })
        raw.append({
            "key": v_url,
            "source_url": v_url,
            "title": v_title,
            "cover_url": v_thumb,
            "duration": v_dur,
            "resolution": v_res,
        })
    return canonical, raw


def extract_eporner_root_lexbor(source_url: str, html: str | LexborHTMLParser):
    """Extract performer identity, bio, pagination metadata, and page-1 videos."""
    if isinstance(html, LexborHTMLParser):
        tree = html
        html_text = tree.html or ""
    else:
        html_text = html
        tree = LexborHTMLParser(html)

    pf_name_link = tree.css_first("h1#pf-name a, h1.pf-name a")
    h1 = pf_name_link or tree.css_first("h1")
    name = h1.text(separator="", strip=True) if h1 is not None else ""
    if not name:
        title_tag = tree.css_first("title")
        if title_tag is not None:
            match = re.match(r"^([^-\|]+)", title_tag.text(separator="", strip=True))
            if match:
                name = match.group(1).replace("Porn Star Videos", "").replace("HD porn videos", "").strip()
    if not name:
        name = ""

    from .profile_hub_avatar_extractors import extract_image_url, is_generic_site_asset

    avatar = None
    chlogo = tree.css_first("img.chlogo")
    if chlogo is not None:
        avatar = extract_image_url(source_url, chlogo.attributes) or image_url(source_url, chlogo.attributes)
    if not avatar:
        for d in tree.css("div[class*=psbio]"):
            img = d.css_first("img")
            if img is not None:
                avatar = image_url(source_url, img.attributes)
                if avatar:
                    break
    if not avatar:
        pf_avatar = tree.css_first(".pf-avatar img, img[src*='/img/avatars/']")
        if pf_avatar is not None:
            avatar = image_url(source_url, pf_avatar.attributes)
        elif tree.css_first(".pf-avatar") is not None:
            avatar = extract_image_url(source_url, tree.css_first(".pf-avatar").attributes)
    confirmed_no_pf_photo = (
        tree.css_first(".pf-avatar .pf-letter") is not None
        and tree.css_first(".pf-avatar img") is None
        and not avatar
    )
    if not avatar and not confirmed_no_pf_photo:
        name_lower = name.lower()
        for img in tree.css("img"):
            alt = (img.attributes.get("alt") or "").lower()
            if any(k in alt for k in ([name_lower, "performer", "avatar", "pornstar"] if name_lower else ["performer", "avatar", "pornstar"])):
                cand = image_url(source_url, img.attributes)
                if cand and not is_generic_site_asset(cand, source_url):
                    avatar = cand
                    break

    stats_nodes = tree.css(".ps1, .ps3, .psbio, #pf-header, .pf-header, .pf-head, .pf-stats, .pf-tabs")
    stats_text = " ".join(n.text(separator=" ", strip=True) for n in stats_nodes) if stats_nodes else ""
    if not stats_text:
        root_node = tree.body or tree
        stats_text = root_node.text(separator=" ", strip=True) if root_node is not None else html_text

    v_count_match = (
        re.search(r"\bVideos:?\s*([0-9][0-9,]*)(?![.\dKMB:])", stats_text, re.I)
        or re.search(r"\b([0-9][0-9,]*)\s+Videos\b", stats_text, re.I)
    )
    p_count_match = (
        re.search(r"\bPhotos:?\s*([0-9][0-9,]*)(?![.\dKMB:])", stats_text, re.I)
        or re.search(r"\b([0-9][0-9,]*)\s+Photos\b", stats_text, re.I)
    )
    sub_count_match = (
        re.search(r"\bSubscribers:\s*([0-9][0-9,.]*(?:\s*[KMB])?)", stats_text, re.I)
        or re.search(r"\bSubscribe\s*\(([0-9][0-9,.]*(?:\s*[KMB])?)\)", stats_text, re.I)
        or re.search(r"\b([0-9][0-9,.]*(?:\s*[KMB])?)\s+Subscribers\b", stats_text, re.I)
    )
    views_count_match = (
        re.search(r"\bVideo\s+views:\s*([0-9][0-9,.]*(?:\s*[KMB])?)", stats_text, re.I)
        or re.search(r"\b([0-9][0-9,.]*(?:\s*[KMB])?)\s+(?:Video\s+)?Views\b", stats_text, re.I)
        or re.search(r"\bProfile\s+views:\s*([0-9][0-9,.]*(?:\s*[KMB])?)", stats_text, re.I)
    )
    rank_match = re.search(r"\bRank:\s*([0-9,]+)", stats_text, re.I) or re.search(
        r"Rank:\s*<span>\s*([0-9,]+)\s*</span>", html_text
    )

    v_digits = v_count_match.group(1).replace(",", "") if v_count_match else ""
    p_digits = p_count_match.group(1).replace(",", "") if p_count_match else ""
    total_videos_reported = int(v_digits) if v_digits.isdigit() else 0
    total_photos_reported = int(p_digits) if p_digits.isdigit() else 0
    subscribers_str = sub_count_match.group(1) if sub_count_match else ""
    if not subscribers_str and re.fullmatch(r"/channel/[^/]+/?", urlsplit(source_url).path, re.I):
        from .profile_hub_watch_sources import eporner_channel_subscribers
        subscribers_str = eporner_channel_subscribers(tree) or ""
    views_str = views_count_match.group(1) if views_count_match else ""
    rank_str = rank_match.group(1) if rank_match else ""

    bio_props = {}
    ps2 = tree.css_first("div.psbio.ps2")
    if ps2 is not None:
        for li in ps2.css("li"):
            label_span = li.css_first("span")
            cll = li.css_first("div.cllnumber")
            if label_span is not None and cll is not None:
                key = label_span.text(separator="", strip=True).rstrip(":")
                val = cll.text(separator="", strip=True)
                if key and val:
                    bio_props[key] = val

    country = bio_props.get("Country", "")
    age = bio_props.get("Age", "")
    height = bio_props.get("Height", "")

    structured_bio = dict(bio_props)
    if rank_str:
        structured_bio["Rank"] = rank_str
    if subscribers_str:
        structured_bio["Subscribers"] = subscribers_str
    if views_str:
        structured_bio["Video views"] = views_str

    social_links = {}
    ps5 = tree.css_first("div.psbio.ps5")
    if ps5 is not None:
        for sa in ps5.css("a[href]"):
            stxt = sa.text(separator="", strip=True).lower()
            shref = sa.attributes.get("href") or ""
            if "twitter" in stxt or "twitter.com" in shref:
                social_links["Twitter"] = shref
            elif "instagram" in stxt or "instagram.com" in shref:
                social_links["Instagram"] = shref

    tagline = " • ".join(value for value in (country, age, height.split("/")[0].strip()) if value)

    page_nums = []
    for a in tree.css("div.numlist2 a[href], div.numlist a[href]"):
        href = a.attributes.get("href") or ""
        m = re.search(r"/(\d+)/?$", href)
        if m:
            page_nums.append(int(m.group(1)))
    if total_videos_reported > 0:
        page_nums.append(math.ceil(total_videos_reported / 38))
    max_video_page = max(page_nums) if page_nums else 1

    if name:
        clean_slug = quote(re.sub(r"\s+", "-", name.lower()), safe="-")
    else:
        parts = urlsplit(source_url).path.strip("/").split("/")
        slug = parts[1] if len(parts) > 1 else parts[0]
        clean_slug = re.sub(r"-(?=[A-Za-z0-9]{4,12}$)(?=[A-Za-z0-9]*[A-Z0-9])[A-Za-z0-9]+$", "", slug)

    videos_pair = extract_eporner_videos_lexbor(source_url, tree)
    eporner_handle = f"@{clean_slug}" if clean_slug else (f"@{name.lower().replace(' ', '')}" if name else "")
    return {
        "name": name,
        "handle": eporner_handle,
        "avatar": avatar,
        "tagline": tagline,
        "structured_bio": structured_bio,
        "social_links": social_links,
        "subscribers": subscribers_str or None,
        "views": views_str or None,
        "total_videos_reported": total_videos_reported,
        "total_photos_reported": total_photos_reported,
        "max_video_page": max_video_page,
        "clean_slug": clean_slug,
        "videos": videos_pair,
    }


def extract_eporner_albums_lexbor(source_url: str, html: str | LexborHTMLParser):
    """Extract canonical and raw photo gallery cards from an Eporner photos page."""
    tree = html if isinstance(html, LexborHTMLParser) else LexborHTMLParser(html)
    canonical, raw = [], []
    for it in tree.css(".photosgrid .mbphoto2, div[class*=mbphoto]"):
        a = it.css_first("a[href]")
        img = it.css_first("img")
        tit_div = it.css_first(".mbtitphoto2")
        ico_div = it.css_first(".mbphoto2_galleryico")
        if a is not None and img is not None:
            alb_url = http_url(source_url, a.attributes.get("href") or "")
            if not alb_url:
                continue
            alb_id_match = re.search(r"(?:gallery|photo)/([a-zA-Z0-9]+)", alb_url)
            alb_id = alb_id_match.group(1) if alb_id_match else ""
            alb_title = tit_div.text(separator="", strip=True) if tit_div is not None else (a.attributes.get("title") or "")
            alb_thumb = image_url(source_url, img.attributes)
            raw_count = ico_div.text(separator="", strip=True) if ico_div is not None else ""
            if raw_count and raw_count.isdigit():
                photo_count = int(raw_count)
            elif "/photo/" in alb_url:
                photo_count = 1
            else:
                photo_count = None
            canonical.append({
                "id": f"alb-{alb_id}" if alb_id else "",
                "title": alb_title,
                "photoCount": photo_count,
                "updatedAt": "",
                "thumbnailUrl": alb_thumb,
                "category": "",
                "isComplete": False,
                "url": alb_url,
            })
            raw.append({
                "key": alb_url,
                "source_url": alb_url,
                "title": alb_title,
                "cover_url": alb_thumb,
                "provenance": {"page_url": source_url, "evidence": "performer photos", "ownership": "unverified"},
            })
    return canonical, raw


def extract_eporner_playlists_lexbor(
    source_url: str,
    page_url: str,
    html: str | LexborHTMLParser,
    fallback_avatar: str = "",
):
    """Extract canonical and raw playlist cards plus discovered search pagination links."""
    tree = html if isinstance(html, LexborHTMLParser) else LexborHTMLParser(html)
    canonical, raw = [], []
    for mb in tree.css("div.mb"):
        a_link = None
        for cand in mb.css("a[href]"):
            href = cand.attributes.get("href") or ""
            if "/playlist/" in href:
                a_link = cand
                break
        img = mb.css_first("img")
        tit_el = mb.css_first(".mbtitphoto2, .mbtit") or a_link
        ico_el = mb.css_first(".mbphoto2_playlistico")
        if a_link is not None and tit_el is not None:
            pl_href = a_link.attributes.get("href") or ""
            pl_url = http_url(source_url, pl_href)
            if not pl_url:
                continue
            pl_title = tit_el.text(separator="", strip=True)
            raw_v_count = ico_el.text(separator="", strip=True) if ico_el is not None else ""
            v_count = int(raw_v_count) if raw_v_count.isdigit() else None
            pl_thumb = (image_url(source_url, img.attributes) if img is not None else None) or fallback_avatar or ""
            pl_id_match = re.search(r"playlist/([a-zA-Z0-9]+)", pl_url)
            pl_id = pl_id_match.group(1) if pl_id_match else ""
            author_match = re.search(r"/profile/([^/]+)/", pl_url)
            author_name = author_match.group(1) if author_match else None
            author_url = f"https://www.eporner.com/profile/{author_name}/" if author_name else None
            canonical.append({
                "id": f"pl-{pl_id}" if pl_id else "",
                "title": pl_title,
                "videoCount": v_count,
                "updatedAt": "",
                "thumbnailUrl": pl_thumb,
                "description": "",
                "loadedCount": 0,
                "url": pl_url,
                "author": author_name,
                "authorUrl": author_url,
            })
            raw.append({
                "key": pl_url,
                "source_url": pl_url,
                "title": pl_title,
                "cover_url": pl_thumb,
                "provenance": {"page_url": source_url, "evidence": "search-playlists", "ownership": "unverified"},
            })

    next_pages = []
    if page_url:
        origin = urlsplit(page_url)
        prefix = re.sub(r"\d+/?$", "", origin.path.rstrip("/") + "/")
        for anchor in tree.css('.numlist2 a[href], .numlist a[href], a[rel="next"][href]'):
            candidate = http_url(page_url, anchor.attributes.get("href") or "")
            if not candidate:
                continue
            parts = urlsplit(candidate)
            suffix = parts.path[len(prefix):] if parts.path.startswith(prefix) else ""
            if parts.netloc == origin.netloc and re.fullmatch(r"\d+/?", suffix) and int(suffix.strip("/")) >= 2:
                next_pages.append(f'{origin.scheme}://{origin.netloc}{prefix}{int(suffix.strip("/"))}/')

    return canonical, raw, next_pages


_YOUTUBE_HOSTS = frozenset({"youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"})
_YOUTUBE_TAB_SUFFIXES = (
    "/featured",
    "/videos",
    "/shorts",
    "/streams",
    "/playlists",
    "/community",
    "/posts",
    "/channels",
    "/about",
    "/releases",
    "/podcasts",
    "/store",
)


def is_youtube_host(url: str) -> bool:
    host = urlsplit(url).netloc.lower().split(":")[0]
    return host in _YOUTUBE_HOSTS or host.endswith(".youtube.com")


def is_youtube_channel_url(url: str) -> bool:
    if not is_youtube_host(url):
        return False
    path = urlsplit(url).path.rstrip("/")
    if not path:
        return False
    return bool(
        re.match(
            r"^/(?:@[A-Za-z0-9_.\-]+|channel/[A-Za-z0-9_\-]+|c/[A-Za-z0-9_.\-]+|user/[A-Za-z0-9_.\-]+)(?:/[A-Za-z0-9_\-]+)?$",
            path,
            re.I,
        )
    )


def normalize_youtube_channel_base_url(url: str) -> str:
    parts = urlsplit(url.strip())
    path = parts.path.rstrip("/")
    lower_path = path.lower()
    for suffix in _YOUTUBE_TAB_SUFFIXES:
        if lower_path.endswith(suffix):
            path = path[: -len(suffix)].rstrip("/")
            break
    return urlunsplit(("https", "www.youtube.com", path, "", ""))


def _extract_yt_json_var(html_text: str, markers: tuple[str, ...]) -> dict | None:
    if not html_text:
        return None
    decoder = json.JSONDecoder()
    for marker in markers:
        idx = html_text.find(marker)
        if idx < 0:
            continue
        start = html_text.find("{", idx + len(marker))
        if start < 0:
            continue
        try:
            obj, _ = decoder.raw_decode(html_text, start)
            if isinstance(obj, dict):
                return obj
        except (ValueError, TypeError):
            continue
    return None


def _extract_yt_initial_data(html_or_tree: str | LexborHTMLParser) -> dict | None:
    html_text = (html_or_tree.html or "") if isinstance(html_or_tree, LexborHTMLParser) else str(html_or_tree or "")
    return _extract_yt_json_var(
        html_text,
        ("var ytInitialData = ", 'window["ytInitialData"] = ', "ytInitialData = "),
    )


def _iter_dicts_with_key(node: Any, target_key: str):
    """Yield every dict inside `node` that contains `target_key`."""
    if isinstance(node, dict):
        if target_key in node:
            yield node
        for val in node.values():
            if isinstance(val, (dict, list)):
                yield from _iter_dicts_with_key(val, target_key)
    elif isinstance(node, list):
        for item in node:
            if isinstance(item, (dict, list)):
                yield from _iter_dicts_with_key(item, target_key)


def _normalize_yt_url(value: str | None) -> str | None:
    if not value or not isinstance(value, str):
        return None
    raw = value.strip()
    if raw.startswith("//"):
        raw = "https:" + raw
    return http_url("https://www.youtube.com", raw)


def _best_yt_thumbnail(container: Any) -> tuple[str | None, int, int]:
    """Return (url, width, height) of the highest-resolution YouTube thumbnail."""
    sources = None
    if isinstance(container, list):
        sources = container
    elif isinstance(container, dict):
        if "sources" in container and isinstance(container["sources"], list):
            sources = container["sources"]
        elif "thumbnails" in container and isinstance(container["thumbnails"], list):
            sources = container["thumbnails"]
        elif "image" in container and isinstance(container["image"], dict):
            return _best_yt_thumbnail(container["image"])
    if not sources:
        return None, 0, 0
    best_url = None
    best_w = 0
    best_h = 0
    for item in sources:
        if not isinstance(item, dict):
            continue
        u = _normalize_yt_url(item.get("url"))
        if not u:
            continue
        w = int(item.get("width") or 0)
        h = int(item.get("height") or 0)
        if best_url is None or w >= best_w:
            best_url, best_w, best_h = u, w, h
    return best_url, best_w, best_h


def _yt_text(node: Any) -> str:
    if not node:
        return ""
    if isinstance(node, str):
        return node.strip()
    if isinstance(node, dict):
        if isinstance(node.get("content"), str):
            return node["content"].strip()
        if isinstance(node.get("simpleText"), str):
            return node["simpleText"].strip()
        runs = node.get("runs")
        if isinstance(runs, list):
            return "".join(r.get("text", "") for r in runs if isinstance(r, dict)).strip()
    return ""


def _normalize_yt_relative_date(text: str) -> str:
    """Normalize shorthand and localized YouTube relative strings (e.g. '6h ago', 'há 6 horas')
    so timeline sorting and Intl.RelativeTimeFormat recognize them."""
    if not text:
        return ""
    stripped = text.strip()
    if re.fullmatch(r"(?:just now|agora(?: mesmo)?)", stripped, re.I):
        return "0 seconds ago"
    clean_pt = re.sub(r"^(?:Transmitido|Estreou|Atualizado)\s+", "", stripped, flags=re.I)
    m_pt = re.search(
        r"\bhá\s+(\d+)\s+(segundos?|minutos?|horas?|dias?|semanas?|m[eê]s(?:es)?|anos?)\b",
        clean_pt,
        re.I,
    )
    if m_pt:
        num = int(m_pt.group(1))
        raw_unit = m_pt.group(2).lower()
        if raw_unit.startswith("seg"):
            unit = "second"
        elif raw_unit.startswith("min"):
            unit = "minute"
        elif raw_unit.startswith("hor"):
            unit = "hour"
        elif raw_unit.startswith("dia"):
            unit = "day"
        elif raw_unit.startswith("sem"):
            unit = "week"
        elif raw_unit.startswith("m"):
            unit = "month"
        else:
            unit = "year"
        return f"{num} {unit}{'' if num == 1 else 's'} ago"

    clean = re.sub(r"^(?:Streamed|Premiered|Updated)\s+", "", stripped, flags=re.I)
    m_short = re.match(r"^(\d+)\s*([smhdwy]|mo)\s+ago$", clean, re.I)
    if m_short:
        num = int(m_short.group(1))
        unit_map = {
            "s": "second",
            "m": "minute",
            "h": "hour",
            "d": "day",
            "w": "week",
            "mo": "month",
            "y": "year",
        }
        unit = unit_map.get(m_short.group(2).lower(), "day")
        return f"{num} {unit}{'' if num == 1 else 's'} ago"
    m_full = re.search(r"(\d+\s+(?:second|minute|hour|day|week|month|year)s?\s+ago)", clean, re.I)
    if m_full:
        return m_full.group(1)
    return clean


def _parse_compact_count(text: str) -> int | None:
    if not text:
        return None
    m = re.search(r"(\d+(?:[.,]\d+)?)\s*([KMBkmb])?\b", text.replace(",", ""))
    if not m:
        return None
    try:
        val = float(m.group(1))
    except ValueError:
        return None
    mult = {"k": 1_000, "m": 1_000_000, "b": 1_000_000_000}.get((m.group(2) or "").lower(), 1)
    return int(val * mult)


def extract_youtube_videos_lexbor(source_url: str, html: str | LexborHTMLParser | dict):
    """Extract canonical and raw video cards from a YouTube channel or playlist page."""
    data = html if isinstance(html, dict) else _extract_yt_initial_data(html)
    canonical, raw = [], []
    seen_urls = set()
    if not data:
        return canonical, raw

    def add_video(v_id: str, title: str, thumb: str | None, dur: str, views: str, time_ago: str, is_short: bool = False):
        if not v_id or not re.fullmatch(r"[A-Za-z0-9_-]{8,16}", v_id):
            return
        v_url = f"https://www.youtube.com/shorts/{v_id}" if is_short else f"https://www.youtube.com/watch?v={v_id}"
        if v_url in seen_urls:
            return
        seen_urls.add(v_url)
        final_thumb = thumb or f"https://i.ytimg.com/vi/{v_id}/hqdefault.jpg"
        norm_time = _normalize_yt_relative_date(time_ago)
        subtitle = views if views else ("Shorts" if is_short else "1080p")
        card = {
            "id": f"v-{v_id}",
            "title": title or f"Video {v_id}",
            "subtitle": subtitle,
            "thumbnailUrl": final_thumb,
            "duration": dur,
            "resolution": "1080p",
            "timeAgo": norm_time,
            "uploadedAt": norm_time or None,
            "views": views or None,
            "type": "video",
            "originalUrl": v_url,
            "streamUrl": f"/api/proxy-video-stream?url={v_url}",
        }
        if norm_time or views or dur:
            card["metadataStatus"] = "fetched"
        canonical.append(card)
        raw.append({
            "key": v_url,
            "source_url": v_url,
            "title": card["title"],
            "cover_url": final_thumb,
            "duration": dur,
            "resolution": "1080p",
        })

    def walk(node: Any, in_post: bool = False):
        if isinstance(node, list):
            for item in node:
                walk(item, in_post=in_post)
            return
        if not isinstance(node, dict):
            return
        if "backstagePostRenderer" in node:
            # Do not mix community post video attachments into primary channel video listings
            return

        if "lockupViewModel" in node and isinstance(node["lockupViewModel"], dict):
            lvm = node["lockupViewModel"]
            c_type = lvm.get("contentType") or ""
            v_id = lvm.get("contentId") or ""
            if c_type == "LOCKUP_CONTENT_TYPE_VIDEO" or (not c_type and len(v_id) == 11):
                meta_vm = (lvm.get("metadata") or {}).get("lockupMetadataViewModel") or {}
                v_title = _yt_text(meta_vm.get("title"))
                thumb_vm = ((lvm.get("contentImage") or {}).get("thumbnailViewModel")) or {}
                v_thumb, _, _ = _best_yt_thumbnail(thumb_vm.get("image"))
                v_dur = ""
                for ov in thumb_vm.get("overlays") or []:
                    if not isinstance(ov, dict):
                        continue
                    b_ov = ov.get("thumbnailBottomOverlayViewModel") or ov.get("thumbnailOverlayBadgeViewModel") or {}
                    for b in (b_ov.get("badges") or b_ov.get("thumbnailBadges") or []):
                        if not isinstance(b, dict):
                            continue
                        tb = b.get("thumbnailBadgeViewModel") or b
                        txt = _yt_text(tb.get("text"))
                        if txt and (":" in txt or txt.upper() == "SHORTS"):
                            v_dur = txt
                            break
                    if v_dur:
                        break
                v_views = ""
                v_time = ""
                rows = ((meta_vm.get("metadata") or {}).get("contentMetadataViewModel") or {}).get("metadataRows") or []
                for row in rows:
                    if not isinstance(row, dict):
                        continue
                    for part in row.get("metadataParts") or []:
                        if not isinstance(part, dict):
                            continue
                        raw_txt = _yt_text(part.get("text"))
                        acc_txt = (part.get("accessibilityLabel") or "").strip()
                        candidate = acc_txt or raw_txt
                        if not candidate:
                            continue
                        if re.search(r"\bago\b|atrás|há\s+\d", candidate, re.I):
                            v_time = candidate
                        elif re.search(r"\d", raw_txt) and not v_views:
                            v_views = raw_txt if "view" in raw_txt.lower() else f"{raw_txt} views"
                add_video(v_id, v_title, v_thumb, v_dur, v_views, v_time)
            return

        for key in ("videoRenderer", "gridVideoRenderer", "playlistVideoRenderer"):
            if key in node and isinstance(node[key], dict):
                vr = node[key]
                v_id = vr.get("videoId") or ""
                v_title = _yt_text(vr.get("title"))
                v_thumb, _, _ = _best_yt_thumbnail(vr.get("thumbnail"))
                v_dur = _yt_text(vr.get("lengthText"))
                if not v_dur:
                    for ov in vr.get("thumbnailOverlays") or []:
                        if isinstance(ov, dict) and "thumbnailOverlayTimeStatusRenderer" in ov:
                            v_dur = _yt_text(ov["thumbnailOverlayTimeStatusRenderer"].get("text"))
                            if v_dur:
                                break
                v_views = _yt_text(vr.get("shortViewCountText")) or _yt_text(vr.get("viewCountText"))
                v_time = _yt_text(vr.get("publishedTimeText"))
                if not v_time and isinstance(vr.get("videoInfo"), dict):
                    info_runs = vr["videoInfo"].get("runs") or []
                    for r in info_runs:
                        txt = (r.get("text") or "").strip()
                        if re.search(r"\bago\b", txt, re.I):
                            v_time = txt
                        elif "view" in txt.lower() and not v_views:
                            v_views = txt
                add_video(v_id, v_title, v_thumb, v_dur, v_views, v_time)
                return

        if "shortsLockupViewModel" in node and isinstance(node["shortsLockupViewModel"], dict):
            slm = node["shortsLockupViewModel"]
            tap = ((slm.get("onTap") or {}).get("innertubeCommand") or {}).get("reelWatchEndpoint") or {}
            v_id = tap.get("videoId") or ""
            v_title = _yt_text((slm.get("overlayMetadata") or {}).get("primaryText"))
            v_views = _yt_text((slm.get("overlayMetadata") or {}).get("secondaryText"))
            v_thumb, _, _ = _best_yt_thumbnail(slm.get("thumbnail"))
            add_video(v_id, v_title, v_thumb, "Shorts", v_views, "", is_short=True)
            return

        for val in node.values():
            if isinstance(val, (dict, list)):
                walk(val, in_post=in_post)

    walk(data.get("contents") or data)
    return canonical, raw


def extract_youtube_playlists_lexbor(
    source_url: str,
    channel_name_or_html: str | LexborHTMLParser | dict,
    html: str | LexborHTMLParser | dict | None = None,
    fallback_avatar: str = "",
):
    """Extract canonical and raw playlist cards from a YouTube /playlists tab."""
    if html is None:
        actual_html = channel_name_or_html
        explicit_channel_name = None
    else:
        actual_html = html
        explicit_channel_name = str(channel_name_or_html).strip() if channel_name_or_html else None
    data = actual_html if isinstance(actual_html, dict) else _extract_yt_initial_data(actual_html)
    canonical, raw = [], []
    seen_urls = set()
    if not data:
        return canonical, raw, []

    meta_renderer = (data.get("metadata") or {}).get("channelMetadataRenderer") or {}
    channel_name = explicit_channel_name or (meta_renderer.get("title") or "").strip() or None
    channel_url = _normalize_yt_url(meta_renderer.get("vanityChannelUrl") or meta_renderer.get("channelUrl")) or source_url

    def add_playlist(pl_id: str, title: str, thumb: str | None, count: int | None, updated_at: str = ""):
        if not pl_id or not title:
            return
        pl_url = f"https://www.youtube.com/playlist?list={pl_id}"
        if pl_url in seen_urls:
            return
        seen_urls.add(pl_url)
        final_thumb = thumb or fallback_avatar or ""
        norm_updated = _normalize_yt_relative_date(updated_at)
        card = {
            "id": f"pl-{pl_id}",
            "title": title,
            "videoCount": count,
            "updatedAt": norm_updated,
            "updatedAtRaw": norm_updated or None,
            "lastAddedDate": norm_updated or None,
            "thumbnailUrl": final_thumb,
            "description": "",
            "loadedCount": 0,
            "url": pl_url,
            "author": channel_name,
            "authorUrl": channel_url,
        }
        if count is not None or norm_updated:
            card["metadataStatus"] = "fetched"
        canonical.append(card)
        raw.append({
            "key": pl_url,
            "source_url": pl_url,
            "title": title,
            "cover_url": final_thumb,
            "provenance": {"page_url": source_url, "evidence": "channel playlists", "ownership": "unverified"},
        })

    def walk(node: Any):
        if isinstance(node, list):
            for item in node:
                walk(item)
            return
        if not isinstance(node, dict):
            return

        if "lockupViewModel" in node and isinstance(node["lockupViewModel"], dict):
            lvm = node["lockupViewModel"]
            if lvm.get("contentType") == "LOCKUP_CONTENT_TYPE_PLAYLIST":
                pl_id = lvm.get("contentId") or ""
                meta_vm = (lvm.get("metadata") or {}).get("lockupMetadataViewModel") or {}
                pl_title = _yt_text(meta_vm.get("title"))
                coll_thumb = ((lvm.get("contentImage") or {}).get("collectionThumbnailViewModel") or {}).get("primaryThumbnail") or {}
                thumb_vm = coll_thumb.get("thumbnailViewModel") or (lvm.get("contentImage") or {}).get("thumbnailViewModel") or {}
                pl_thumb, _, _ = _best_yt_thumbnail(thumb_vm.get("image"))
                v_count = None
                for ov in thumb_vm.get("overlays") or []:
                    if not isinstance(ov, dict):
                        continue
                    b_ov = ov.get("thumbnailOverlayBadgeViewModel") or ov.get("thumbnailBottomOverlayViewModel") or {}
                    for b in (b_ov.get("thumbnailBadges") or b_ov.get("badges") or []):
                        if not isinstance(b, dict):
                            continue
                        tb = b.get("thumbnailBadgeViewModel") or b
                        txt = _yt_text(tb.get("text"))
                        parsed_c = _parse_compact_count(txt)
                        if parsed_c is not None:
                            v_count = parsed_c
                            break
                    if v_count is not None:
                        break
                updated_str = ""
                rows = ((meta_vm.get("metadata") or {}).get("contentMetadataViewModel") or {}).get("metadataRows") or []
                for row in rows:
                    if not isinstance(row, dict):
                        continue
                    for part in row.get("metadataParts") or []:
                        if not isinstance(part, dict):
                            continue
                        txt = _yt_text(part.get("text"))
                        if re.search(r"updated|\bago\b|today|yesterday", txt, re.I):
                            updated_str = txt
                add_playlist(pl_id, pl_title, pl_thumb, v_count, updated_str)
                return

        for key in ("playlistRenderer", "gridPlaylistRenderer", "compactPlaylistRenderer"):
            if key in node and isinstance(node[key], dict):
                pr = node[key]
                pl_id = pr.get("playlistId") or ""
                pl_title = _yt_text(pr.get("title"))
                pl_thumb, _, _ = _best_yt_thumbnail(pr.get("thumbnail") or (pr.get("thumbnails") or [None])[0])
                count_txt = _yt_text(pr.get("videoCountText")) or _yt_text(pr.get("videoCountShortText"))
                v_count = _parse_compact_count(count_txt)
                updated_str = _yt_text(pr.get("publishedTimeText"))
                add_playlist(pl_id, pl_title, pl_thumb, v_count, updated_str)
                return

        for val in node.values():
            if isinstance(val, (dict, list)):
                walk(val)

    walk(data.get("contents") or data)
    return canonical, raw, []


def _extract_yt_post_images(post: dict) -> list[tuple[str, str, int, int]]:
    """Return list of (thumb_url, high_res_url, width, height) from a backstagePostRenderer."""
    attachment = post.get("backstageAttachment") or {}
    renderers = []
    if "backstageImageRenderer" in attachment and isinstance(attachment["backstageImageRenderer"], dict):
        renderers.append(attachment["backstageImageRenderer"])
    if "postMultiImageRenderer" in attachment and isinstance(attachment["postMultiImageRenderer"], dict):
        for item in attachment["postMultiImageRenderer"].get("images") or []:
            if isinstance(item, dict) and "backstageImageRenderer" in item:
                renderers.append(item["backstageImageRenderer"])

    results = []
    for img_r in renderers:
        thumb_url, w, h = _best_yt_thumbnail(img_r.get("image"))
        if not thumb_url:
            continue
        high_res = re.sub(r"=s\d+[^/?#]*$", "=s0", thumb_url) if ("ggpht.com" in thumb_url or "googleusercontent.com" in thumb_url) else thumb_url
        results.append((thumb_url, high_res, w, h))
    return results


def extract_youtube_albums_lexbor(source_url: str, html: str | LexborHTMLParser | dict):
    """Extract image-bearing community posts from a YouTube /posts tab as photo albums."""
    data = html if isinstance(html, dict) else _extract_yt_initial_data(html)
    canonical, raw = [], []
    seen_urls = set()
    if not data:
        return canonical, raw

    def walk(node: Any):
        if isinstance(node, list):
            for item in node:
                walk(item)
            return
        if not isinstance(node, dict):
            return
        if "backstagePostRenderer" in node and isinstance(node["backstagePostRenderer"], dict):
            post = node["backstagePostRenderer"]
            post_id = (post.get("postId") or "").strip()
            images = _extract_yt_post_images(post)
            if post_id and images:
                alb_url = f"https://www.youtube.com/post/{post_id}"
                if alb_url not in seen_urls:
                    seen_urls.add(alb_url)
                    text_content = _yt_text(post.get("contentText"))
                    pub_time = _normalize_yt_relative_date(_yt_text(post.get("publishedTimeText")))
                    if text_content:
                        first_line = text_content.splitlines()[0].strip()
                        alb_title = (first_line[:72] + "…") if len(first_line) > 72 else first_line
                    else:
                        alb_title = f"Community Post ({pub_time})" if pub_time else f"Post {post_id[:8]}"
                    thumb_url = images[0][0]
                    canonical.append({
                        "id": f"alb-{post_id}",
                        "title": alb_title,
                        "photoCount": len(images),
                        "updatedAt": pub_time,
                        "updatedAtRaw": pub_time or None,
                        "lastAddedDate": pub_time or None,
                        "metadataStatus": "fetched",
                        "thumbnailUrl": thumb_url,
                        "category": "Community",
                        "isComplete": True,
                        "url": alb_url,
                    })
                    raw.append({
                        "key": alb_url,
                        "source_url": alb_url,
                        "title": alb_title,
                        "cover_url": thumb_url,
                        "provenance": {"page_url": source_url, "evidence": "community post photos", "ownership": "unverified"},
                    })
            return
        for val in node.values():
            if isinstance(val, (dict, list)):
                walk(val)

    walk(data.get("contents") or data)
    return canonical, raw


def extract_youtube_root_lexbor(source_url: str, html: str | LexborHTMLParser):
    """Extract YouTube channel identity, banner, avatar, bio, stats, and initial videos."""
    if isinstance(html, LexborHTMLParser):
        tree = html
        html_text = tree.html or ""
    else:
        html_text = str(html or "")
        tree = LexborHTMLParser(html_text)

    data = _extract_yt_initial_data(html_text) or {}
    meta_renderer = (data.get("metadata") or {}).get("channelMetadataRenderer") or {}
    header = data.get("header") or {}
    ph_vm = ((header.get("pageHeaderRenderer") or {}).get("content") or {}).get("pageHeaderViewModel") or {}
    c4_header = header.get("c4TabbedHeaderRenderer") or {}

    def meta_tag(prop: str) -> str:
        tag = tree.css_first(f'meta[property="{prop}"], meta[name="{prop}"]')
        return (tag.attributes.get("content") or "").strip() if tag is not None else ""

    name = (
        (meta_renderer.get("title") or "").strip()
        or _yt_text((ph_vm.get("title") or {}).get("dynamicTextViewModel", {}).get("text"))
        or (c4_header.get("title") or "").strip()
        or meta_tag("og:title")
    )

    description = (
        (meta_renderer.get("description") or "").strip()
        or _yt_text(((ph_vm.get("description") or {}).get("descriptionPreviewViewModel") or {}).get("description"))
        or meta_tag("og:description")
    )

    avatar, _, _ = _best_yt_thumbnail(meta_renderer.get("avatar"))
    if not avatar:
        avatar_vm = (((ph_vm.get("image") or {}).get("decoratedAvatarViewModel") or {}).get("avatar") or {}).get("avatarViewModel") or {}
        avatar, _, _ = _best_yt_thumbnail(avatar_vm.get("image"))
    if not avatar:
        avatar, _, _ = _best_yt_thumbnail(c4_header.get("avatar"))
    if not avatar:
        avatar = _normalize_yt_url(meta_tag("og:image"))

    banner, _, _ = _best_yt_thumbnail(((ph_vm.get("banner") or {}).get("imageBannerViewModel") or {}).get("image"))
    if not banner:
        banner, _, _ = _best_yt_thumbnail(c4_header.get("banner"))

    verified = False
    title_vm = (ph_vm.get("title") or {}).get("dynamicTextViewModel") or {}
    att_runs = (title_vm.get("text") or {}).get("attachmentRuns") or []
    acc_label = (((title_vm.get("rendererContext") or {}).get("accessibilityContext") or {}).get("label") or "")
    if "CHECK_CIRCLE_FILLED" in json.dumps(att_runs) or "verified" in acc_label.lower():
        verified = True
    elif c4_header.get("badges"):
        verified = True

    handle = ""
    subscribers_str = ""
    videos_count_str = ""
    total_videos_reported = 0

    meta_rows = ((ph_vm.get("metadata") or {}).get("contentMetadataViewModel") or {}).get("metadataRows") or []
    for row in meta_rows:
        if not isinstance(row, dict):
            continue
        for part in row.get("metadataParts") or []:
            if not isinstance(part, dict):
                continue
            txt = _yt_text(part.get("text"))
            if not txt:
                continue
            if txt.startswith("@") and not handle:
                handle = txt
            elif "subscriber" in txt.lower() or "inscrito" in txt.lower():
                subscribers_str = re.sub(r"\s*(?:subscribers?|inscritos?)\b", "", txt, flags=re.I).strip() or txt
            elif "video" in txt.lower() or "vídeo" in txt.lower():
                videos_count_str = re.sub(r"\s*(?:videos?|vídeos?)\b", "", txt, flags=re.I).strip() or txt
                parsed_v = _parse_compact_count(txt)
                if parsed_v is not None:
                    total_videos_reported = parsed_v

    if not subscribers_str and c4_header.get("subscriberCountText"):
        sub_raw = _yt_text(c4_header.get("subscriberCountText"))
        subscribers_str = re.sub(r"\s*(?:subscribers?|inscritos?)\b", "", sub_raw, flags=re.I).strip()
    if not total_videos_reported and c4_header.get("videosCountText"):
        v_raw = _yt_text(c4_header.get("videosCountText"))
        videos_count_str = re.sub(r"\s*(?:videos?|vídeos?)\b", "", v_raw, flags=re.I).strip()
        total_videos_reported = _parse_compact_count(v_raw) or 0

    if not handle:
        m_handle = re.search(r"/@([A-Za-z0-9_.\-]+)", source_url)
        if m_handle:
            handle = f"@{m_handle.group(1)}"
        elif name:
            handle = f"@{re.sub(r'\\s+', '', name.lower())}"

    structured_bio = {}
    if handle:
        structured_bio["Channel"] = handle
    if subscribers_str:
        structured_bio["Subscribers"] = subscribers_str
    if videos_count_str:
        structured_bio["Videos"] = videos_count_str

    videos_pair = extract_youtube_videos_lexbor(source_url, data)
    playlists_triple = extract_youtube_playlists_lexbor(source_url, data, avatar or "")
    albums_pair = extract_youtube_albums_lexbor(source_url, data)

    return {
        "platform": "youtube",
        "name": name,
        "handle": handle,
        "avatar": avatar,
        "banner": banner,
        "verified": verified,
        "tagline": description,
        "structured_bio": structured_bio,
        "social_links": {},
        "subscribers": subscribers_str or None,
        "total_videos_reported": total_videos_reported,
        "total_photos_reported": 0,
        "max_video_page": 1,
        "clean_slug": handle.lstrip("@") or name.lower(),
        "videos": videos_pair,
        "playlists": (playlists_triple[0], playlists_triple[1]),
        "albums": albums_pair,
    }


# ============================================================================
# PORNHUB EXTRACTORS
# ============================================================================

def is_pornhub_host(url: str) -> bool:
    host = urlsplit(url).netloc.lower()
    return bool(re.search(r"(?:^|\.)pornhub\.[a-z.]+$", host))


def is_pornhub_profile_url(url: str) -> bool:
    if not is_pornhub_host(url):
        return False
    path = urlsplit(url).path.rstrip("/").lower()
    return bool(
        re.match(
            r"^/(?:pornstar|model|channels|users)/[a-zA-Z0-9_\-]+(?:/(?:videos|photos|playlists|gifs|about|stream))?$",
            path,
        )
    )


def normalize_pornhub_profile_base_url(url: str) -> str:
    """Normalize language subdomains (e.g. pt.pornhub.com -> www.pornhub.com) and strip subpaths."""
    u = re.sub(r"^https?://(?:[a-z]{2})\.(pornhub\.[a-z.]+)", r"https://www.\1", url.strip(), flags=re.I)
    parsed = urlsplit(u)
    m = re.match(r"^/(pornstar|model|channels|users)/([a-zA-Z0-9_\-]+)", parsed.path, re.I)
    if m:
        base_path = f"/{m.group(1).lower()}/{m.group(2)}"
        scheme = parsed.scheme or "https"
        netloc = parsed.netloc or "www.pornhub.com"
        return f"{scheme}://{netloc}{base_path}"
    return u.rstrip("/")


_PORNHUB_SITEWIDE_SELECTORS = (
    "#header",
    "#headerWrapper",
    "#headerMainMenu",
    ".innerHeaderSubMenu",
    "#playListHeaderSection",
    ".dropdownPhotosList",
    ".dropdownHottestVideos",
    ".dropdownReccomendedVideos",
    "#hottestMenuSection",
    "#recommMenuSection",
    ".dropdownPlaylistsList",
    ".dropdownGifs",
    ".gifsMenuItems",
    "#networkBar",
    ".networkBar",
    "#gifHeaderSection",
    ".wideDropdown",
    "#footer",
    "#footerWrapper",
    ".footer",
    "#mobileHeader",
    "#mobileFooter",
)


def _decompose_pornhub_sitewide(tree: LexborHTMLParser) -> None:
    for sel in _PORNHUB_SITEWIDE_SELECTORS:
        for n in tree.css(sel):
            n.decompose()


def extract_pornhub_max_video_page(html: str | LexborHTMLParser) -> int:
    """Detect maximum video pagination page number from Pornhub performer videos HTML."""
    tree = html if isinstance(html, LexborHTMLParser) else LexborHTMLParser(html)
    max_p = 1
    for a in tree.css(
        ".paginationHolder a, .page_number a, ul.page_number a, li.page_next a, .page_next a, li.page_number a"
    ):
        href = a.attributes.get("href") or ""
        m = re.search(r"[?&]page=(\d+)", href)
        if m:
            try:
                max_p = max(max_p, int(m.group(1)))
            except ValueError:
                pass
        txt = a.text(strip=True)
        if txt.isdigit():
            try:
                max_p = max(max_p, int(txt))
            except ValueError:
                pass

    # Also compute exact total pages from 'Showing X-Y of Z' counters (page 1 pagination buttons cap at 10)
    for node in tree.css(".showingInfo, .showingCounter, .videoCounter, span.showing"):
        txt = node.text(separator=" ", strip=True)
        m_show = re.search(r"(\d+)\s*-\s*(\d+)\s*(?:of|de|von|sur|/)\s*([0-9,.\s]+)", txt, re.I)
        if m_show:
            try:
                start_idx = int(m_show.group(1))
                end_idx = int(m_show.group(2))
                total_cnt = int(re.sub(r"[^\d]", "", m_show.group(3)))
                per_page = max(1, end_idx - start_idx + 1)
                if per_page >= 12 and total_cnt > end_idx:
                    max_p = max(max_p, math.ceil(total_cnt / per_page))
            except ValueError:
                pass
    return max_p


def extract_pornhub_videos_lexbor(source_url: str, html: str | LexborHTMLParser):
    """Extract canonical and raw video card lists from a Pornhub listing or profile page."""
    tree = html if isinstance(html, LexborHTMLParser) else LexborHTMLParser(html)
    _decompose_pornhub_sitewide(tree)
    canonical, raw = [], []
    seen = set()

    nodes = tree.css("li.videoBox, li.pcVideoListItem")
    if not nodes:
        empty = tree.css_first(".noResults, .noResult, .noVideo, .noVideos")
        if empty is not None:
            return [], []

    for node in nodes:
        link = node.css_first('a[href*="/view_video.php"]')
        if link is None:
            continue
        v_href = link.attributes.get("href") or ""
        v_url = http_url("https://www.pornhub.com", v_href)
        if not v_url or v_url in seen:
            continue
        seen.add(v_url)

        m_vkey = re.search(r"viewkey=([a-zA-Z0-9]+)", v_url)
        v_id = m_vkey.group(1) if m_vkey else f"ph_{len(canonical)+1}"

        img = node.css_first("img")
        t_el = node.css_first("span.title a, .title a, span.title")
        title = ""
        if t_el:
            title = t_el.attributes.get("title") or t_el.text(separator="", strip=True)
        if not title and link:
            title = link.attributes.get("title") or ""
        if not title and img:
            title = img.attributes.get("alt") or ""
        if re.match(r"^\d{1,2}:\d{2}(?::\d{2})?$", title.strip()):
            title = link.attributes.get("title") or (img.attributes.get("alt") if img else "") or title
        thumb = ""
        if img:
            thumb = (
                image_url(
                    source_url,
                    img.attributes,
                    keys=(
                        "data-thumb_url",
                        "data-src",
                        "data-mediumthumb",
                        "data-image",
                        "data-original",
                        "data-lazy-src",
                        "src",
                    ),
                )
                or ""
            )
            if not title and img.attributes.get("alt"):
                title = img.attributes.get("alt") or ""

        dur_el = node.css_first(".duration, var.duration, span.duration")
        dur = dur_el.text(separator="", strip=True) if dur_el else ""

        hd_el = node.css_first(".hd-thumbnail, .marker-overlays .hd, .hd")
        res = "HD" if hd_el else ""

        views_el = node.css_first("span.views, .views var, .views")
        views = views_el.text(separator=" ", strip=True) if views_el else ""

        added_el = node.css_first("var.added, span.added, .added")
        time_ago = added_el.text(separator=" ", strip=True) if added_el else ""
        if re.search(r"5\d\s+years?\s+ago", time_ago, re.I):
            time_ago = ""

        uploader_el = node.css_first(".videoUploaderBlock a, .usernameWrap a, a.usernameWrap")
        uploader = uploader_el.text(separator=" ", strip=True) if uploader_el else ""

        sub_parts = [p for p in (dur, res or "HD", views, time_ago) if p]
        subtitle = " • ".join(sub_parts[:3]) if sub_parts else ""

        canonical.append({
            "id": f"v-{v_id}",
            "title": title.strip(),
            "subtitle": subtitle,
            "thumbnailUrl": thumb,
            "duration": dur,
            "resolution": res or "HD",
            "views": views,
            "timeAgo": time_ago,
            "uploadedAt": time_ago,
            "uploader": uploader,
            "type": "video",
            "originalUrl": v_url,
            "streamUrl": f"/api/proxy-video-stream?url={v_url}",
        })
        raw.append({
            "kind": "video",
            "media_key": v_url,
            "source_url": v_url,
            "title": title.strip(),
            "cover_url": thumb,
            "duration": dur,
            "resolution": res or "HD",
            "views": views,
            "timeAgo": time_ago,
            "uploader": uploader,
            "evidence": "pornhub video card",
        })
    return canonical, raw


def extract_pornhub_albums_lexbor(source_url: str, html: str | LexborHTMLParser):
    """Extract canonical and raw photo album cards from a Pornhub photos tab."""
    tree = html if isinstance(html, LexborHTMLParser) else LexborHTMLParser(html)
    _decompose_pornhub_sitewide(tree)
    canonical, raw = [], []
    seen = set()

    # Check for empty results indicator
    empty = tree.css_first(".noResults, .noResult, .noPhotos, .noAlbums, div.photosWrapper .noResults")
    if empty is not None:
        return [], []

    # Locate album cards or profile container links
    cards = tree.css(
        "li.photoAlbumListContainer, div.photoAlbumListBlock, div.photoAlbumListContainer, li[data-album-id], div.album-item, .albumListing li, div.albumBox"
    )
    anchors = []
    if cards:
        for card in cards:
            a = card.css_first('a[href*="/album/"]')
            if a:
                anchors.append((a, card))
    else:
        profile_content = tree.css_first(
            "#profileContent, .profileContent, #photosTab, .profilePhotos, #photoAlbumList, .photosSection, .albumSection, #showAllChanelPhotos"
        )
        if profile_content:
            for a in profile_content.css('a[href*="/album/"]'):
                anchors.append((a, a.parent))
        else:
            for a in tree.css('a[href*="/album/"]'):
                anchors.append((a, a.parent))

    for a, card_el in anchors:
        href = a.attributes.get("href") or ""
        alb_url = http_url("https://www.pornhub.com", href)
        if not alb_url or alb_url in seen:
            continue
        seen.add(alb_url)

        m_id = re.search(r"/album/(\d+)", alb_url)
        alb_id = m_id.group(1) if m_id else f"alb_{len(canonical)+1}"

        p = card_el or a.parent
        img = a.css_first("img") or (p.css_first("img") if p else None)
        thumb = ""
        if img:
            thumb = (
                img.attributes.get("data-src")
                or img.attributes.get("data-bkg")
                or img.attributes.get("src")
                or ""
            )
        if not thumb and p:
            bkg = p.css_first(".photoAlbumListBlock, [data-bkg]") or (p if p.attributes.get("data-bkg") else None)
            if bkg and bkg.attributes.get("data-bkg"):
                thumb = bkg.attributes.get("data-bkg") or ""

        raw_text = a.text(separator=" ", strip=True)
        m_cnt = re.search(r"(\d+)\s*Photos", raw_text, re.I)
        photo_count = int(m_cnt.group(1)) if m_cnt else None

        title = re.sub(r"\d+\s*Photos.*$", "", raw_text, flags=re.I).strip()
        if not title and img:
            title = img.attributes.get("alt") or img.attributes.get("title") or ""
        if not title:
            title = f"Album {alb_id}"

        canonical.append({
            "id": f"alb-{alb_id}",
            "title": title,
            "photoCount": photo_count,
            "updatedAt": "",
            "thumbnailUrl": thumb,
            "category": "",
            "isComplete": False,
            "url": alb_url,
        })
        raw.append({
            "key": alb_url,
            "source_url": alb_url,
            "title": title,
            "cover_url": thumb,
            "photo_count": photo_count,
            "provenance": {"page_url": source_url, "evidence": "performer photos", "ownership": "unverified"},
        })
    return canonical, raw


def extract_pornhub_playlists_lexbor(
    source_url: str, html: str | LexborHTMLParser, fallback_avatar: str = ""
):
    """Extract canonical and raw playlist cards from a Pornhub playlists tab."""
    tree = html if isinstance(html, LexborHTMLParser) else LexborHTMLParser(html)
    _decompose_pornhub_sitewide(tree)
    canonical, raw = [], []
    seen = set()

    # Check for empty results indicator
    empty = tree.css_first(".noResults, .noResult, .noPlaylists, div.userPlaylists .noResults")
    if empty is not None:
        return [], []

    # Locate playlist cards or container
    raw_cards = tree.css(
        "li.playlistChannelListItem, div.playlistGridItem, li[data-playlist-id], li.playlistBox, div.userPlaylistBlock, li.full-width, .user-playlist li"
    )
    cards = []
    seen_card_ids = set()
    for c in raw_cards:
        c_key = c.attributes.get("id") or id(c)
        if c_key not in seen_card_ids:
            seen_card_ids.add(c_key)
            cards.append(c)

    anchors = []
    if cards:
        for card in cards:
            pl_links = card.css('a[href*="/playlist/"]')
            if not pl_links:
                continue
            best_a = None
            best_title = ""
            # First check dedicated title links/elements inside the card
            t_el = card.css_first(".thumbnail-info-wrapper span.title a, span.title a, a.title, .thumbnail-info-wrapper a, [data-label='playlist_title']")
            if t_el:
                t_cand = (t_el.attributes.get("title") or t_el.text(strip=True) or "").strip()
                if t_cand and t_cand.lower() not in ("view playlist", "play all", "play"):
                    best_a = t_el
                    best_title = t_cand

            if not best_a:
                for a in pl_links:
                    txt = a.text(strip=True)
                    candidate_title = (a.attributes.get("title") or txt or "").strip()
                    if candidate_title and candidate_title.lower() not in ("view playlist", "play all", "play"):
                        best_a = a
                        best_title = candidate_title
                        break

            if not best_a:
                best_a = pl_links[0]
                best_title = (best_a.attributes.get("title") or best_a.text(strip=True) or "").strip()
            anchors.append((best_a, card, best_title))
    else:
        profile_content = tree.css_first(
            "#profileContent, .profileContent, #playlistsTab, .userPlaylists, #playListSection, ul.user-playlist, div.playlistGrid, .playlistSection, #showAllChanelPlaylists"
        )
        scope = profile_content if profile_content is not None else tree
        for a in scope.css('a[href*="/playlist/"]'):
            anchors.append((a, a.parent, (a.attributes.get("title") or a.text(strip=True) or "").strip()))

    for a, card_el, custom_title in anchors:
        href = a.attributes.get("href") or ""
        pl_url = http_url("https://www.pornhub.com", href)
        if not pl_url or pl_url in seen:
            continue
        seen.add(pl_url)

        m_id = re.search(r"/playlist/(\d+)", pl_url)
        pl_id = m_id.group(1) if m_id else f"pl_{len(canonical)+1}"

        title = (custom_title or "").strip()
        p = card_el or a.parent
        if not title or title.lower() in ("view playlist", "play all", "play"):
            if p:
                for o in p.css('.thumbnail-info-wrapper span.title a, span.title a, a.title, a[href*="/playlist/"], .title, span.title, div.title, [data-label="playlist_title"]'):
                    t = (o.attributes.get("title") or o.text(strip=True) or "").strip()
                    if t and t.lower() not in ("view playlist", "play all", "play"):
                        title = t
                        break
        if not title or title.lower() in ("view playlist", "play all", "play"):
            if p:
                img = p.css_first("img")
                if img:
                    t = (img.attributes.get("alt") or img.attributes.get("title") or "").strip()
                    if t and t.lower() not in ("view playlist", "play all", "play"):
                        title = t
        if not title or title.lower() in ("view playlist", "play all", "play"):
            title = f"Playlist {pl_id}"

        thumb = ""
        if p:
            img = p.css_first("img.largeThumb, img.js-videoThumb, .wrapFix img, .linkWrapper > img, img")
            if img:
                for attr in ("data-thumb_url", "data-mediumthumb", "data-src", "data-image", "data-bkg", "data-smallthumb"):
                    val = (img.attributes.get(attr) or "").strip()
                    if val and not val.startswith("data:"):
                        thumb = val
                        break
                if not thumb:
                    src_val = (img.attributes.get("src") or "").strip()
                    if src_val and not src_val.startswith("data:"):
                        thumb = src_val
            if not thumb:
                bkg = p.css_first("[data-bkg]")
                if bkg:
                    bkg_val = (bkg.attributes.get("data-bkg") or "").strip()
                    if bkg_val and not bkg_val.startswith("data:"):
                        thumb = bkg_val
        if not thumb:
            thumb = fallback_avatar

        video_count = None
        if p:
            cnt_el = p.css_first(".playlist-videos, .number, .videoShowPage, span.videos, .videoCount")
            if cnt_el:
                cnt_txt = cnt_el.text(separator=" ", strip=True)
                m_cnt = re.search(r"(\d+)\s*videos?", cnt_txt, re.I)
                if not m_cnt:
                    m_cnt = re.search(r"\b(\d+)\b", cnt_txt)
                if m_cnt:
                    try:
                        video_count = int(m_cnt.group(1))
                    except ValueError:
                        pass

        author = None
        author_url = None
        if p:
            user_el = p.css_first("span.user a, a.usernameLink, .usernameWrap a, a[href*='/pornstar/'], a[href*='/model/'], a[href*='/channels/'], a[href*='/users/']")
            if user_el:
                author = (user_el.attributes.get("title") or user_el.text(strip=True) or "").strip() or None
                u_href = user_el.attributes.get("href") or ""
                if u_href:
                    author_url = http_url("https://www.pornhub.com", u_href)

        canonical.append({
            "id": f"pl-{pl_id}",
            "title": title.strip(),
            "videoCount": video_count,
            "updatedAt": "",
            "thumbnailUrl": thumb,
            "description": "",
            "loadedCount": 0,
            "url": pl_url,
            "author": author,
            "authorUrl": author_url,
        })
        raw.append({
            "key": pl_url,
            "source_url": pl_url,
            "title": title.strip(),
            "cover_url": thumb,
            "video_count": video_count,
            "author": author,
            "author_url": author_url,
            "provenance": {"page_url": source_url, "evidence": "playlists", "ownership": "unverified"},
        })
    return canonical, raw


def extract_pornhub_gifs_lexbor(source_url: str, html: str | LexborHTMLParser):
    """Extract canonical and raw GIF items from a Pornhub GIFs tab."""
    tree = html if isinstance(html, LexborHTMLParser) else LexborHTMLParser(html)
    _decompose_pornhub_sitewide(tree)
    canonical, raw = [], []
    seen = set()

    search_container = tree.css_first("ul.gifsSearch, ul.gifs, #gifsResultSection")
    scope = search_container if search_container is not None else tree
    for block in scope.css("li.gifVideoBlock, li.gifListItem, li.gifLi"):
        link = block.css_first('a[href*="/gif/"]')
        if not link:
            continue
        g_href = link.attributes.get("href") or ""
        g_url = http_url("https://www.pornhub.com", g_href)
        if not g_url or g_url in seen:
            continue
        seen.add(g_url)

        m_id = re.search(r"/gif/(\d+)", g_url)
        gif_id = m_id.group(1) if m_id else f"gif_{len(canonical)+1}"

        title_el = block.css_first(".title, span.title, div.title")
        title = title_el.text(separator=" ", strip=True) if title_el else ""
        video_el = block.css_first("video")
        img_el = None
        for cand_img in block.css("img"):
            cls = (cand_img.attributes.get("class") or "").lower()
            if "loader" not in cls:
                img_el = cand_img
                break

        if not title and img_el:
            title = (img_el.attributes.get("alt") or img_el.attributes.get("title") or "").strip()
        if not title:
            title = (link.attributes.get("title") or link.text(separator=" ", strip=True) or "").strip()
        if not title or title.lower() == "loading":
            title = f"GIF {gif_id}"

        mp4_url = (
            (video_el.attributes.get("data-mp4") if video_el else "")
            or (img_el.attributes.get("data-mp4") if img_el else "")
            or ""
        )
        webm_url = (
            (video_el.attributes.get("data-webm") if video_el else "")
            or (img_el.attributes.get("data-webm") if img_el else "")
            or ""
        )
        gif_direct_url = (img_el.attributes.get("data-gif-url") if img_el else "") or ""

        poster = ""
        if video_el:
            poster = video_el.attributes.get("data-poster") or video_el.attributes.get("poster") or ""
        if poster.startswith("data:"):
            poster = ""
        if not poster and img_el:
            poster = (
                img_el.attributes.get("data-thumb_url")
                or img_el.attributes.get("data-static-url")
                or img_el.attributes.get("data-src")
                or img_el.attributes.get("src")
                or ""
            )

        media_url = gif_direct_url or mp4_url or webm_url or g_url
        canonical.append({
            "id": f"gif-{gif_id}",
            "title": title,
            "thumbnailUrl": poster,
            "originalUrl": media_url,
            "pageUrl": g_url,
            "sourcePage": source_url,
            "resolution": "",
            "metadataStatus": "available",
            "timeAgo": "",
            "type": "gif",
            "isAnimated": True,
            "isResolvedOriginal": bool(media_url and media_url != poster and media_url != g_url),
            "format": "gif" if gif_direct_url else ("mp4" if mp4_url else "webm"),
            "url": g_url,
            "width": 0,
            "height": 0,
        })
        raw.append({
            "kind": "gif",
            "media_key": g_url,
            "source_url": g_url,
            "title": title,
            "cover_url": poster,
            "evidence": "pornhub gif card",
        })
    return canonical, raw


def extract_pornhub_root_lexbor(source_url: str, html: str | LexborHTMLParser) -> dict:
    """Extract Pornhub performer/channel root data: name, avatar, cover, bio, and page 1 videos."""
    tree = html if isinstance(html, LexborHTMLParser) else LexborHTMLParser(html)
    _decompose_pornhub_sitewide(tree)

    # 1. Name
    h1 = (
        tree.css_first(".profileHeader h1")
        or tree.css_first("h1[itemprop='name']")
        or tree.css_first(".name h1")
        or tree.css_first(".profileUserName a")
        or tree.css_first(".profileUserName")
        or tree.css_first("div.name")
        or tree.css_first(".pornstarName")
        or tree.css_first("h1")
    )
    name = h1.text(separator="", strip=True) if h1 is not None else ""
    if not name:
        title_tag = tree.css_first("title")
        if title_tag:
            m = re.match(r"^([^-\|]+)", title_tag.text(separator="", strip=True))
            if m:
                name = (
                    m.group(1)
                    .replace("Porn Videos", "")
                    .replace("Pornstar", "")
                    .replace("Vídeos Pornôs de", "")
                    .strip()
                )
    if not name:
        parts = urlsplit(source_url).path.strip("/").split("/")
        name = parts[1].replace("-", " ").title() if len(parts) > 1 else parts[0].title()

    # 2. Avatar
    avatar = ""
    for cand in tree.css("#getAvatar, .avatarWrapper img, img.avatar, .thumbImage img"):
        s = (
            image_url(
                source_url,
                cand.attributes,
                keys=("src", "data-src", "data-thumb_url", "data-image", "data-original"),
            )
            or ""
        )
        if s:
            avatar = s
            break

    # 3. Banner / Cover
    cover_el = (
        tree.css_first("#coverPictureDefault")
        or tree.css_first(".coverImage")
        or tree.css_first("#coverPicture")
        or tree.css_first("#channelBannerImage")
    )
    banner = (
        image_url(source_url, cover_el.attributes, keys=("src", "data-src", "data-thumb_url")) or ""
        if cover_el is not None
        else ""
    )

    # 4. Verified Status
    verified = bool(
        tree.css_first(
            '.verified-icon, .icon-verified, i.verified, [data-title*="Verified"], [title*="Verificado"]'
        )
    )

    # 5. Bio Details & Stats
    bio_details = {}
    for piece in tree.css(".infoPiece"):
        t = piece.text(separator=" ", strip=True)
        if ":" in t:
            k, v = t.split(":", 1)
            bio_details[k.strip()] = v.strip()

    subscribers_str = ""
    views_str = ""
    channel_videos_reported = 0

    # Pornstars & Models: .infoBox with .big + .title / data-title
    for box in tree.css(".infoBox"):
        title_el = box.css_first(".title")
        title_txt = title_el.text(separator=" ", strip=True).lower() if title_el else ""
        big_el = box.css_first(".big")
        big_txt = re.sub(r"\s+", " ", big_el.text(separator=" ", strip=True)).strip() if big_el else ""
        data_title = (box.attributes.get("data-title") or "").strip()
        cls_tokens = (box.attributes.get("class") or "").lower().split()

        if "subscriber" in title_txt or "subscribers" in cls_tokens or "subscribers:" in data_title.lower():
            if not subscribers_str:
                if big_txt:
                    subscribers_str = big_txt
                else:
                    m_dt = re.search(r"Subscribers?\s*:\s*([0-9][0-9,.]*(?:\s*[KMB])?)", data_title, re.I)
                    if m_dt:
                        subscribers_str = m_dt.group(1).strip()
        elif "view" in title_txt or "video views:" in data_title.lower():
            if not views_str:
                if big_txt:
                    views_str = big_txt
                else:
                    m_dt = re.search(r"(?:Video\s+)?views?\s*:\s*([0-9][0-9,.]*(?:\s*[KMB])?)", data_title, re.I)
                    if m_dt:
                        views_str = m_dt.group(1).strip()

    # Channels: #stats .info (e.g. "10,742,840,641 VIDEO VIEWS", "8,516,790 SUBSCRIBERS", "4,915 VIDEOS")
    for stat_node in tree.css("#stats .info"):
        label_el = stat_node.css_first("span")
        label_txt = label_el.text(separator=" ", strip=True).lower() if label_el else ""
        raw_txt = stat_node.text(separator=" ", strip=True)
        m_val = re.match(r"([0-9][0-9,.]*(?:\s*[KMB])?)", raw_txt, re.I)
        val_txt = m_val.group(1).strip() if m_val else ""
        if not val_txt:
            continue
        if "subscriber" in label_txt and not subscribers_str:
            subscribers_str = val_txt
        elif "view" in label_txt and not views_str:
            views_str = val_txt
        elif "video" in label_txt:
            try:
                channel_videos_reported = max(channel_videos_reported, int(re.sub(r"[^\d]", "", val_txt)))
            except ValueError:
                pass
        elif "rank" in label_txt and "Rank" not in bio_details:
            bio_details["Rank"] = val_txt

    # Users: .bottomInfo ("Sativa_rose 0 subscribers 0 videos watched")
    if not subscribers_str:
        bottom_el = tree.css_first(".bottomInfo")
        if bottom_el:
            btxt = bottom_el.text(separator=" ", strip=True)
            m_sub = re.search(r"(?:^|\s)([0-9][0-9,.]*(?:\s*[KMB])?)\s*subscribers?\b", btxt, re.I)
            if m_sub:
                subscribers_str = m_sub.group(1).strip()

    if subscribers_str and "Subscribers" not in bio_details:
        bio_details["Subscribers"] = subscribers_str
    if views_str and "Video Views" not in bio_details and "Views" not in bio_details:
        bio_details["Video Views"] = views_str

    tagline_parts = []
    for k in (
        "Local de nascimento",
        "City and Country",
        "Birthplace",
        "Medidas",
        "Measurements",
        "Altura",
        "Height",
        "Idade",
        "Age",
    ):
        if k in bio_details and bio_details[k]:
            tagline_parts.append(bio_details[k])
    tagline = " • ".join(tagline_parts[:3])

    # 6. Social Links
    social_links = {}
    for sa in tree.css("a[href]"):
        shref = sa.attributes.get("href") or ""
        if "pornhub" in shref.lower():
            continue
        if "twitter.com" in shref or "x.com" in shref:
            social_links["Twitter"] = shref
        elif "instagram.com" in shref:
            social_links["Instagram"] = shref
        elif "onlyfans.com" in shref:
            social_links["OnlyFans"] = shref

    # 7. Page 1 videos
    videos_pair = extract_pornhub_videos_lexbor(source_url, tree)
    clean_slug = quote(re.sub(r"\s+", "-", name.lower()), safe="-")

    # 8. Total videos, photos & GIFs reported
    total_videos_reported = channel_videos_reported or None
    vtab = tree.css_first(".videosTab a, a[href*='/videos'], li[data-tab='videos'] a")
    if vtab:
        m_vtot = re.search(r"\((\d+)\)", vtab.text(separator=" ", strip=True))
        if m_vtot:
            total_videos_reported = max(total_videos_reported or 0, int(m_vtot.group(1)))
    for node in tree.css(".showingInfo, .showingCounter, .videoCounter, span.showing"):
        txt = node.text(separator=" ", strip=True)
        m_show = re.search(r"(\d+)\s*-\s*(\d+)\s*(?:of|de|von|sur|/)\s*([0-9,.\s]+)", txt, re.I)
        if m_show:
            try:
                total_cnt = int(re.sub(r"[^\d]", "", m_show.group(3)))
                total_videos_reported = max(total_videos_reported or 0, total_cnt)
            except ValueError:
                pass
    if total_videos_reported is None:
        total_videos_reported = len(videos_pair[0])

    total_photos_reported = None
    for pnode in tree.css(".photosTab a, li[data-tab='photos'] a, a[href*='/photos'], h2, h3, .sectionTitle"):
        ptxt = pnode.text(separator=" ", strip=True)
        if len(ptxt) < 40:
            m_ptot = re.search(r"\b(?:Photos|Albums)\s*\(([0-9,]+)\)", ptxt, re.I)
            if m_ptot:
                total_photos_reported = max(total_photos_reported or 0, int(m_ptot.group(1).replace(",", "")))

    total_gifs_reported = None
    for gnode in tree.css(".gifsTab a, li[data-tab='gifs'] a, a[href*='/gifs'], h2, h3, .sectionTitle"):
        gtxt = gnode.text(separator=" ", strip=True)
        if len(gtxt) < 40:
            m_gtot = re.search(r"\bGIFs?\s*\(([0-9,]+)\)", gtxt, re.I)
            if m_gtot:
                total_gifs_reported = max(total_gifs_reported or 0, int(m_gtot.group(1).replace(",", "")))

    return {
        "platform": "pornhub",
        "name": name,
        "handle": f"@{name.lower().replace(' ', '')}",
        "avatar": avatar,
        "banner": banner,
        "tagline": tagline,
        "structured_bio": bio_details,
        "social_links": social_links,
        "verified": verified,
        "subscribers": subscribers_str or None,
        "views": views_str or None,
        "total_videos_reported": total_videos_reported,
        "total_photos_reported": total_photos_reported,
        "total_gifs_reported": total_gifs_reported,
        "clean_slug": clean_slug,
        "videos": videos_pair,
    }


# ============================================================================
# XHAMSTER EXTRACTORS
# ============================================================================

def is_xhamster_host(url: str) -> bool:
    host = urlsplit(url).netloc.lower()
    return bool(re.search(r"(?:^|\.)(xhamster|xhcdn|xhday|xhvideotop|xhamsterlive|xhamster\d*)\.[a-z.]+$", host))


def is_xhamster_profile_url(url: str) -> bool:
    if not is_xhamster_host(url):
        return False
    path = urlsplit(url).path.rstrip("/").lower()
    return bool(
        re.match(
            r"^/(?:pornstars|channels|creators|users|models)/[a-zA-Z0-9_\-]+(?:/(?:videos|photos|galleries|shorts|playlists|about))?$",
            path,
        )
    ) or "/users/profiles/" in path


def normalize_xhamster_profile_base_url(url: str) -> str:
    """Normalize language subdomains (e.g. pt.xhamster.com -> xhamster.com) and strip subpaths."""
    u = re.sub(r"^https?://(?:[a-z]{2,3})\.(xhamster\.[a-z.]+)", r"https://\1", url.strip(), flags=re.I)
    parsed = urlsplit(u)
    m = re.match(r"^/(pornstars|channels|creators|users)/([a-zA-Z0-9_\-]+)", parsed.path, re.I)
    if m:
        base_path = f"/{m.group(1).lower()}/{m.group(2)}"
        scheme = parsed.scheme or "https"
        netloc = "xhamster.com" if "xhamster" in (parsed.netloc or "") else (parsed.netloc or "xhamster.com")
        return f"{scheme}://{netloc}{base_path}"
    return u.rstrip("/")


def extract_xhamster_max_video_page(html: str | LexborHTMLParser, total_videos: int | None = None) -> int:
    """Detect maximum video pagination page number for xHamster performer or channel."""
    html_text = html if isinstance(html, str) else (getattr(html, "html", "") or "")
    max_page = 1
    if html_text:
        matches = re.findall(r"/(?:pornstars|channels|creators|users)/[a-zA-Z0-9_\-]+/(?:videos/)?(\d+)(?:[\"'\s?]|$)", html_text)
        for m in matches:
            try:
                p = int(m)
                if 1 <= p <= 200:
                    max_page = max(max_page, p)
            except ValueError:
                pass
    if max_page == 1 and total_videos and total_videos > 45:
        max_page = min(math.ceil(total_videos / 45), 60)
    return max_page


def _extract_xhamster_initials(html_or_tree: str | LexborHTMLParser) -> dict:
    html_text = html_or_tree if isinstance(html_or_tree, str) else (getattr(html_or_tree, "html", "") or "")
    if not html_text:
        return {}
    m = re.search(r"window\.initials\s*=\s*(\{.*?\});\s*(?:window\.|\n|<)", html_text, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(1))
        except Exception:
            pass
    return {}


def extract_xhamster_videos_lexbor(source_url: str, html: str | LexborHTMLParser | dict) -> tuple[list, list]:
    """Extract canonical and raw video items from xHamster profile or subpages."""
    if isinstance(html, dict):
        initials = html
        tree = LexborHTMLParser("")
    elif isinstance(html, LexborHTMLParser):
        tree = html
        initials = _extract_xhamster_initials(tree)
    else:
        tree = LexborHTMLParser(html or "")
        initials = _extract_xhamster_initials(html or "")

    canonical, raw = [], []
    seen = set()

    # 1. From window.initials
    v_props = []
    for k, comp in initials.items():
        if isinstance(comp, dict):
            vl = comp.get("videoListProps", {}).get("videoThumbProps", []) or comp.get("videoThumbProps", [])
            if vl and isinstance(vl, list):
                v_props.extend(vl)
        elif isinstance(comp, list) and ("video" in k.lower() or "thumb" in k.lower()):
            v_props.extend(comp)

    for vp in v_props:
        p_url = vp.get("pageURL") or vp.get("url")
        if not p_url or p_url in seen or "/shorts/" in p_url:
            continue
        seen.add(p_url)
        v_id = str(vp.get("id") or "")
        dur_sec = vp.get("duration") or 0
        dur_str = f"{dur_sec // 60:02d}:{dur_sec % 60:02d}" if dur_sec else ""
        thumb = vp.get("thumbURL") or vp.get("imageURL") or ""
        title = (vp.get("title") or "").strip() or f"Video {v_id}"
        views_raw = vp.get("views")
        views_str = f"{views_raw:,}" if isinstance(views_raw, (int, float)) else str(views_raw or "")
        rating_obj = vp.get("rating")
        rating_val = rating_obj.get("value") if isinstance(rating_obj, dict) else rating_obj
        res_str = "4K" if (vp.get("isUHD") or vp.get("isUhd")) else ("HD" if (vp.get("isHD") or vp.get("isHd")) else "SD")

        created_ts = vp.get("created")
        date_str = ""
        if created_ts:
            try:
                date_str = datetime.fromtimestamp(created_ts, timezone.utc).strftime("%Y-%m-%d")
            except Exception:
                pass

        preview_clip = vp.get("trailerFallbackUrl") or vp.get("trailerURL")

        card = {
            "id": f"v-xh_{v_id}" if v_id else f"v-xh_{len(canonical)+1}",
            "title": title,
            "duration": dur_str,
            "resolution": res_str,
            "thumbnailUrl": thumb,
            "originalUrl": p_url,
            "views": views_str,
            "rating": rating_val,
            "uploadedAt": date_str,
            "timeAgo": date_str,
            "metadataStatus": "fetched" if date_str else "pending",
        }
        if preview_clip:
            card["previewVideoUrl"] = preview_clip
            card["previewClip"] = preview_clip
        canonical.append(card)
        raw.append({
            "key": p_url,
            "source_url": p_url,
            "title": title,
            "cover_url": thumb,
            "duration": dur_str,
            "resolution": res_str,
            "views": views_str,
            "uploadedAt": date_str,
            "timeAgo": date_str,
            "metadataStatus": "fetched" if date_str else "pending",
        })

    # 2. Fallback to DOM elements
    for c in tree.css(".video-thumb, [data-video-id]"):
        a = c.css_first("a.video-thumb__image-container, a[href*='/videos/']")
        if not a:
            continue
        v_url = http_url(source_url, a.attributes.get("href"))
        if not v_url or v_url in seen or "/shorts/" in v_url:
            continue
        seen.add(v_url)
        v_id = c.attributes.get("data-video-id") or ""
        if not v_id:
            m_id = re.search(r"-([a-zA-Z0-9]+)$", v_url)
            v_id = m_id.group(1) if m_id else str(len(canonical) + 1)
        img = c.css_first("img")
        thumb = image_url(source_url, img.attributes) if img else ""
        tit_el = c.css_first("[data-role='thumb-title'], .video-thumb-info__name")
        title = (
            tit_el.text(separator=" ", strip=True)
            if tit_el
            else (a.attributes.get("aria-label") or a.attributes.get("title") or (img.attributes.get("alt") if img else "") or "")
        )
        dur_el = c.css_first("[data-role='thumb-duration'], .video-thumb-info__duration, .video-thumb__duration, .duration")
        duration = dur_el.text(strip=True) if dur_el else ""
        vie_el = c.css_first("[data-role='thumb-views'], .video-thumb-info__views, .views")
        views = vie_el.text(strip=True) if vie_el else ""
        badge_el = c.css_first(".badge-hd, [class*='badge-hd'], [class*='badge-quality']")
        if badge_el:
            b_txt = badge_el.text(strip=True).upper()
            resolution = "4K" if "4K" in b_txt else ("1080p" if "1080" in b_txt else "HD")
        else:
            resolution = "HD"
        preview_clip = (
            a.attributes.get("data-previewvideo")
            or a.attributes.get("data-previewvideo-fallback")
            or c.attributes.get("data-previewvideo")
        )

        date_el = c.css_first("[data-role='thumb-date'], .video-thumb-info__date, time, .date")
        date_str = ""
        if date_el:
            date_str = date_el.attributes.get("datetime") or date_el.text(strip=True)

        card = {
            "id": f"v-xh_{v_id}",
            "title": title or f"Video {v_id}",
            "duration": duration,
            "resolution": resolution,
            "thumbnailUrl": thumb or "",
            "originalUrl": v_url,
            "views": views,
            "uploadedAt": date_str,
            "timeAgo": date_str,
            "metadataStatus": "fetched" if date_str else "pending",
        }
        if preview_clip:
            card["previewVideoUrl"] = preview_clip
            card["previewClip"] = preview_clip
        canonical.append(card)
        raw.append({
            "key": v_url,
            "source_url": v_url,
            "title": card["title"],
            "cover_url": card["thumbnailUrl"],
            "duration": duration,
            "views": views,
            "uploadedAt": date_str,
            "timeAgo": date_str,
            "metadataStatus": "fetched" if date_str else "pending",
        })

    return canonical, raw


def extract_xhamster_shorts_lexbor(source_url: str, html: str | LexborHTMLParser) -> tuple[list, list]:
    """Extract animated shorts / moments from xHamster /shorts tab."""
    tree = html if isinstance(html, LexborHTMLParser) else LexborHTMLParser(html or "")
    initials = _extract_xhamster_initials(html if isinstance(html, str) else tree)
    canonical = []
    raw = []
    seen = set()

    # 1. From window.initials (e.g. momentsComponent)
    m_props = []
    for k, v in initials.items():
        if isinstance(v, dict):
            vl = v.get("videoListProps", {}).get("videoThumbProps", []) or v.get("videoThumbProps", [])
            if vl and ("moment" in k.lower() or "short" in k.lower()):
                m_props.extend(vl)
        elif isinstance(v, list) and ("moment" in k.lower() or "short" in k.lower()):
            m_props.extend(v)

    for item in m_props:
        p_url = http_url(source_url, item.get("pageURL") or item.get("url"))
        if not p_url or p_url in seen or p_url.rstrip("/").endswith("/shorts"):
            continue
        seen.add(p_url)
        sid = str(item.get("id") or len(canonical) + 1)
        title = item.get("title") or f"Moment {sid}"
        trailer = item.get("trailerURL") or item.get("trailerFallbackUrl") or ""
        high_thumb = item.get("imageURL") or item.get("thumbURL") or ""
        card = {
            "id": f"short-xh_{sid}",
            "title": title,
            "url": p_url,
            "originalUrl": trailer or p_url,
            "thumbnailUrl": high_thumb or "",
            "previewVideoUrl": trailer,
            "previewClip": trailer,
            "isAnimated": True,
            "isResolvedOriginal": bool(trailer),
            "format": "webm" if trailer.endswith(".webm") else "mp4",
            "type": "moment",
            "resolution": "720p" if "720" in high_thumb else ("350x620" if "350" in trailer else ""),
        }
        canonical.append(card)
        raw.append({
            "key": p_url,
            "source_url": p_url,
            "title": title,
            "cover_url": high_thumb,
            "video_url": trailer,
            "provenance": {"page_url": source_url, "evidence": "xhamster shorts", "ownership": "unverified"},
        })

    # 2. From DOM elements fallback
    for c in tree.css(".video-thumb__moment, a[href*='/shorts/']"):
        a = c if c.tag == "a" else c.css_first("a[href*='/shorts/']")
        if not a:
            continue
        s_href = a.attributes.get("href") or ""
        s_url = http_url(source_url, s_href)
        if not s_url or s_url in seen or s_url.rstrip("/").endswith("/shorts"):
            continue
        seen.add(s_url)

        img = c.css_first("img")
        thumb = image_url(source_url, img.attributes) if img else ""
        alt = (img.attributes.get("alt") if img else "") or a.text(strip=True) or "Moment"
        m_id = re.search(r"-([a-zA-Z0-9]+)$", s_url)
        sid = m_id.group(1) if m_id else str(len(canonical) + 1)
        preview_clip = (
            a.attributes.get("data-previewvideo")
            or a.attributes.get("data-previewvideo-fallback")
            or c.attributes.get("data-previewvideo")
            or ""
        )

        card = {
            "id": f"short-xh_{sid}",
            "title": alt,
            "url": s_url,
            "originalUrl": preview_clip or s_url,
            "thumbnailUrl": thumb or "",
            "previewVideoUrl": preview_clip,
            "previewClip": preview_clip,
            "isAnimated": True,
            "isResolvedOriginal": bool(preview_clip),
            "format": "webm" if preview_clip.endswith(".webm") else "mp4",
            "type": "moment",
            "resolution": "350x620" if "350" in preview_clip else "",
        }
        canonical.append(card)
        raw.append({
            "key": s_url,
            "source_url": s_url,
            "title": alt,
            "cover_url": thumb or "",
            "video_url": preview_clip,
            "provenance": {"page_url": source_url, "evidence": "xhamster shorts", "ownership": "unverified"},
        })
    return canonical, raw


def extract_xhamster_albums_lexbor(source_url: str, html: str | LexborHTMLParser) -> tuple[list, list]:
    """Extract photo galleries / albums linked to an xHamster performer or user."""
    tree = html if isinstance(html, LexborHTMLParser) else LexborHTMLParser(html or "")
    initials = _extract_xhamster_initials(html if isinstance(html, str) else tree)
    canonical, raw = [], []
    seen = set()

    # From initials
    gp = initials.get("recentFavoriteGalleriesPhotosSectionComponent") or {}
    items = gp.get("items", []) if isinstance(gp, dict) else []
    for it in items:
        page_url = http_url(source_url, it.get("pageURL") or it.get("url"))
        if not page_url or page_url in seen:
            continue
        seen.add(page_url)
        alb_id = str(it.get("id") or len(canonical) + 1)
        title = it.get("title") or it.get("name") or f"Gallery {alb_id}"
        thumb = it.get("thumbURL") or it.get("imageURL") or ""
        cnt = it.get("photosCount") or it.get("count") or 0

        card = {
            "id": f"alb-xh_{alb_id}",
            "title": title,
            "photoCount": cnt,
            "loadedCount": cnt,
            "paginationComplete": True,
            "isComplete": True,
            "updatedAt": "",
            "thumbnailUrl": thumb,
            "category": "Photos",
            "url": page_url,
            "metadataStatus": "pending",
        }
        canonical.append(card)
        raw.append({
            "key": page_url,
            "source_url": page_url,
            "title": title,
            "cover_url": thumb,
            "provenance": {"page_url": source_url, "evidence": "performer photos", "ownership": "unverified"},
        })

    # From DOM links
    for a in tree.css("a[href*='/photos/gallery/']"):
        g_href = a.attributes.get("href") or ""
        g_url = http_url(source_url, g_href)
        if not g_url or g_url in seen:
            continue
        seen.add(g_url)
        m_id = re.search(r"-(\d+)$", g_url)
        alb_id = m_id.group(1) if m_id else str(len(canonical) + 1)

        raw_a_text = a.text(strip=True)
        m_cnt = re.search(r"^(\d+)$", raw_a_text)
        cnt = int(m_cnt.group(1)) if m_cnt else None

        parent = a.parent
        p_container = parent.parent if parent and parent.parent else parent
        title = ""
        for cand_a in (p_container.css("a[href*='/photos/gallery/']") if p_container else []):
            t_txt = cand_a.text(strip=True)
            if t_txt and not re.match(r"^\d+$", t_txt) and len(t_txt) > 3:
                title = t_txt
                break
        if not title and p_container:
            img_c = p_container.css_first("img")
            if img_c:
                title = img_c.attributes.get("alt") or ""
        if not title:
            title = (a.attributes.get("title") or "").strip()
        if not title:
            m_slug = re.search(r"/photos/gallery/([a-zA-Z0-9_\-]+)-\d+", g_url)
            if m_slug:
                title = m_slug.group(1).replace("-", " ").title()

        img = (p_container.css_first("img") if p_container else None) or a.css_first("img")
        thumb = image_url(source_url, img.attributes) if img else ""

        card = {
            "id": f"alb-xh_{alb_id}",
            "title": title or f"Gallery {alb_id}",
            "photoCount": cnt,
            "loadedCount": cnt or 0,
            "paginationComplete": True,
            "isComplete": True,
            "updatedAt": "",
            "thumbnailUrl": thumb or "",
            "category": "Photos",
            "url": g_url,
            "metadataStatus": "pending",
        }
        canonical.append(card)
        raw.append({
            "key": g_url,
            "source_url": g_url,
            "title": card["title"],
            "cover_url": thumb or "",
            "provenance": {"page_url": source_url, "evidence": "performer photos", "ownership": "unverified"},
        })

    return canonical, raw


def extract_xhamster_subscribers(tree: LexborHTMLParser, initials: dict | None = None) -> str | None:
    """Read explicit owner statistics, never counts in comments/recommendations.

    Keep abbreviated source values abbreviated: 3.1K is not an exact 3,100.
    """
    initials = initials if initials is not None else _extract_xhamster_initials(tree)
    info = initials.get("infoComponent")
    buttons = info.get("subscribeButtonsProps") if isinstance(info, dict) else None
    button = buttons.get("subscribeButtonProps") if isinstance(buttons, dict) else None
    owners = [button, initials.get("counters"), initials.get("displayUserModel")]

    def count_text(value):
        if isinstance(value, bool):
            return None
        if isinstance(value, int):
            return f"{value:,}" if value >= 0 else None
        if isinstance(value, str) and re.fullmatch(r"[0-9][0-9.,\s]*(?:[KMBkmb])?", value.strip()):
            return value.strip()
        return None

    for owner in owners:
        if isinstance(owner, dict):
            value = count_text(owner.get("subscribers"))
            if value is not None:
                return value

    # Profile sidebar/header only. Do not search the page's aggregate text:
    # bio, video recommendations and commenters may mention another audience.
    regions = tree.css(
        "#user-info, .user-info, .user-info-block, .user-statistics, .user-stats, "
        ".profile-info, .profile-stats, .landing-info, .landing-info__counters, .channel-header"
    )
    values = set()
    pattern = re.compile(r"([0-9][0-9.,]*(?:\s*[KMB])?)\s+(?:subscribers?|inscritos?)", re.I)
    for region in regions:
        for node in region.css("[data-count='subscribers']"):
            value = count_text(node.text(separator=" ", strip=True))
            if value is not None:
                values.add(value)
        # Match complete statistic rows, rather than numbers inside prose.
        for node in [region, *region.css("li, a, div, span")]:
            match = pattern.fullmatch(node.text(separator=" ", strip=True))
            if match:
                values.add(match.group(1).strip())
    return next(iter(values)) if len(values) == 1 else None


def extract_xhamster_root_lexbor(source_url: str, html: str | LexborHTMLParser) -> dict:
    """Extract xHamster performer/channel/user root metadata, counters, bio, and initial video batch."""
    if isinstance(html, LexborHTMLParser):
        tree = html
        html_text = tree.html or ""
    else:
        html_text = str(html or "")
        tree = LexborHTMLParser(html_text)

    initials = _extract_xhamster_initials(html_text)

    # 1. Name
    name = None
    if "infoComponent" in initials and "pornstarTop" in initials["infoComponent"]:
        name = initials["infoComponent"]["pornstarTop"].get("name")
    if not name and "displayUserModel" in initials:
        name = initials["displayUserModel"].get("name")
    if not name and "channelInfo" in initials:
        slug = initials["channelInfo"].get("slug") or ""
        name = slug.replace("-", " ").title()
    if not name:
        h1 = tree.css_first("h1")
        if h1:
            name = re.sub(r"\s+(?:Porn Videos|Videos|Porn).*$", "", h1.text(strip=True), flags=re.I).strip()
    if not name:
        title_el = tree.css_first("title")
        if title_el:
            name = re.sub(r"['’]s\s+porn.*$", "", title_el.text(strip=True), flags=re.I).strip()
    name = (name or "Creator").strip()

    # 2. Tagline / Bio
    tagline = ""
    if "aboutMeComponent" in initials and initials["aboutMeComponent"].get("text"):
        tagline = initials["aboutMeComponent"]["text"]
    if not tagline and "displayUserModel" in initials and initials["displayUserModel"].get("description"):
        tagline = initials["displayUserModel"]["description"]
    if not tagline and "profileEditableAboutMe" in initials and initials["profileEditableAboutMe"].get("about"):
        tagline = initials["profileEditableAboutMe"]["about"]
    if not tagline:
        desc_el = tree.css_first(".landing-info__description, .about-me, .user-description, [class*='description']")
        if desc_el:
            tagline = desc_el.text(strip=True)
    if not tagline:
        m_desc = tree.css_first("meta[name='description']")
        if m_desc:
            tagline = (m_desc.attributes.get("content") or "").strip()

    # 3. Avatar
    avatar = None
    if "infoComponent" in initials and "pornstarTop" in initials["infoComponent"]:
        avatar = initials["infoComponent"]["pornstarTop"].get("thumbUrl")
    if not avatar and "displayUserModel" in initials:
        avatar = initials["displayUserModel"].get("thumbURL")
    if not avatar:
        logo_el = tree.css_first(".landing-info__logo-image, [class*='logo-image']")
        if logo_el:
            st = logo_el.attributes.get("style") or ""
            m_url = re.search(r"url\(['\"]?(.*?)['\"]?\)", st)
            if m_url:
                avatar = m_url.group(1)
    if not avatar:
        img_avatar = tree.css_first("img.xh-avatar, .author-avatar img, .entity-avatar img, .landing-info__avatar img")
        if img_avatar:
            avatar = image_url(source_url, img_avatar.attributes)
    avatar = avatar or ""

    # 4. Cover / Banner
    cover = avatar
    cover_el = tree.css_first(".channel-header__cover, [class*='header__cover']")
    if cover_el:
        st = cover_el.attributes.get("style") or ""
        m_cover = re.search(r"url\(['\"]?(.*?)['\"]?\)", st)
        if m_cover:
            cover = m_cover.group(1)
    if not cover or cover == avatar:
        cover_img = tree.css_first(".landing-info__cover img, .channel-header__cover img")
        if cover_img:
            cover = image_url(source_url, cover_img.attributes)

    # 5. Handle
    m_slug = re.search(r"/(?:pornstars|channels|creators|users)/([a-zA-Z0-9_\-]+)", source_url, re.I)
    clean_slug = (
        (initials.get("channelInfo") or {}).get("slug")
        or (m_slug.group(1) if m_slug else "")
        or re.sub(r"\s+", "", name.lower())
    )
    handle = f"@{clean_slug}"

    # 6. Statistics & Counters
    subscribers = extract_xhamster_subscribers(tree, initials)
    total_views = None
    total_videos_reported = None
    if "infoComponent" in initials and "pornstarTop" in initials["infoComponent"]:
        pt = initials["infoComponent"]["pornstarTop"]
        total_views = pt.get("viewsCount")
        total_videos_reported = pt.get("videoCount")
    if "counters" in initials:
        cnt = initials["counters"]
        total_videos_reported = total_videos_reported or cnt.get("videos")

    if not total_videos_reported or not total_views:
        stat_el = tree.css_first(".landing-info__counters, [class*='counters-']")
        if stat_el:
            txt = stat_el.text(strip=True)
            m_vid = re.search(r"([\d.,]+[KMB]?)\s*videos", txt, re.I)
            if m_vid and not total_videos_reported:
                try:
                    total_videos_reported = int(re.sub(r"[^\d]", "", m_vid.group(1)))
                except ValueError:
                    pass
            m_vie = re.search(r"([\d.,]+[KMB]?)\s*views", txt, re.I)
            if m_vie and not total_views:
                total_views = m_vie.group(1)

    # 7. Structured Bio
    structured_bio = {}
    about = initials.get("aboutMeComponent")
    if isinstance(about, dict) and isinstance(about.get("personalInfoList"), list):
        for it in about["personalInfoList"]:
            if not isinstance(it, dict):
                continue
            lbl = profile_bio_text(it.get("label"))
            val = profile_bio_text(it.get("value"))
            if lbl is not None and val is not None:
                structured_bio[lbl] = val
    if "pornstarBio" in initials and isinstance(initials["pornstarBio"], dict):
        for k, v in initials["pornstarBio"].items():
            val = profile_bio_text(v)
            if val is not None:
                lbl = re.sub(r"([a-z])([A-Z])", r"\1 \2", k).replace("_", " ").title()
                if lbl not in structured_bio:
                    structured_bio[lbl] = val
    subscribers_str = (
        f"{subscribers:,}"
        if isinstance(subscribers, int)
        else (str(subscribers).strip() if subscribers is not None else "")
    )
    views_str = (
        f"{total_views:,}"
        if isinstance(total_views, int)
        else (str(total_views).strip() if total_views is not None else "")
    )
    if subscribers_str:
        structured_bio["Subscribers"] = subscribers_str
    if views_str:
        structured_bio["Views"] = views_str

    # 8. Video and Album batches
    videos_pair = extract_xhamster_videos_lexbor(source_url, tree)
    albums_pair = extract_xhamster_albums_lexbor(source_url, tree)
    cnt_data = initials.get("counters") if isinstance(initials.get("counters"), dict) else {}
    raw_galleries = cnt_data.get("galleries") if cnt_data.get("galleries") is not None else cnt_data.get("photos")
    galleries_reported = 0
    if isinstance(raw_galleries, int):
        galleries_reported = max(0, raw_galleries)
    elif isinstance(raw_galleries, str) and raw_galleries.strip().isdigit():
        galleries_reported = int(raw_galleries.strip())

    return {
        "platform": "xhamster",
        "name": name,
        "handle": handle,
        "avatar": avatar,
        "banner": cover,
        "verified": bool((initials.get("channelInfo") or {}).get("hasRr") or False),
        "tagline": tagline,
        "structured_bio": structured_bio,
        "social_links": {},
        "subscribers": subscribers_str or None,
        "views": views_str or None,
        "total_videos_reported": total_videos_reported or len(videos_pair[0]),
        "total_photos_reported": max(galleries_reported, len(albums_pair[0])),
        "max_video_page": 2,
        "clean_slug": clean_slug,
        "videos": videos_pair,
        "playlists": ([], []),
        "albums": albums_pair,
    }


def extract_generic_profile_lexbor(source_url: str, html: str | LexborHTMLParser) -> dict:
    """Generic & conservative base profile parser using native Lexbor."""
    tree = html if isinstance(html, LexborHTMLParser) else LexborHTMLParser(html)
    origin = urlsplit(source_url)

    def metadata(prop: str) -> str:
        tag = tree.css_first(f'meta[property="{prop}"], meta[name="{prop}"]')
        if tag is not None:
            return (tag.attributes.get("content") or "").strip()
        return ""

    collections = {"playlists": [], "albums": []}
    highlights = []
    seen = set()
    featured_seen = set()

    for anchor in tree.css("a[href]"):
        url = http_url(source_url, anchor.attributes.get("href") or "")
        if not url or urlsplit(url).netloc.lower() != origin.netloc.lower():
            continue
        path = urlsplit(url).path.lower()

        marked = False
        curr = anchor.parent
        while curr is not None:
            if (curr.attributes.get("data-section") or "") == "featured":
                marked = True
                break
            curr = curr.parent

        featured = (anchor.attributes.get("data-featured") or "").lower() == "true" or marked
        evidence = "data-section=featured" if marked else "data-featured=true"
        declared_kind = (anchor.attributes.get("data-media-type") or "").lower()

        if featured and declared_kind in ("video", "photo", "gif") and url not in featured_seen:
            image = anchor.css_first("img")
            title = re.sub(r"\s+", " ", anchor.text(separator=" ", strip=True)) or (
                (image.attributes.get("alt") or "").strip() if image is not None else ""
            )
            if title:
                featured_seen.add(url)
                highlights.append({
                    "kind": declared_kind,
                    "media_key": url,
                    "source_url": url,
                    "title": title,
                    "cover_url": http_url(source_url, image.attributes.get("src")) if image is not None else None,
                    "evidence": evidence,
                })
            continue

        kind = None
        if any(part in path for part in ("/playlist/", "/playlists/")):
            kind = "playlists"
        elif any(part in path for part in ("/album/", "/albums/", "/gallery/", "/galleries/")):
            kind = "albums"

        if not kind or url.rstrip("/") == source_url.rstrip("/"):
            continue

        image = anchor.css_first("img")
        title = re.sub(r"\s+", " ", anchor.text(separator=" ", strip=True)) or (
            (image.attributes.get("alt") or "").strip() if image is not None else ""
        )
        if not title:
            continue

        if url not in seen:
            seen.add(url)
            collections[kind].append({
                "key": url,
                "source_url": url,
                "title": title,
                "cover_url": http_url(source_url, image.attributes.get("src")) if image is not None else None,
                "provenance": {"page_url": source_url, "evidence": "link on source page", "ownership": "unverified"},
            })

        if featured and url not in featured_seen:
            featured_seen.add(url)
            highlights.append({
                "kind": "playlist" if kind == "playlists" else "album",
                "collection_key": url,
                "evidence": evidence,
            })

    name = metadata("og:title") or None
    cover = http_url(source_url, metadata("og:image"))
    desc = metadata("og:description") or None

    schema_stats = {}
    for script in tree.css('script[type="application/ld+json"]'):
        try:
            ld_data = json.loads(script.text(separator=""))
        except Exception:
            continue
        stack = [ld_data]
        while stack:
            cur = stack.pop()
            if isinstance(cur, list):
                stack.extend(cur)
                continue
            if not isinstance(cur, dict):
                continue
            istat = cur.get("interactionStatistic")
            if istat is not None:
                entries = istat if isinstance(istat, list) else [istat]
                for entry in entries:
                    if not isinstance(entry, dict):
                        continue
                    itype = entry.get("interactionType")
                    if isinstance(itype, dict):
                        itype = itype.get("@type") or itype.get("name") or ""
                    itype_low = str(itype or "").lower()
                    count = entry.get("userInteractionCount")
                    if count is None or (isinstance(count, str) and not count.strip()):
                        continue
                    if "follow" in itype_low or "subscribe" in itype_low:
                        schema_stats.setdefault("subscribers", count)
                    elif "like" in itype_low:
                        schema_stats.setdefault("likes", count)
                    elif "write" in itype_low or "create" in itype_low:
                        schema_stats.setdefault("posts", count)
                    elif "watch" in itype_low or "view" in itype_low:
                        schema_stats.setdefault("views", count)
            for v in cur.values():
                if isinstance(v, (dict, list)):
                    stack.append(v)

    def _sec(items):
        return {"status": "partial", "items": items, "loaded_count": len(items)}

    from .profile_hub_avatar_extractors import extract_structured_profile_avatar

    avatar, _ = extract_structured_profile_avatar(tree, source_url, profile_name=name)
    res = {
        "profile_key": source_url,
        "source_url": source_url,
        "name": name,
        "avatar": avatar,
        "description": desc,
        "cover_url": cover,
        "playlists": _sec(collections["playlists"]),
        "albums": _sec(collections["albums"]),
        "highlights": _sec(highlights),
        "videos": _sec([]),
        "gifs": _sec([]),
    }
    if schema_stats:
        res["profile_data"] = {"stats": schema_stats}
    return res


def extract_video_metadata_lexbor(html: str | LexborHTMLParser) -> dict:
    """Fast native Lexbor extraction of watch-page JSON-LD and meta tags."""
    tree = html if isinstance(html, LexborHTMLParser) else LexborHTMLParser(html)
    result = {"metadataStatus": "fetched", "timeAgo": "", "uploadedAt": None}

    def walk(value):
        if isinstance(value, list):
            for item in value:
                yield from walk(item)
        elif isinstance(value, dict):
            yield value
            for item in value.values():
                if isinstance(item, (dict, list)):
                    yield from walk(item)

    found_vo = False
    for script in tree.css('script[type="application/ld+json"]'):
        try:
            data = json.loads(script.text(separator=""))
        except (ValueError, TypeError):
            continue
        for item in walk(data):
            types = item.get("@type", [])
            if "VideoObject" not in (types if isinstance(types, list) else [types]):
                continue
            stamp = item.get("uploadDate") or item.get("datePublished")
            if isinstance(stamp, str):
                result.update(uploadedAt=stamp, timeAgo=stamp)
            duration = item.get("duration")
            match = re.fullmatch(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?", duration or "")
            if match:
                seconds = int(float(match[1] or 0) * 3600 + float(match[2] or 0) * 60 + float(match[3] or 0))
                result["duration"] = (
                    f"{seconds // 3600}:{seconds // 60 % 60:02d}:{seconds % 60:02d}"
                    if seconds >= 3600
                    else f"{seconds // 60}:{seconds % 60:02d}"
                )
            for key in ("width", "height"):
                try:
                    if float(item.get(key, 0)) > 0:
                        result[key] = int(float(item[key]))
                except (ValueError, TypeError):
                    pass
            if result.get("height"):
                result["resolution"] = f"{result['height']}p"
            if isinstance(item.get("name"), str) and item["name"].strip():
                result["title"] = item["name"].strip()
            statistics = item.get("interactionStatistic", [])
            if isinstance(statistics, dict):
                statistics = [statistics]
            for statistic in statistics if isinstance(statistics, list) else []:
                if isinstance(statistic, dict) and "WatchAction" in str(statistic.get("interactionType", "")):
                    count = statistic.get("userInteractionCount")
                    if count is not None:
                        result["views"] = str(count)
                        result["subtitle"] = str(count)
            found_vo = True
            break
        if found_vo:
            break

    if not result["uploadedAt"]:
        tag = tree.css_first(
            'meta[itemprop="uploadDate"], meta[property="video:release_date"], meta[itemprop="datePublished"], time[datetime]'
        )
        if tag is not None:
            stamp = tag.attributes.get("content") or tag.attributes.get("datetime")
            result.update(uploadedAt=stamp, timeAgo=stamp or "")

    if not result["uploadedAt"]:
        initials = _extract_xhamster_initials(html if isinstance(html, str) else getattr(tree, "html", ""))
        ve = initials.get("videoEntity") or {}
        vm = initials.get("videoModel") or {}
        source_dict = vm or ve
        if source_dict:
            created_ts = source_dict.get("created") or ve.get("created") or vm.get("created")
            if created_ts:
                try:
                    d_str = datetime.fromtimestamp(created_ts, timezone.utc).strftime("%Y-%m-%d")
                    result.update(uploadedAt=d_str, timeAgo=d_str)
                except Exception:
                    pass
            views_val = source_dict.get("views") or ve.get("views") or vm.get("views")
            if views_val and not result.get("views"):
                result["views"] = f"{views_val:,}" if isinstance(views_val, (int, float)) else str(views_val)
                result["subtitle"] = result["views"]
            dur_sec = source_dict.get("duration") or ve.get("duration") or vm.get("duration")
            if dur_sec and not result.get("duration"):
                result["duration"] = f"{dur_sec // 60:02d}:{dur_sec % 60:02d}" if dur_sec else ""
            res = ve.get("maxResolution") or vm.get("maxResolution")
            if not res and isinstance(vm.get("resolution"), (list, tuple)) and len(vm["resolution"]) == 2:
                res = f"{vm['resolution'][1]}p"
            if res and not result.get("resolution"):
                result["resolution"] = res
            title = source_dict.get("title") or ve.get("title") or vm.get("title")
            if title and not result.get("title"):
                result["title"] = title
    return result


def extract_collection_metadata_lexbor(
    html: str | LexborHTMLParser,
    source_url: str,
    kind: str = "playlist",
) -> dict:
    """Fast native Lexbor extraction of playlist or gallery metadata."""
    tree = html if isinstance(html, LexborHTMLParser) else LexborHTMLParser(html)
    result = {
        "metadataStatus": "fetched",
        "author": None,
        "authorUrl": None,
        "views": None,
        "lastAddedDate": None,
        "updatedAtRaw": None,
        "reportedCount": None,
    }
    if is_youtube_host(source_url):
        data = _extract_yt_initial_data(html)
        if data:
            if kind == "playlist":
                for ph in _iter_dicts_with_key(data, "pageHeaderViewModel"):
                    vm = ph["pageHeaderViewModel"]
                    if not isinstance(vm, dict):
                        continue
                    meta_vm = ((vm.get("metadata") or {}).get("contentMetadataViewModel")) or {}
                    for row in meta_vm.get("metadataRows") or []:
                        if not isinstance(row, dict):
                            continue
                        for part in row.get("metadataParts") or []:
                            if not isinstance(part, dict):
                                continue
                            avatar_stack = part.get("avatarStack") or {}
                            if isinstance(avatar_stack, dict):
                                stack_vm = avatar_stack.get("avatarStackViewModel") or {}
                                text_content = ((stack_vm.get("text") or {}).get("content") or "").strip()
                                if text_content.lower().startswith("by "):
                                    text_content = text_content[3:].strip()
                                if text_content and not result["author"]:
                                    result["author"] = text_content
                            part_text = _yt_text(part.get("text") or part).strip()
                            if not part_text:
                                continue
                            cnt_m = re.search(r"(\d[\d,]*)\s+videos?\b", part_text, re.I)
                            if cnt_m and result["reportedCount"] is None:
                                result["reportedCount"] = int(cnt_m.group(1).replace(",", ""))
                            if "view" in part_text.lower() and not result["views"]:
                                result["views"] = re.sub(r"\s*views?\b", "", part_text, flags=re.I).strip() or part_text
                            if ("updated" in part_text.lower() or "ago" in part_text.lower()) and not result["lastAddedDate"]:
                                result["lastAddedDate"] = _normalize_yt_relative_date(
                                    re.sub(r"^updated\s+", "", part_text, flags=re.I).strip()
                                )
                    break
                for psh in _iter_dicts_with_key(data, "playlistSidebarPrimaryInfoRenderer"):
                    ps = psh["playlistSidebarPrimaryInfoRenderer"]
                    if not isinstance(ps, dict):
                        continue
                    for stat in ps.get("stats") or []:
                        stat_text = _yt_text(stat).strip()
                        cnt_m = re.search(r"(\d[\d,]*)\s+videos?\b", stat_text, re.I)
                        if cnt_m and result["reportedCount"] is None:
                            result["reportedCount"] = int(cnt_m.group(1).replace(",", ""))
                        elif "view" in stat_text.lower() and not result["views"]:
                            result["views"] = re.sub(r"\s*views?\b", "", stat_text, flags=re.I).strip()
                        elif ("updated" in stat_text.lower() or "ago" in stat_text.lower()) and not result["lastAddedDate"]:
                            result["lastAddedDate"] = _normalize_yt_relative_date(
                                re.sub(r"^updated\s+", "", stat_text, flags=re.I).strip()
                            )
                for pss in _iter_dicts_with_key(data, "playlistSidebarSecondaryInfoRenderer"):
                    sec = pss["playlistSidebarSecondaryInfoRenderer"]
                    if not isinstance(sec, dict):
                        continue
                    owner_vm = ((sec.get("videoOwner") or {}).get("videoOwnerRenderer")) or {}
                    if isinstance(owner_vm, dict):
                        owner_name = _yt_text(owner_vm.get("title")).strip()
                        if owner_name and not result["author"]:
                            result["author"] = owner_name
                        nav_url = (
                            ((owner_vm.get("navigationEndpoint") or {}).get("commandMetadata") or {})
                            .get("webCommandMetadata", {})
                            .get("url")
                        )
                        if nav_url and not result["authorUrl"]:
                            result["authorUrl"] = http_url("https://www.youtube.com", nav_url)
            else:
                for post_holder in _iter_dicts_with_key(data, "backstagePostRenderer"):
                    post = post_holder["backstagePostRenderer"]
                    if not isinstance(post, dict):
                        continue
                    author_name = _yt_text(post.get("authorText")).strip()
                    if author_name and not result["author"]:
                        result["author"] = author_name
                    author_nav = (
                        ((post.get("authorEndpoint") or {}).get("commandMetadata") or {})
                        .get("webCommandMetadata", {})
                        .get("url")
                    )
                    if author_nav and not result["authorUrl"]:
                        result["authorUrl"] = http_url("https://www.youtube.com", author_nav)
                    pub_text = _normalize_yt_relative_date(_yt_text(post.get("publishedTimeText")).strip())
                    if pub_text and not result["lastAddedDate"]:
                        result["lastAddedDate"] = pub_text
                    imgs = _extract_yt_post_images(post)
                    if imgs and result["reportedCount"] is None:
                        result["reportedCount"] = len(imgs)
                    break

    if is_pornhub_host(source_url):
        raw_html = tree.html if hasattr(tree, "html") else str(html)
        m_pv = re.search(r"PLAYLIST_VIEW\s*=\s*(\{.+?\});", raw_html)
        if m_pv:
            try:
                pv_data = json.loads(m_pv.group(1))
                if pv_data.get("video_count") is not None:
                    result["reportedCount"] = int(pv_data["video_count"])
                if pv_data.get("title") and not result.get("title"):
                    result["title"] = pv_data["title"].strip()
                date_up = pv_data.get("date_updated") or pv_data.get("date_added")
                if date_up:
                    m_d = re.match(r"^(\d{4}-\d{2}-\d{2})", str(date_up).strip())
                    if m_d:
                        result["lastAddedDate"] = m_d.group(1)
                        result["updatedAtRaw"] = str(date_up).strip()
            except Exception:
                pass

        if not result.get("title"):
            h1 = tree.css_first("h1.playlistTitle, #watchPlaylist, h1")
            if h1:
                t = h1.text(strip=True)
                if t and t.lower() not in ("view playlist", "play all", "play"):
                    result["title"] = t

        about = tree.css_first("#js-aboutPlaylistTabView, .aboutInfo, .playlistViewTab")
        if about:
            owner = about.css_first("a[href*='/pornstar/'], a[href*='/model/'], a[href*='/channels/'], a[href*='/users/']")
            if owner:
                result["author"] = (owner.attributes.get("title") or owner.text(strip=True) or "").strip() or None
                o_href = owner.attributes.get("href") or ""
                if o_href:
                    result["authorUrl"] = http_url("https://www.pornhub.com", o_href)
            if result["reportedCount"] is None:
                m_cnt = re.search(r"(\d+)\s*videos?", about.text(separator=" ", strip=True), re.I)
                if m_cnt:
                    try:
                        result["reportedCount"] = int(m_cnt.group(1))
                    except ValueError:
                        pass

        v_node = tree.css_first("span.views, .views")
        if v_node and not result["views"]:
            result["views"] = v_node.text(strip=True)

    if is_xhamster_host(source_url):
        initials = _extract_xhamster_initials(html if isinstance(html, str) else getattr(tree, "html", ""))
        gp = initials.get("galleryPage", {})
        if gp:
            author_info = gp.get("infoProps", {}).get("authorInfoProps", {}) if isinstance(gp.get("infoProps"), dict) else {}
            created_date = author_info.get("createdDate")
            if created_date:
                try:
                    d_str = datetime.fromtimestamp(created_date, timezone.utc).strftime("%Y-%m-%d")
                    result["lastAddedDate"] = d_str
                    result["updatedAt"] = d_str
                    result["updatedAtRaw"] = d_str
                except Exception:
                    pass
            if author_info.get("authorName"):
                result["author"] = author_info["authorName"]
            if author_info.get("authorLink"):
                result["authorUrl"] = author_info["authorLink"]
            views_info = gp.get("infoProps", {}).get("viewsInfoProps", {}) if isinstance(gp.get("infoProps"), dict) else {}
            if views_info.get("views"):
                result["views"] = f"{views_info['views']:,}"
            if gp.get("photosCount") is not None:
                result["reportedCount"] = gp["photosCount"]

    selectors = ".pf-pl-meta li" if kind == "playlist" else ".gallery-info, .photo-info, .gallery-meta, .photo-details, .meta"
    nodes = tree.css(selectors)
    for node in nodes:
        text = re.sub(r"\s+", " ", node.text(separator=" ", strip=True))
        owner = node.css_first("a[href*='/profile/']")
        if owner is not None:
            result["author"] = owner.text(separator="", strip=True) or None
            result["authorUrl"] = urljoin(source_url, owner.attributes.get("href", "") or "")
        match = re.search(r"(?:Views|Visualizações)\s*:\s*([\d,. ]+)|([\d,.]+)\s+Views\b", text, re.I)
        if match:
            result["views"] = (match[1] or match[2]).strip()
        match = re.search(r"(?:Videos|Photos|Fotos|Vídeos)\s*:\s*([\d,]+)|([\d,]+)\s+(?:Photos|Fotos)\b", text, re.I)
        if match:
            result["reportedCount"] = int((match[1] or match[2]).replace(",", ""))
        match = re.search(r"(?:Last video added|Último vídeo adicionado)\s*:?\s*(.+)$", text, re.I)
        if match:
            result["lastAddedDate"] = match[1].strip()
        elif kind == "album":
            match = re.search(r"\b\d{4}-\d{2}-\d{2}\b", text)
            if match:
                result["lastAddedDate"] = match[0]
    if kind == "playlist" and not result["author"]:
        match = re.search(r"/profile/([^/]+)/playlist/", urlsplit(source_url).path)
        if match:
            result["author"] = match[1]
            result["authorUrl"] = urljoin(source_url, f"/profile/{match[1]}/")
    if not result["lastAddedDate"]:
        for node in nodes:
            time_node = node.css_first("time[datetime]")
            if time_node is not None and "datetime" in time_node.attributes:
                result["lastAddedDate"] = time_node.attributes.get("datetime")
                break
    if not result["lastAddedDate"]:
        for prop in ("dateModified", "datePublished", "uploadDate", "article:modified_time", "article:published_time"):
            tag = tree.css_first(f'meta[property="{prop}"], meta[itemprop="{prop}"], meta[name="{prop}"]')
            if tag is not None and tag.attributes.get("content"):
                result["lastAddedDate"] = tag.attributes["content"]
                break
    if not result["lastAddedDate"]:
        for script in tree.css('script[type="application/ld+json"]'):
            try:
                data = json.loads(script.text(separator=""))
            except (ValueError, TypeError):
                continue
            objects = data if isinstance(data, list) else [data]
            for obj in objects:
                if not isinstance(obj, dict):
                    continue
                graph = obj.get("@graph")
                for item in [obj] + (graph if isinstance(graph, list) else []):
                    if isinstance(item, dict) and item.get("@type") in (
                        "ImageGallery",
                        "CollectionPage",
                        "ImageObject",
                        "VideoObject",
                        "CreativeWork",
                        "Playlist",
                    ):
                        result["lastAddedDate"] = item.get("dateModified") or item.get("datePublished") or item.get("uploadDate")
                        if result["lastAddedDate"]:
                            break
    if not isinstance(result["lastAddedDate"], str):
        result["lastAddedDate"] = None
    result["updatedAtRaw"] = result["lastAddedDate"]
    result["updatedAt"] = result["lastAddedDate"] or ""
    return result


def _within_recommendations_lexbor(node) -> bool:
    curr = node
    while curr is not None:
        cls = curr.attributes.get("class") or ""
        ident = curr.attributes.get("id") or ""
        label = f"{cls} {ident}".lower()
        if "related" in label or "recommend" in label:
            return True
        curr = curr.parent
    return False


def parse_album_page_lexbor(html: str | LexborHTMLParser, final_url: str) -> dict:
    tree = html if isinstance(html, LexborHTMLParser) else LexborHTMLParser(html)
    photos = []
    seen = set()

    if is_youtube_host(final_url):
        data = _extract_yt_initial_data(html)
        if data:
            for post_holder in _iter_dicts_with_key(data, "backstagePostRenderer"):
                post = post_holder["backstagePostRenderer"]
                if not isinstance(post, dict):
                    continue
                content_text = _yt_text(post.get("contentText")).strip()
                first_line = next((ln.strip() for ln in content_text.splitlines() if ln.strip()), "")
                post_images = _extract_yt_post_images(post)
                for idx, (thumb_url, high_res, w, h) in enumerate(post_images):
                    if not thumb_url or thumb_url in seen:
                        continue
                    seen.add(thumb_url)
                    title = first_line[:90] if first_line else f"Community Photo {idx + 1}"
                    if len(post_images) > 1 and first_line:
                        title = f"{first_line[:80]} ({idx + 1}/{len(post_images)})"
                    photos.append({
                        "id": "photo-" + hashlib.sha256(thumb_url.encode()).hexdigest()[:16],
                        "title": title,
                        "thumbnailUrl": thumb_url,
                        "originalUrl": high_res or thumb_url,
                        "resolution": f"{w}x{h}" if w and h else "",
                        "timeAgo": "",
                        "type": "photo",
                        "format": "jpg",
                        "isAnimated": False,
                        "width": w,
                        "height": h,
                    })
                if photos:
                    break
        metadata = extract_collection_metadata_lexbor(tree, final_url, "album")
        if metadata["reportedCount"] is None and photos:
            metadata["reportedCount"] = len(photos)
        for photo in photos:
            photo.update(timeAgo=metadata["updatedAt"], metadataStatus=metadata["metadataStatus"])
        return {
            "success": True,
            "gallery_url": final_url,
            "count": len(photos),
            "photos": photos,
            "paginationComplete": metadata["reportedCount"] is not None and len(photos) == metadata["reportedCount"],
            **metadata,
        }

    if is_pornhub_host(final_url):
        _decompose_pornhub_sitewide(tree)
        if "/gifs" in urlsplit(final_url).path.lower() or tree.css_first("li.gifVideoBlock, li.gifListItem, li.gifLi") is not None:
            gifs_can, _ = extract_pornhub_gifs_lexbor(final_url, tree)
            if gifs_can:
                metadata = extract_collection_metadata_lexbor(tree, final_url, "album")
                metadata["reportedCount"] = max(metadata.get("reportedCount") or 0, len(gifs_can))
                return {
                    "success": True,
                    "gallery_url": final_url,
                    "count": len(gifs_can),
                    "photos": gifs_can,
                    "paginationComplete": True,
                    **metadata,
                }
        album_title = tree.css_first("h1")
        a_title = album_title.text(separator="", strip=True) if album_title is not None else "Album"
        for idx, li in enumerate(tree.css("li.photoAlbumListContainer, .photosWrapper li, ul#photosAlbumSection li")):
            bkg = li.css_first(".photoAlbumListBlock")
            img = li.css_first("img")
            a = li.css_first('a[href*="/photo/"]')
            thumb = (bkg.attributes.get("data-bkg") if bkg else "") or (
                (img.attributes.get("data-src") or img.attributes.get("src")) if img else ""
            )
            if not thumb or thumb in seen:
                continue
            seen.add(thumb)
            p_url = http_url("https://www.pornhub.com", a.attributes.get("href") if a else "") or final_url
            m_pid = re.search(r"/photo/(\d+)", p_url)
            pid = m_pid.group(1) if m_pid else str(idx + 1)
            photos.append({
                "id": f"photo-ph_{pid}",
                "title": f"{a_title} #{idx + 1}",
                "thumbnailUrl": thumb,
                "originalUrl": thumb,
                "pageUrl": p_url,
                "sourcePage": final_url,
                "resolution": "auto",
                "timeAgo": "",
                "type": "photo",
                "format": "jpg",
                "isAnimated": False,
                "isResolvedOriginal": False,
                "width": 0,
                "height": 0,
            })
        metadata = extract_collection_metadata_lexbor(tree, final_url, "album")
        for photo in photos:
            photo.update(timeAgo=metadata["updatedAt"], metadataStatus=metadata["metadataStatus"])
        return {
            "success": True,
            "gallery_url": final_url,
            "count": len(photos),
            "photos": photos,
            "paginationComplete": True,
            **metadata,
        }

    if is_xhamster_host(final_url):
        initials = _extract_xhamster_initials(html if isinstance(html, str) else getattr(tree, "html", ""))
        path_lower = urlsplit(final_url).path.lower()
        if "/shorts" in path_lower:
            shorts_can, _ = extract_xhamster_shorts_lexbor(final_url, tree)
            p_name = ""
            p_views = ""
            if "infoComponent" in initials and "pornstarTop" in initials["infoComponent"]:
                pt = initials["infoComponent"]["pornstarTop"]
                p_name = pt.get("name") or ""
                p_views = f"{pt.get('viewsCount'):,}" if pt.get("viewsCount") else ""
            elif "channelInfo" in initials:
                p_name = initials["channelInfo"].get("slug", "").replace("-", " ").title()
            if not p_name:
                h1 = tree.css_first("h1")
                p_name = h1.text(strip=True) if h1 else "Shorts"

            author_url = normalize_xhamster_profile_base_url(final_url)
            photos = []
            for it in shorts_can:
                photos.append({
                    **it,
                    "type": "gif",
                    "thumbnailUrl": it.get("thumbnailUrl"),
                    "originalUrl": it.get("originalUrl"),
                    "isResolvedOriginal": True,
                    "metadataStatus": "fetched",
                })
            today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            return {
                "success": True,
                "gallery_url": final_url,
                "count": len(photos),
                "photos": photos,
                "paginationComplete": True,
                "reportedCount": len(photos),
                "metadataStatus": "fetched",
                "author": p_name,
                "authorUrl": author_url,
                "views": p_views or None,
                "updatedAt": today_str,
                "lastAddedDate": today_str,
                "updatedAtRaw": today_str,
            }

        gp = initials.get("galleryPage", {})
        photo_items = gp.get("photoItems", [])
        album_title = tree.css_first("h1")
        a_title = album_title.text(separator="", strip=True) if album_title is not None else "Album"

        author_info = gp.get("infoProps", {}).get("authorInfoProps", {}) if isinstance(gp.get("infoProps"), dict) else {}
        created_date = author_info.get("createdDate")
        date_str = ""
        if created_date:
            try:
                date_str = datetime.fromtimestamp(created_date, timezone.utc).strftime("%Y-%m-%d")
            except Exception:
                pass

        for idx, it in enumerate(photo_items):
            pid = str(it.get("id") or (idx + 1))
            master_url = it.get("imgSrc") or it.get("imgSrcset")
            thumb_url = it.get("imgSrcset") or master_url
            if not master_url or master_url in seen:
                continue
            seen.add(master_url)
            p_link = it.get("link") or final_url
            w = it.get("originWidth") or 0
            h = it.get("originHeight") or 0
            res_str = f"{w}x{h}" if w and h else "auto"
            alt = it.get("alt") or f"{a_title} #{idx + 1}"
            photos.append({
                "id": f"photo-xh_{pid}",
                "title": alt,
                "thumbnailUrl": thumb_url,
                "originalUrl": master_url,
                "pageUrl": p_link,
                "sourcePage": final_url,
                "resolution": res_str,
                "uploadedAt": date_str,
                "timeAgo": date_str,
                "type": "photo",
                "format": "jpg",
                "isAnimated": False,
                "isResolvedOriginal": True,
                "width": w,
                "height": h,
                "metadataStatus": "fetched" if date_str else "pending",
            })
        metadata = extract_collection_metadata_lexbor(tree, final_url, "album")
        if date_str:
            metadata["updatedAt"] = date_str
            metadata["metadataStatus"] = "fetched"
            metadata["lastAddedDate"] = date_str
            metadata["updatedAtRaw"] = date_str
        if author_info.get("authorName"):
            metadata["author"] = author_info["authorName"]
        if author_info.get("authorLink"):
            metadata["authorUrl"] = author_info["authorLink"]
        views_info = gp.get("infoProps", {}).get("viewsInfoProps", {}) if isinstance(gp.get("infoProps"), dict) else {}
        views_count = views_info.get("views")
        if views_count:
            metadata["views"] = f"{views_count:,}"
        for photo in photos:
            photo.update(timeAgo=metadata["updatedAt"], metadataStatus=metadata["metadataStatus"])

        pag_props = gp.get("paginationProps", {}) if isinstance(gp.get("paginationProps"), dict) else {}
        last_page = pag_props.get("lastPageNumber", 1)
        cur_page = pag_props.get("currentPageNumber", 1)
        is_complete = cur_page >= last_page

        return {
            "success": True,
            "gallery_url": final_url,
            "count": len(photos),
            "photos": photos,
            "paginationComplete": is_complete,
            **metadata,
        }

    # Dedicated fast path for PornPics galleries
    if "pornpics.com" in final_url.lower() or tree.css_first("ul#tiles, a.rel-link") is not None:
        h1 = tree.css_first("h1")
        gallery_title = h1.text(separator="", strip=True) if h1 is not None else "PornPics Gallery"
        for idx, a in enumerate(tree.css("ul#tiles a.rel-link, a.rel-link")):
            href = http_url(final_url, a.attributes.get("href") or "")
            img = a.css_first("img")
            thumb = (img.attributes.get("data-src") or img.attributes.get("src")) if img else ""
            thumb_url = http_url(final_url, thumb) or href
            high_res = href or (thumb_url.replace("/460/", "/1280/") if "/460/" in thumb_url else thumb_url)
            if not high_res or high_res in seen or "base64" in high_res:
                continue
            seen.add(high_res)
            seen.add(thumb_url)
            alt = (img.attributes.get("alt") if img else "") or a.attributes.get("title") or f"{gallery_title} #{len(photos) + 1}"
            photos.append({
                "id": "photo-" + hashlib.sha256(high_res.encode()).hexdigest()[:16],
                "title": alt,
                "thumbnailUrl": thumb_url,
                "originalUrl": high_res,
                "pageUrl": final_url,
                "sourcePage": final_url,
                "resolution": "1280xauto" if "/1280/" in high_res else "auto",
                "timeAgo": "",
                "type": "photo",
                "format": "jpg",
                "isAnimated": False,
                "isResolvedOriginal": True,
                "width": 1280 if "/1280/" in high_res else 0,
                "height": 0,
            })
        if photos:
            metadata = extract_collection_metadata_lexbor(tree, final_url, "album")
            metadata["reportedCount"] = max(metadata.get("reportedCount") or 0, len(photos))
            for p in photos:
                p.update(timeAgo=metadata["updatedAt"], metadataStatus=metadata["metadataStatus"])
            return {
                "success": True,
                "gallery_url": final_url,
                "count": len(photos),
                "photos": photos,
                "paginationComplete": True,
                **metadata,
            }

    # Dedicated fast path for Forum and Image Board threads (e.g. ViperGirls)
    forum_posts = tree.css("div.postbody, blockquote.postcontent, div.post_message, div.content")
    if forum_posts:
        h1 = tree.css_first("h1, span.threadtitle, title")
        thread_title = h1.text(separator="", strip=True) if h1 is not None else "Gallery"
        for post in forum_posts:
            for a in post.css("a"):
                img = a.css_first("img")
                if not img:
                    continue
                href = http_url(final_url, a.attributes.get("href") or "")
                thumb = http_url(final_url, img.attributes.get("src") or img.attributes.get("data-src") or "")
                if not thumb or thumb in seen or any(k in thumb.lower() for k in ("logo", "icon", "banner", "avatar", "advert", "button", "sprite", "rating")):
                    continue
                high_res = thumb.replace("/u/t/", "/u/i/") if "/u/t/" in thumb else (href if (href and re.search(r"\.(?:jpe?g|png|webp|avif|gif)(?:\?|$)", href, re.I)) else thumb)
                seen.add(thumb)
                seen.add(high_res)
                photos.append({
                    "id": "photo-" + hashlib.sha256(high_res.encode()).hexdigest()[:16],
                    "title": f"{thread_title} #{len(photos) + 1}",
                    "thumbnailUrl": thumb,
                    "originalUrl": high_res,
                    "pageUrl": href or final_url,
                    "sourcePage": final_url,
                    "resolution": "auto",
                    "timeAgo": "",
                    "type": "photo",
                    "format": "jpg",
                    "isAnimated": False,
                    "isResolvedOriginal": True if "/u/i/" in high_res else False,
                    "width": 0,
                    "height": 0,
                })
        if photos:
            metadata = extract_collection_metadata_lexbor(tree, final_url, "album")
            metadata["reportedCount"] = max(metadata.get("reportedCount") or 0, len(photos))
            for p in photos:
                p.update(timeAgo=metadata["updatedAt"], metadataStatus=metadata["metadataStatus"])
            return {
                "success": True,
                "gallery_url": final_url,
                "count": len(photos),
                "photos": photos,
                "paginationComplete": True,
                **metadata,
            }

    grids = [
        node
        for node in tree.css(".photosgrid.gallerygrid, .gallery-layout .photosgrid, ul#tiles, .gallery-photos, .album-photos, .gallery_media, div.gallery")
        if "relatedphotosgrid" not in (node.attributes.get("class") or "").split()
    ]
    if not grids:
        grids = [
            node
            for node in tree.css(".photosgrid, .photo-content, div.gallery-items, div.gallery, ul.thumbs, div.thumbnails")
            if "relatedphotosgrid" not in (node.attributes.get("class") or "").split()
        ]
    if not grids:
        grids = [
            node
            for node in tree.css("div[class*='gallery'], div[id*='gallery'], div[class*='album'], div[id*='album'], .photos, .images, .image-list, #photos, #images, article, main, div#content, div.content")
            if "related" not in (node.attributes.get("class") or "").lower() and "sidebar" not in (node.attributes.get("class") or "").lower()
        ]
    images = [img for grid in grids for img in grid.css("img")] if grids else tree.css("img")
    for img in images:
        if img is None:
            continue
        src = image_url(final_url, img.attributes) or ""
        src_url = http_url(final_url, src)
        if not src_url or src_url in seen or "base64" in src_url:
            continue
        if any(k in src_url.lower() for k in ("logo", "icon", "banner", "avatar", "advert", "button", "sprite", "rating", "pixel")):
            continue
        seen.add(src_url)

        anchor = None
        curr = img.parent
        while curr is not None:
            if curr.tag == "a" and curr.attributes.get("href"):
                anchor = curr
                break
            curr = curr.parent

        linked = http_url(final_url, anchor.attributes.get("href")) if anchor is not None else None
        is_direct_img = bool(linked and re.search(r"\.(?:jpe?g|png|webp|avif|gif)(?:\?|$)", linked, re.I))
        
        # High-res inference from common CDN thumbnail conventions
        if is_direct_img:
            high_res = linked
        elif "/460/" in src_url and "pornpics.com" in src_url:
            high_res = src_url.replace("/460/", "/1280/")
            is_direct_img = True
        elif "/u/t/" in src_url:
            high_res = src_url.replace("/u/t/", "/u/i/")
            is_direct_img = True
        elif re.search(r'_\d+x\d+\.(?:jpe?g|png|webp|gif)', src_url, re.I):
            high_res = re.sub(r'_\d+x\d+\.(jpe?g|png|webp|gif)(\?.*)?$', r'.\1\2', src_url, flags=re.I)
            is_direct_img = True
        else:
            high_res = src_url

        alt = img.attributes.get("alt") or ""
        title = alt if alt and len(alt) > 2 else ""
        path_lower = urlsplit(high_res).path.lower()

        photos.append({
            "id": "photo-" + hashlib.sha256(src_url.encode()).hexdigest()[:16],
            "title": title,
            "thumbnailUrl": src_url,
            "originalUrl": high_res,
            "pageUrl": linked if (linked and not is_direct_img) else "",
            "sourcePage": final_url,
            "resolution": "1280xauto" if "/1280/" in high_res else "",
            "timeAgo": "",
            "type": "gif" if path_lower.endswith(".gif") else "photo",
            "format": path_lower.rsplit(".", 1)[-1] if "." in path_lower else "",
            "isAnimated": path_lower.endswith(".gif"),
            "isResolvedOriginal": is_direct_img,
            "width": 1280 if "/1280/" in high_res else 0,
            "height": 0,
        })

    metadata = extract_collection_metadata_lexbor(tree, final_url, "album")
    for photo in photos:
        photo.update(timeAgo=metadata["updatedAt"], metadataStatus=metadata["metadataStatus"])
    return {
        "success": True,
        "gallery_url": final_url,
        "count": len(photos),
        "photos": photos,
        "paginationComplete": metadata["reportedCount"] is not None and len(photos) == metadata["reportedCount"],
        **metadata,
    }


def parse_playlist_page_lexbor(html: str | LexborHTMLParser, final_url: str) -> dict:
    tree = html if isinstance(html, LexborHTMLParser) else LexborHTMLParser(html)
    videos = []
    seen = set()

    metadata = extract_collection_metadata_lexbor(tree, final_url, "playlist")

    if is_youtube_host(final_url):
        yt_videos, _ = extract_youtube_videos_lexbor(final_url, html)
        for v in yt_videos:
            orig_url = v.get("originalUrl")
            if not orig_url or orig_url in seen:
                continue
            seen.add(orig_url)
            videos.append(v)
        data = _extract_yt_initial_data(html)
        has_continuation = bool(data and next(_iter_dicts_with_key(data, "continuationItemRenderer"), None))
        if metadata["reportedCount"] is None and videos and not has_continuation:
            metadata["reportedCount"] = len(videos)
        return {
            "success": True,
            "playlist_url": final_url,
            "count": len(videos),
            "videos": videos,
            "paginationComplete": metadata["reportedCount"] is not None and len(videos) == metadata["reportedCount"],
            **metadata,
        }

    if is_pornhub_host(final_url):
        ph_videos, _ = extract_pornhub_videos_lexbor(final_url, tree)
        for v in ph_videos:
            orig_url = v.get("originalUrl")
            if not orig_url or orig_url in seen:
                continue
            seen.add(orig_url)
            videos.append(v)
        if metadata.get("reportedCount") is None and videos:
            metadata["reportedCount"] = len(videos)
        pl_title = metadata.get("title")
        if not pl_title:
            h1 = tree.css_first("h1.playlistTitle, #watchPlaylist, h1")
            if h1:
                t = h1.text(strip=True)
                if t and t.lower() not in ("view playlist", "play all", "play"):
                    pl_title = t
        return {
            "success": True,
            "playlist_url": final_url,
            "title": pl_title,
            "count": len(videos),
            "videos": videos,
            "paginationComplete": True,
            **metadata,
        }

    for mb in tree.css("div.mb"):
        if _within_recommendations_lexbor(mb):
            continue
        a_link = mb.css_first(".mbcontent a")
        img = mb.css_first(".mbcontent img")
        tit_a = mb.css_first(".mbtit a")
        dur_sp = mb.css_first(".mbtim")
        hd_sp = mb.css_first(".mvhdico span")
        vie_sp = mb.css_first(".mbvie")

        if a_link is not None and img is not None:
            v_url = http_url(final_url, a_link.attributes.get("href", "") or "")
            if not v_url or v_url in seen:
                continue
            seen.add(v_url)

            v_id_match = re.search(r"video-([a-zA-Z0-9]+)", v_url)
            v_id = v_id_match.group(1) if v_id_match else f"pl_vid_{len(videos)+1}"
            v_title = tit_a.text(separator="", strip=True) if tit_a is not None else (img.attributes.get("alt") or "")
            v_thumb = image_url(final_url, img.attributes)
            v_dur = dur_sp.text(separator="", strip=True) if dur_sp is not None else ""
            v_res = hd_sp.text(separator="", strip=True) if hd_sp is not None else ""
            v_views = vie_sp.text(separator="", strip=True) if vie_sp is not None else ""

            videos.append({
                "id": f"v-{v_id}",
                "title": v_title,
                "subtitle": v_views if v_views else v_res,
                "thumbnailUrl": v_thumb,
                "duration": v_dur,
                "resolution": v_res,
                "timeAgo": "",
                "type": "video",
                "originalUrl": v_url,
                "streamUrl": f"/api/proxy-video-stream?url={v_url}",
            })

    return {
        "success": True,
        "playlist_url": final_url,
        "count": len(videos),
        "videos": videos,
        "paginationComplete": metadata["reportedCount"] is not None and len(videos) == metadata["reportedCount"],
        **metadata,
    }


def worker_execute(task: tuple):
    """Top-level picklable entrypoint executed inside persistent worker processes."""
    op = task[0]
    if op == "eporner_root":
        return extract_eporner_root_lexbor(task[1], task[2])
    if op == "eporner_videos":
        return extract_eporner_videos_lexbor(task[1], task[2])
    if op == "eporner_albums":
        return extract_eporner_albums_lexbor(task[1], task[2])
    if op == "eporner_playlists":
        return extract_eporner_playlists_lexbor(task[1], task[2], task[3], task[4])
    if op == "youtube_root":
        return extract_youtube_root_lexbor(task[1], task[2])
    if op == "youtube_videos":
        return extract_youtube_videos_lexbor(task[1], task[2])
    if op == "youtube_albums":
        return extract_youtube_albums_lexbor(task[1], task[2])
    if op == "youtube_playlists":
        return extract_youtube_playlists_lexbor(task[1], task[2], task[3], task[4])
    if op == "pornhub_root":
        return extract_pornhub_root_lexbor(task[1], task[2])
    if op == "pornhub_videos":
        return extract_pornhub_videos_lexbor(task[1], task[2])
    if op == "pornhub_albums":
        return extract_pornhub_albums_lexbor(task[1], task[2])
    if op == "pornhub_playlists":
        return extract_pornhub_playlists_lexbor(task[1], task[2], task[3] if len(task) > 3 else "")
    if op == "pornhub_gifs":
        return extract_pornhub_gifs_lexbor(task[1], task[2])
    if op == "xhamster_videos":
        return extract_xhamster_videos_lexbor(task[1], task[2])
    if op == "xhamster_albums":
        return extract_xhamster_albums_lexbor(task[1], task[2])
    if op == "xhamster_shorts":
        return extract_xhamster_shorts_lexbor(task[1], task[2])
    if op == "metadata":
        _, url, final_url, kind, html = task
        meta = (
            extract_video_metadata_lexbor(html)
            if kind == "video"
            else extract_collection_metadata_lexbor(html, final_url, kind)
        )
        return {**meta, "url": url, "kind": kind}
    if op == "album_page":
        return parse_album_page_lexbor(task[1], task[2])
    if op == "playlist_page":
        return parse_playlist_page_lexbor(task[1], task[2])
    raise ValueError(f"Unsupported worker operation: {op}")


def _noop_warmup(x: int) -> int:
    return x


def get_worker_pool() -> ProcessPoolExecutor:
    """Return the shared persistent worker pool, creating or recovering it lazily."""
    global _worker_pool
    with _pool_lock:
        if _worker_pool is None:
            ctx = multiprocessing.get_context("spawn")
            _worker_pool = ProcessPoolExecutor(max_workers=DEFAULT_MAX_WORKERS, mp_context=ctx)
        return _worker_pool


def warm_worker_pool():
    """Trigger background worker process spawning without blocking the caller."""
    try:
        pool = get_worker_pool()
        for i in range(DEFAULT_MAX_WORKERS):
            pool.submit(_noop_warmup, i)
    except Exception:
        pass


def shutdown_worker_pool():
    global _worker_pool
    with _pool_lock:
        pool, _worker_pool = _worker_pool, None
    if pool is not None:
        try:
            pool.shutdown(wait=False, cancel_futures=True)
        except Exception:
            pass


atexit.register(shutdown_worker_pool)


async def run_in_worker_pool(task: tuple, html_size: int = 0):
    """Execute extraction task in the persistent multiprocess pool when worthwhile,
    or directly in-process via native Lexbor for tiny payloads.
    """
    if html_size < WORKER_OFFLOAD_MIN_BYTES:
        return worker_execute(task)
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return worker_execute(task)
    try:
        pool = get_worker_pool()
        return await loop.run_in_executor(pool, worker_execute, task)
    except (BrokenProcessPool, RuntimeError, OSError):
        shutdown_worker_pool()
        return worker_execute(task)
