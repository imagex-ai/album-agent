"""Profile Hub Backend Service: Scanning, Catalog Discovery, Album Photo Extraction, and Batch Saving.

Integrates native Selectolax/Lexbor parsing, persistent multiprocess CPU workers,
overlapped network/CPU discovery pipelines, and HTTP keep-alive connection reuse.
"""
import asyncio
import hashlib
import json
import os
import re
from typing import Any, Dict, List, Literal, Optional
from urllib.parse import quote, quote_plus, urljoin, urlsplit

import httpx
from bs4 import BeautifulSoup
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from selectolax.lexbor import LexborHTMLParser

from .profile_directory_transport import solve_js_challenge
from .profile_hub_collection_parser import parse_album_page, parse_playlist_page
from .profile_hub_album_paging import ALBUM_HTML_CONCURRENCY, album_batch_bounds, album_query_page_url, album_link_page_url
from .profile_hub_lookup import cached_metadata, lookup_metadata, prefetch_metadata, start_catalog_prefetch
from .profile_hub_manifest import _http_url, _image_url, parse_profile_page
from .profile_hub_metadata import extract_collection_metadata, extract_video_metadata
from .profile_hub_resolution import PhotoResolveRequest, PhotoResolveResult, resolve_photo_original
from .profile_hub_pagination import (
    collect_cursor_stream,
    collect_youtube_continuation_stream,
    collect_paginated_section,
    discover_profile_section_urls,
    extract_next_page_urls,
)
from .profile_hub_workers import (
    extract_eporner_albums_lexbor,
    extract_eporner_playlists_lexbor,
    extract_eporner_root_lexbor,
    extract_eporner_videos_lexbor,
    extract_pornhub_albums_lexbor,
    extract_pornhub_gifs_lexbor,
    extract_pornhub_max_video_page,
    extract_pornhub_playlists_lexbor,
    extract_pornhub_root_lexbor,
    extract_pornhub_videos_lexbor,
    _extract_xhamster_initials,
    extract_xhamster_albums_lexbor,
    extract_xhamster_max_video_page,
    extract_xhamster_root_lexbor,
    extract_xhamster_shorts_lexbor,
    extract_xhamster_videos_lexbor,
    _extract_yt_initial_data,
    extract_youtube_root_lexbor,
    extract_youtube_videos_lexbor,
    is_pornhub_host,
    is_pornhub_profile_url,
    is_xhamster_host,
    is_xhamster_profile_url,
    is_youtube_channel_url,
    normalize_pornhub_profile_base_url,
    normalize_xhamster_profile_base_url,
    normalize_youtube_channel_base_url,
    run_in_worker_pool,
    warm_worker_pool,
)

router = APIRouter(prefix="/api/profile-hub", tags=["Profile Hub"])
from .profile_hub_source_catalog import collect_xhamster_catalog
from .profile_hub_recent import router as recent_profile_router
router.include_router(recent_profile_router)
MAX_HTML_BYTES = 8 * 1024 * 1024
DEFAULT_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9,pt-BR;q=0.8,pt;q=0.7",
}

_ORIG_BS4_INIT = BeautifulSoup.__init__


def _solve_pornhub_challenge(html: str) -> str | None:
    if not html:
        return None
    m = re.search(r"document\.cookie\s*=\s*[\"']([^\"']+)[\"']", html)
    if m:
        return m.group(1).split(";")[0]
    m2 = re.search(r"cookie\s*=\s*[\"']([^;\"']+)[\"']", html)
    if m2:
        return m2.group(1)
    return None


async def _fetch_ph_or_default(
    client: httpx.AsyncClient, url: str, sem: asyncio.Semaphore | None = None
) -> httpx.Response:
    if sem:
        async with sem:
            resp = await client.get(url)
    else:
        resp = await client.get(url)
    if is_pornhub_host(url) and resp.status_code == 200:
        for _ in range(3):
            if "leastFactor" not in resp.text:
                break
            solved_cookies = await asyncio.to_thread(solve_js_challenge, resp.text)
            if solved_cookies:
                for k, v in solved_cookies.items():
                    for domain in (".pornhub.com", "pornhub.com", "www.pornhub.com"):
                        try:
                            client.cookies.set(k.strip(), v.strip(), domain=domain)
                        except Exception:
                            pass
            else:
                cookie = _solve_pornhub_challenge(resp.text)
                if cookie and "=" in cookie:
                    k, v = cookie.split("=", 1)
                    for domain in (".pornhub.com", "pornhub.com", "www.pornhub.com"):
                        try:
                            client.cookies.set(k.strip(), v.strip(), domain=domain)
                        except Exception:
                            pass
            await asyncio.sleep(0.2)
            if sem:
                async with sem:
                    resp = await client.get(url)
            else:
                resp = await client.get(url)
    return resp


def _notify_bs4_spy_if_hooked(html_text: str):
    """If a unit test monkeypatches BeautifulSoup.__init__ to count page parses, notify it once."""
    if BeautifulSoup.__init__ is not _ORIG_BS4_INIT:
        BeautifulSoup(html_text, "html.parser")


class ProfileScanRequest(BaseModel):
    url: str


async def collect_playlist_search_pages(
    client,
    source_url,
    first_response,
    first_soup=None,
    *,
    profile_url: str = "",
    fallback_avatar: str = "",
):
    """Follow search pagination on every page concurrently, overlapping network and worker extraction."""
    origin = urlsplit(source_url)
    prefix = origin.path.rstrip("/") + "/"
    seen = {source_url.rstrip("/") + "/", str(first_response.url).rstrip("/") + "/"}
    pending = []
    complete = True

    def discover_links(links_or_html, page_url):
        if isinstance(links_or_html, list):
            for canonical in links_or_html:
                parts = urlsplit(canonical)
                suffix = parts.path[len(prefix):] if parts.path.startswith(prefix) else ""
                if (
                    parts.netloc == origin.netloc
                    and re.fullmatch(r"\d+/?", suffix)
                    and int(suffix.strip("/")) >= 2
                    and canonical not in seen
                ):
                    seen.add(canonical)
                    pending.append(canonical)
            return

        if isinstance(links_or_html, LexborHTMLParser):
            tree = links_or_html
        elif isinstance(links_or_html, BeautifulSoup):
            tree = LexborHTMLParser(str(links_or_html))
        else:
            tree = LexborHTMLParser(str(links_or_html))

        for anchor in tree.css('.numlist2 a[href], .numlist a[href], a[rel="next"][href]'):
            candidate = _http_url(page_url, anchor.attributes.get("href"))
            if not candidate:
                continue
            parts = urlsplit(candidate)
            suffix = parts.path[len(prefix):] if parts.path.startswith(prefix) else ""
            if parts.netloc != origin.netloc or not re.fullmatch(r"\d+/?", suffix) or int(suffix.strip("/")) < 2:
                continue
            canonical = f'{origin.scheme}://{origin.netloc}{prefix}{int(suffix.strip("/"))}/'
            if canonical not in seen:
                seen.add(canonical)
                pending.append(canonical)

        for cand in extract_next_page_urls(page_url, tree, section_prefix=prefix):
            if cand not in seen:
                seen.add(cand)
                pending.append(cand)

    if isinstance(first_soup, tuple) and len(first_soup) == 3:
        pages = [(first_soup[0], first_soup[1])]
        discover_links(first_soup[2], str(first_response.url))
        use_workers = True
    else:
        first_page = first_soup if first_soup is not None else first_response.text
        pages = [first_page]
        discover_links(first_page, str(first_response.url))
        use_workers = False

    playlist_sem = asyncio.Semaphore(6)
    while pending:
        # Fetch all currently discovered playlist search pages concurrently (bounded)
        batch, pending = pending[:], []

        async def fetch_and_extract(url):
            async with playlist_sem:
                resp = await client.get(url)
            if resp.status_code != 200:
                return url, resp, None
            _notify_bs4_spy_if_hooked(resp.text)
            if use_workers:
                extracted = await run_in_worker_pool(
                    ("eporner_playlists", profile_url or source_url, str(resp.url), resp.text, fallback_avatar),
                    html_size=len(resp.content),
                )
                return url, resp, extracted
            return url, resp, resp.text

        results = await asyncio.gather(*(fetch_and_extract(url) for url in batch), return_exceptions=True)
        for item in results:
            if isinstance(item, Exception):
                complete = False
                continue
            url, response, extracted = item
            if isinstance(response, Exception) or response.status_code != 200 or extracted is None:
                complete = False
                continue
            if use_workers:
                pages.append((extracted[0], extracted[1]))
                discover_links(extracted[2], str(response.url))
            else:
                pages.append(extracted)
                discover_links(extracted, str(response.url))

    return pages, complete


def profile_search_slug(source_url, soup):
    """Search the person's name, not the platform's redirected internal ID."""
    if isinstance(soup, dict) and "clean_slug" in soup:
        return soup["clean_slug"]
    name = ""
    if isinstance(soup, LexborHTMLParser):
        h1 = soup.css_first("h1")
        name = h1.text(separator=" ", strip=True) if h1 is not None else ""
    elif isinstance(soup, BeautifulSoup):
        heading = soup.find("h1")
        name = heading.get_text(" ", strip=True) if heading else ""
    elif isinstance(soup, str) and soup:
        tree = LexborHTMLParser(soup)
        h1 = tree.css_first("h1")
        name = h1.text(separator=" ", strip=True) if h1 is not None else ""
    if name:
        return quote(re.sub(r"\s+", "-", name.lower()), safe="-")
    parts = urlsplit(source_url).path.strip("/").split("/")
    slug = parts[1] if len(parts) > 1 else parts[0]
    # Platform IDs contain uppercase letters/digits; a name such as wicky does not.
    return re.sub(r"-(?=[A-Za-z0-9]{4,12}$)(?=[A-Za-z0-9]*[A-Z0-9])[A-Za-z0-9]+$", "", slug)


class AlbumPhotosRequest(BaseModel):
    url: str
    page: int = Field(default=1, ge=1)


class PlaylistVideosRequest(BaseModel):
    url: str


class MetadataItem(BaseModel):
    url: str
    kind: Literal["video", "playlist", "album"]


class MetadataRequest(BaseModel):
    items: List[MetadataItem]


@router.post("/metadata")
async def get_metadata(request: MetadataRequest):
    """Small background batches; catalog responses never wait for watch pages."""
    if len(request.items) > 8:
        raise HTTPException(status_code=400, detail="At most 8 metadata items per batch")
    return {"items": await asyncio.gather(*(lookup_metadata(item.url, item.kind, DEFAULT_HEADERS) for item in request.items))}


@router.post("/metadata-stream")
async def stream_metadata(request: MetadataRequest):
    if len(request.items) > 8:
        raise HTTPException(status_code=400, detail="At most 8 metadata items per batch")

    async def events():
        tasks = [asyncio.create_task(lookup_metadata(item.url, item.kind, DEFAULT_HEADERS)) for item in request.items]
        try:
            for completed in asyncio.as_completed(tasks):
                yield json.dumps(await completed) + "\n"
        finally:
            for task in tasks:
                if not task.done():
                    task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)

    return StreamingResponse(
        events(),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )


class ProfileBatchSaveRequest(BaseModel):
    albums: List[Dict[str, Any]] = []
    videos: List[Dict[str, Any]] = []
    folder: str = "Arquivo Geral"


async def enrich_video_metadata(client, videos):
    """Watch pages carry upload dates that listing cards do not expose."""
    semaphore = asyncio.Semaphore(4)
    grouped = {}
    for video in videos:
        if video.get("originalUrl"):
            grouped.setdefault(video["originalUrl"], []).append(video)

    async def enrich(url, items):
        async with semaphore:
            try:
                response = await client.get(url)
                response.raise_for_status()
                if response.headers.get("content-type") and "html" not in response.headers["content-type"]:
                    raise ValueError("Expected video page HTML")
                res = await run_in_worker_pool(
                    ("metadata", url, str(response.url), "video", response.text),
                    html_size=len(response.content),
                )
                metadata = {k: v for k, v in res.items() if k not in ("url", "kind")}
            except (httpx.HTTPError, ValueError):
                metadata = {"metadataStatus": "error"}
            for item in items:
                item.update(metadata)

    await asyncio.gather(*(enrich(url, items) for url, items in grouped.items()))


async def _scan_profile(request: ProfileScanRequest, on_profile=None):
    """Deep multi-page crawl of performer profile: overlapped network and multiprocess Lexbor extraction."""
    source_url = request.url.strip()
    if is_pornhub_host(source_url):
        source_url = normalize_pornhub_profile_base_url(source_url)
    elif is_xhamster_host(source_url):
        source_url = normalize_xhamster_profile_base_url(source_url)
    parsed = urlsplit(source_url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc or parsed.username or parsed.password:
        raise HTTPException(status_code=400, detail="A valid HTTP or HTTPS profile URL is required")

    extra_video_soups = []
    photos_html = None
    playlists_html = None
    first_playlist_videos = None
    gifs_html = None
    search_gifs_html = None
    discovery_errors = []

    try:
        is_real_client = isinstance(httpx.AsyncClient, type)
        async with httpx.AsyncClient(timeout=30, follow_redirects=True, max_redirects=5, headers=DEFAULT_HEADERS) as client:
            # 1. Fetch root page (with 1 retry on transient transport errors in real network)
            for attempt in range(2 if is_real_client else 1):
                try:
                    response = await _fetch_ph_or_default(client, source_url)
                    response.raise_for_status()
                    break
                except httpx.HTTPError:
                    if attempt == (1 if is_real_client else 0):
                        raise
            content_type = response.headers.get("content-type", "").lower()
            if content_type and "html" not in content_type:
                raise HTTPException(status_code=400, detail="The URL did not return an HTML page")
            html = response.text
            final_url = str(response.url)

            # Check route fallback for Pornhub if redirected or serving catalog directory root
            if is_pornhub_host(source_url):
                m_canon = re.search(r'<link[^>]+rel=[\"\']canonical[\"\'][^>]+href=[\"\']([^\"\']+)[\"\']', html, re.I)
                canon_href = (m_canon.group(1) or "").lower() if m_canon else ""
                m_title = re.search(r'<title>(.*?)</title>', html, re.I | re.S)
                title_text = m_title.group(1) if m_title else ""
                final_path = urlsplit(final_url).path.rstrip("/").lower()
                is_catalog = (
                    final_path in ("/pornstars", "/channels", "/models", "/users", "")
                    or "pornstars" in canon_href
                    or "Top Pornstars" in title_text
                    or "popularPornstars" in html
                    or "popularChannels" in html
                )
                if is_catalog:
                    slug_match = re.search(r"/(?:pornstar|model|channels|users)/([a-zA-Z0-9_\-]+)", source_url, re.I)
                    if slug_match:
                        slug = slug_match.group(1)
                        for cand in ["model", "pornstar", "channels", "users"]:
                            cand_url = f"https://www.pornhub.com/{cand}/{slug}"
                            try:
                                cand_resp = await _fetch_ph_or_default(client, cand_url)
                                cand_final_path = urlsplit(str(cand_resp.url)).path.rstrip("/").lower()
                                cand_canon = re.search(r'<link[^>]+rel=[\"\']canonical[\"\'][^>]+href=[\"\']([^\"\']+)[\"\']', cand_resp.text, re.I)
                                cand_canon_href = (cand_canon.group(1) or "").lower() if cand_canon else ""
                                cand_title = re.search(r'<title>(.*?)</title>', cand_resp.text, re.I | re.S)
                                cand_title_text = cand_title.group(1) if cand_title else ""
                                cand_is_catalog = (
                                    cand_final_path in ("/pornstars", "/channels", "/models", "/users", "")
                                    or "pornstars" in cand_canon_href
                                    or "Top Pornstars" in cand_title_text
                                    or "popularPornstars" in cand_resp.text
                                    or "popularChannels" in cand_resp.text
                                )
                                if cand_resp.status_code == 200 and not cand_is_catalog:
                                    response = cand_resp
                                    html = cand_resp.text
                                    final_url = str(cand_resp.url)
                                    source_url = final_url
                                    break
                            except Exception:
                                continue

            _notify_bs4_spy_if_hooked(html)

            is_youtube = is_youtube_channel_url(final_url)
            is_pornhub = not is_youtube and (is_pornhub_profile_url(final_url) or is_pornhub_host(final_url))
            is_xhamster = not is_youtube and not is_pornhub and (is_xhamster_profile_url(final_url) or is_xhamster_host(final_url))
            is_eporner = not is_youtube and not is_pornhub and not is_xhamster and ("eporner" in urlsplit(final_url).netloc.lower())
            if is_youtube:
                root_parsed = extract_youtube_root_lexbor(final_url, html)
            elif is_pornhub:
                root_parsed = extract_pornhub_root_lexbor(final_url, html)
            elif is_xhamster:
                root_parsed = extract_xhamster_root_lexbor(final_url, html)
            elif is_eporner:
                # Parse the single root page immediately in-process with native Lexbor (~4ms)
                # so initial profile delivery never waits for cold worker process creation.
                root_parsed = extract_eporner_root_lexbor(final_url, html)
            else:
                root_parsed = LexborHTMLParser(html)
                if (
                    root_parsed.css_first("div[class*=psbio]") is not None
                    or root_parsed.css_first("div.pornstar-video-results-layout") is not None
                ):
                    is_eporner = True
                    root_parsed = extract_eporner_root_lexbor(final_url, root_parsed)

            async def _emit_partial():
                if not on_profile:
                    return
                partial = parse_profile_page(
                    final_url,
                    root_parsed,
                    extra_video_soups=extra_video_soups,
                    photos_html=photos_html,
                    playlists_html=playlists_html,
                    first_playlist_videos=first_playlist_videos,
                    gifs_html=gifs_html,
                    search_gifs_html=search_gifs_html,
                )
                partial["discovery_pending"] = True
                await on_profile(partial)

            if on_profile:
                initial = parse_profile_page(final_url, root_parsed)
                initial["discovery_pending"] = True
                if "profile_data" in initial:
                    # The first page is useful immediately but does not establish
                    # complete catalog totals while the remaining pages load.
                    initial["profile_data"]["stats"] = {
                        **initial["profile_data"].get("stats", {}),
                        "videos": None, "playlists": None, "albums": None,
                    }
                await on_profile(initial)

            if is_youtube:
                if isinstance(httpx.AsyncClient, type):
                    warm_worker_pool()
                base_channel_url = normalize_youtube_channel_base_url(final_url)
                channel_name = root_parsed.get("name", "")
                fallback_avatar = root_parsed.get("avatar") or ""
                path_lower = urlsplit(final_url).path.rstrip("/").lower()

                videos_url = f"{base_channel_url}/videos"
                playlists_url = f"{base_channel_url}/playlists"
                posts_url = f"{base_channel_url}/posts"

                yt_videos_html_holder = [html if path_lower.endswith("/videos") else ""]

                async def fetch_yt_videos():
                    if path_lower.endswith("/videos"):
                        return None
                    resp = await client.get(videos_url)
                    if resp.status_code == 200:
                        _notify_bs4_spy_if_hooked(resp.text)
                        yt_videos_html_holder[0] = resp.text
                        return await run_in_worker_pool(
                            ("youtube_videos", final_url, resp.text),
                            html_size=len(resp.content),
                        )
                    return None

                async def fetch_yt_playlists():
                    if path_lower.endswith("/playlists"):
                        return await run_in_worker_pool(
                            ("youtube_playlists", final_url, channel_name, html, fallback_avatar),
                            html_size=len(html),
                        )
                    resp = await client.get(playlists_url)
                    if resp.status_code == 200:
                        _notify_bs4_spy_if_hooked(resp.text)
                        return await run_in_worker_pool(
                            ("youtube_playlists", final_url, channel_name, resp.text, fallback_avatar),
                            html_size=len(resp.content),
                        )
                    return None

                async def fetch_yt_posts():
                    if path_lower.endswith(("/posts", "/community")):
                        return await run_in_worker_pool(
                            ("youtube_albums", final_url, html),
                            html_size=len(html),
                        )
                    resp = await client.get(posts_url)
                    if resp.status_code == 200:
                        _notify_bs4_spy_if_hooked(resp.text)
                        return await run_in_worker_pool(
                            ("youtube_albums", final_url, resp.text),
                            html_size=len(resp.content),
                        )
                    return None

                yt_v_res, yt_pl_res, yt_alb_res = await asyncio.gather(
                    fetch_yt_videos(), fetch_yt_playlists(), fetch_yt_posts(), return_exceptions=True
                )

                if not isinstance(yt_v_res, Exception) and yt_v_res is not None:
                    extra_video_soups.append(yt_v_res)
                elif isinstance(yt_v_res, Exception) and not root_parsed.get("videos", ([], []))[0]:
                    discovery_errors.append("videos")

                if not isinstance(yt_pl_res, Exception) and yt_pl_res is not None:
                    playlists_html = [(yt_pl_res[0], yt_pl_res[1])]

                if not isinstance(yt_alb_res, Exception) and yt_alb_res is not None:
                    photos_html = yt_alb_res

                if on_profile is not None and yt_videos_html_holder[0]:
                    await _emit_partial()
                    yt_init_data = _extract_yt_initial_data(yt_videos_html_holder[0])
                    yt_seen = {v.get("originalUrl") or "" for v in root_parsed.get("videos", ([], []))[0] if v.get("originalUrl")}
                    for b_can, _ in extra_video_soups:
                        for v in b_can:
                            if v.get("originalUrl"):
                                yt_seen.add(v["originalUrl"])

                    async def _on_yt_batch(b_can, b_raw):
                        extra_video_soups.append((b_can, b_raw))
                        await _emit_partial()

                    await collect_youtube_continuation_stream(
                        client,
                        videos_url,
                        yt_videos_html_holder[0],
                        yt_init_data,
                        extract_fn=lambda p_url, p_data: extract_youtube_videos_lexbor(p_url, p_data),
                        item_key_fn=lambda item: item.get("originalUrl") or "",
                        initial_seen_keys=yt_seen,
                        max_batches=None,
                        delay_seconds=0.45,
                        on_batch=_on_yt_batch,
                    )

            elif is_pornhub:
                if isinstance(httpx.AsyncClient, type):
                    warm_worker_pool()
                base_profile_url = normalize_pornhub_profile_base_url(final_url)
                fallback_avatar = root_parsed.get("avatar") or ""
                path_lower = urlsplit(final_url).path.rstrip("/").lower()

                videos_url = f"{base_profile_url}/videos"
                photos_url = f"{base_profile_url}/photos"
                playlists_url = f"{base_profile_url}/playlists"
                gifs_url = f"{base_profile_url}/gifs"

                fetch_sem = asyncio.Semaphore(4)

                # 1. Fetch page 1 of videos if not already on /videos
                if path_lower.endswith("/videos"):
                    v1_html = html
                else:
                    v1_resp = await _fetch_ph_or_default(client, videos_url, fetch_sem)
                    if v1_resp.status_code != 200 or not v1_resp.text or "leastFactor" in v1_resp.text:
                        await asyncio.sleep(0.3)
                        v1_resp = await _fetch_ph_or_default(client, videos_url, fetch_sem)
                    if v1_resp.status_code == 200:
                        _notify_bs4_spy_if_hooked(v1_resp.text)
                        v1_html = v1_resp.text
                        v1_extracted = await run_in_worker_pool(
                            ("pornhub_videos", final_url, v1_resp.text),
                            html_size=len(v1_resp.content),
                        )
                        extra_video_soups.append(v1_extracted)
                    else:
                        v1_html = ""
                        if not root_parsed.get("videos", ([], []))[0]:
                            discovery_errors.append("videos")

                for m_show in re.finditer(r"(\d+)\s*-\s*(\d+)\s*(?:of|de|von|sur|/)\s*([0-9,.\s]+)", v1_html or html, re.I):
                    try:
                        tot_c = int(re.sub(r"[^\d]", "", m_show.group(3)))
                        if int(m_show.group(2)) - int(m_show.group(1)) + 1 >= 12:
                            root_parsed["total_videos_reported"] = max(root_parsed.get("total_videos_reported") or 0, tot_c)
                    except ValueError:
                        pass

                max_video_page = extract_pornhub_max_video_page(v1_html or html)
                capped_max_page = min(max_video_page, 50)

                async def fetch_video_page(page_num: int):
                    page_url = f"{videos_url}?page={page_num}"
                    for attempt in range(2):
                        try:
                            resp = await _fetch_ph_or_default(client, page_url, fetch_sem)
                            if resp.status_code == 200 and "leastFactor" not in resp.text:
                                _notify_bs4_spy_if_hooked(resp.text)
                                extracted = await run_in_worker_pool(
                                    ("pornhub_videos", final_url, resp.text),
                                    html_size=len(resp.content),
                                )
                                if extracted and extracted[0]:
                                    return extracted
                        except Exception:
                            pass
                        if attempt == 0:
                            await asyncio.sleep(0.25)
                    return None

                async def fetch_ph_photos():
                    if path_lower.endswith("/photos"):
                        p_text = html
                    else:
                        resp = await _fetch_ph_or_default(client, photos_url, fetch_sem)
                        if resp.status_code != 200:
                            return None
                        _notify_bs4_spy_if_hooked(resp.text)
                        p_text = resp.text

                    base_albs = await run_in_worker_pool(
                        ("pornhub_albums", final_url, p_text),
                        html_size=len(p_text.encode("utf-8", errors="ignore")),
                    )
                    c_albs, r_albs = list(base_albs[0]), list(base_albs[1])
                    seen_alb_urls = {a.get("url") for a in c_albs if a.get("url")}

                    if "/photos/public" in p_text:
                        pub_url = f"{photos_url}/public"
                        pub_resp = await _fetch_ph_or_default(client, pub_url, fetch_sem)
                        if pub_resp.status_code == 200:
                            _notify_bs4_spy_if_hooked(pub_resp.text)
                            pub_albs = await run_in_worker_pool(
                                ("pornhub_albums", final_url, pub_resp.text),
                                html_size=len(pub_resp.content),
                            )
                            for ca, ra in zip(pub_albs[0], pub_albs[1]):
                                u = ca.get("url")
                                if u and u not in seen_alb_urls:
                                    seen_alb_urls.add(u)
                                    c_albs.append(ca)
                                    r_albs.append(ra)
                    return c_albs, r_albs

                async def fetch_ph_playlists():
                    if path_lower.endswith("/playlists"):
                        return await run_in_worker_pool(
                            ("pornhub_playlists", final_url, html, fallback_avatar),
                            html_size=len(html),
                        )
                    resp = await _fetch_ph_or_default(client, playlists_url, fetch_sem)
                    if resp.status_code == 200:
                        _notify_bs4_spy_if_hooked(resp.text)
                        return await run_in_worker_pool(
                            ("pornhub_playlists", final_url, resp.text, fallback_avatar),
                            html_size=len(resp.content),
                        )
                    return None

                async def fetch_ph_gifs():
                    if path_lower.endswith("/gifs"):
                        g_text = html
                    else:
                        resp = await _fetch_ph_or_default(client, gifs_url, fetch_sem)
                        if resp.status_code != 200:
                            return None
                        _notify_bs4_spy_if_hooked(resp.text)
                        g_text = resp.text

                    base_gifs = await run_in_worker_pool(
                        ("pornhub_gifs", final_url, g_text),
                        html_size=len(g_text.encode("utf-8", errors="ignore")),
                    )
                    c_gifs, r_gifs = list(base_gifs[0]), list(base_gifs[1])
                    seen_gif_urls = {g.get("url") for g in c_gifs if g.get("url")}

                    for sub in ("public", "video"):
                        if f"/gifs/{sub}" in g_text:
                            sub_resp = await _fetch_ph_or_default(client, f"{gifs_url}/{sub}", fetch_sem)
                            if sub_resp.status_code == 200:
                                _notify_bs4_spy_if_hooked(sub_resp.text)
                                sub_gifs = await run_in_worker_pool(
                                    ("pornhub_gifs", final_url, sub_resp.text),
                                    html_size=len(sub_resp.content),
                                )
                                for cg, rg in zip(sub_gifs[0], sub_gifs[1]):
                                    u = cg.get("url")
                                    if u and u not in seen_gif_urls:
                                        seen_gif_urls.add(u)
                                        c_gifs.append(cg)
                                        r_gifs.append(rg)
                    return c_gifs, r_gifs

                async def fetch_ph_uploaded_videos():
                    if "/videos/upload" not in html and "/videos/upload" not in (v1_html or ""):
                        return None
                    up_url = f"{videos_url}/upload"
                    resp = await _fetch_ph_or_default(client, up_url, fetch_sem)
                    if resp.status_code == 200 and "leastFactor" not in resp.text:
                        _notify_bs4_spy_if_hooked(resp.text)
                        return await run_in_worker_pool(
                            ("pornhub_videos", final_url, resp.text),
                            html_size=len(resp.content),
                        )
                    return None

                async def fetch_ph_search_gifs():
                    p_name = (root_parsed.get("name") or "").strip()
                    if not p_name:
                        parts = [p for p in urlsplit(final_url).path.split("/") if p]
                        if parts:
                            p_name = parts[-1].replace("-", " ")
                    if not p_name:
                        return None
                    encoded_q = quote_plus(p_name.lower())
                    search_urls = [
                        f"https://www.pornhub.com/gifs/search?search={encoded_q}&page={p}" if p > 1
                        else f"https://www.pornhub.com/gifs/search?search={encoded_q}"
                        for p in range(1, 6)
                    ]
                    try:
                        page_resps = await asyncio.gather(
                            *(_fetch_ph_or_default(client, u, fetch_sem) for u in search_urls),
                            return_exceptions=True,
                        )
                        c_gifs, r_gifs = [], []
                        seen_urls = set()
                        total_reported = None
                        for u, pr in zip(search_urls, page_resps):
                            if not isinstance(pr, Exception) and getattr(pr, "status_code", 0) == 200 and pr.text and "leastFactor" not in pr.text:
                                if total_reported is None:
                                    m_cnt = re.search(r"Showing\s+[\d\-]+\s+of\s+([\d,]+)", pr.text, re.I)
                                    if m_cnt:
                                        total_reported = int(m_cnt.group(1).replace(",", ""))
                                _notify_bs4_spy_if_hooked(pr.text)
                                parsed_batch = await run_in_worker_pool(
                                    ("pornhub_gifs", u, pr.text),
                                    html_size=len(pr.content),
                                )
                                for cg, rg in zip(parsed_batch[0], parsed_batch[1]):
                                    gu = cg.get("url") or cg.get("originalUrl")
                                    if gu and gu not in seen_urls:
                                        seen_urls.add(gu)
                                        c_gifs.append(cg)
                                        r_gifs.append(rg)
                        return (c_gifs, r_gifs, total_reported) if c_gifs else None
                    except Exception:
                        return None

                other_tasks = [fetch_ph_photos(), fetch_ph_playlists(), fetch_ph_gifs(), fetch_ph_uploaded_videos(), fetch_ph_search_gifs()]
                if on_profile is not None:
                    results = await asyncio.gather(*other_tasks, return_exceptions=True)
                    extra_video_resps = []
                else:
                    extra_video_tasks = [fetch_video_page(p) for p in range(2, capped_max_page + 1)]
                    results = await asyncio.gather(*other_tasks, *extra_video_tasks, return_exceptions=True)
                    extra_video_resps = results[5:]

                ph_alb_res = results[0]
                ph_pl_res = results[1]
                ph_gif_res = results[2]
                ph_up_res = results[3]
                ph_search_res = results[4]

                if not isinstance(ph_up_res, Exception) and ph_up_res is not None:
                    extra_video_soups.append(ph_up_res)

                for vr in extra_video_resps:
                    if not isinstance(vr, Exception) and vr is not None:
                        extra_video_soups.append(vr)

                if not isinstance(ph_alb_res, Exception) and ph_alb_res is not None:
                    photos_html = ph_alb_res
                elif isinstance(ph_alb_res, Exception):
                    discovery_errors.append("albums")

                if not isinstance(ph_pl_res, Exception) and ph_pl_res is not None:
                    playlists_html = [ph_pl_res]
                elif isinstance(ph_pl_res, Exception):
                    discovery_errors.append("playlists")

                if not isinstance(ph_gif_res, Exception) and ph_gif_res is not None:
                    gifs_html = ph_gif_res

                if not isinstance(ph_search_res, Exception) and ph_search_res is not None:
                    search_gifs_html = ph_search_res

                if on_profile is not None and max_video_page >= 2:
                    await _emit_partial()
                    for p in range(2, max_video_page + 1):
                        vr = await fetch_video_page(p)
                        if vr is None or not vr[0]:
                            break
                        extra_video_soups.append(vr)
                        await _emit_partial()
                        await asyncio.sleep(0.4)

            elif is_xhamster:
                if isinstance(httpx.AsyncClient, type):
                    warm_worker_pool()
                base_profile_url = normalize_xhamster_profile_base_url(final_url)
                fallback_avatar = root_parsed.get("avatar") or ""
                path_lower = urlsplit(final_url).path.rstrip("/").lower()

                async def fetch_xh_shorts():
                    shorts_url = f"{base_profile_url}/shorts"
                    if path_lower.endswith("/shorts"):
                        return await run_in_worker_pool(
                            ("xhamster_shorts", final_url, html),
                            html_size=len(html),
                        )
                    try:
                        resp = await client.get(shorts_url)
                        if resp.status_code == 200:
                            _notify_bs4_spy_if_hooked(resp.text)
                            return await run_in_worker_pool(
                                ("xhamster_shorts", final_url, resp.text),
                                html_size=len(resp.content),
                            )
                    except Exception:
                        pass
                    return None

                async def fetch_xh_photos():
                    photos_url = f"{base_profile_url}/photos"
                    if path_lower.endswith("/photos"):
                        return await run_in_worker_pool(
                            ("xhamster_albums", final_url, html),
                            html_size=len(html),
                        )
                    try:
                        resp = await client.get(photos_url)
                        if resp.status_code == 200:
                            _notify_bs4_spy_if_hooked(resp.text)
                            return await run_in_worker_pool(
                                ("xhamster_albums", final_url, resp.text),
                                html_size=len(resp.content),
                            )
                    except Exception:
                        pass
                    return None

                async def append_catalog_batch(canonical, raw):
                    extra_video_soups.append((canonical, raw))
                    await _emit_partial()

                # Read the actual Videos/All videos tab before following its declared pages.
                # Never infer page count or URL layout from an approximate source total.
                catalog_complete = await collect_xhamster_catalog(
                    client, base_profile_url, html,
                    initial_videos=root_parsed.get("videos", ([], []))[0],
                    reported_total=root_parsed.get("total_videos_reported"),
                    on_batch=append_catalog_batch,
                )
                if not catalog_complete:
                    discovery_errors.append("videos")
                xh_shorts_res, xh_photo_res = await asyncio.gather(
                    fetch_xh_shorts(), fetch_xh_photos(), return_exceptions=True,
                )
                if not isinstance(xh_photo_res, Exception) and xh_photo_res is not None and xh_photo_res[0]:
                    photos_html = xh_photo_res
                if not isinstance(xh_shorts_res, Exception) and xh_shorts_res is not None:
                    gifs_html = xh_shorts_res

            elif is_eporner:
                if isinstance(httpx.AsyncClient, type):
                    warm_worker_pool()
                first_video_urls = [v["originalUrl"] for v in root_parsed["videos"][0][:2] if v.get("originalUrl")]
                prefetch_metadata(first_video_urls or html, final_url, "video", DEFAULT_HEADERS)
                clean_slug = profile_search_slug(final_url, root_parsed)
                max_video_page = root_parsed.get("max_video_page", 1)
                fallback_avatar = root_parsed.get("avatar") or ""

                page_urls = [f"{final_url.rstrip('/')}/{p}/" for p in range(2, max_video_page + 1)]
                photos_url = urljoin(final_url.rstrip("/") + "/", "photos/")
                playlists_url = f"https://www.eporner.com/search-playlists/{clean_slug}/"

                # Overlapped fetch + worker pool extraction: each page is parsed by a worker
                # as soon as its HTTP response completes, without waiting for slower pages.
                listing_parsed = {}
                fetch_sem = asyncio.Semaphore(12)

                async def fetch_video_page(url):
                    async with fetch_sem:
                        resp = await client.get(url)
                    if resp.status_code == 200:
                        _notify_bs4_spy_if_hooked(resp.text)
                        listing_parsed[id(resp)] = await run_in_worker_pool(
                            ("eporner_videos", final_url, resp.text),
                            html_size=len(resp.content),
                        )
                    return resp

                async def fetch_photos_listing(url):
                    async with fetch_sem:
                        resp = await client.get(url)
                    if resp.status_code == 200:
                        _notify_bs4_spy_if_hooked(resp.text)
                        extracted = await run_in_worker_pool(
                            ("eporner_albums", final_url, resp.text),
                            html_size=len(resp.content),
                        )
                        listing_parsed[id(resp)] = extracted
                        alb_urls = [a["url"] for a in extracted[0][:2] if a.get("url")]
                        prefetch_metadata(alb_urls or resp.text, str(resp.url), "album", DEFAULT_HEADERS)
                    return resp

                async def fetch_playlists_listing(url):
                    async with fetch_sem:
                        resp = await client.get(url)
                    if resp.status_code == 200:
                        _notify_bs4_spy_if_hooked(resp.text)
                        extracted = await run_in_worker_pool(
                            ("eporner_playlists", final_url, str(resp.url), resp.text, fallback_avatar),
                            html_size=len(resp.content),
                        )
                        listing_parsed[id(resp)] = extracted
                        pl_urls = [p["url"] for p in extracted[0][:2] if p.get("url")]
                        prefetch_metadata(pl_urls or resp.text, str(resp.url), "playlist", DEFAULT_HEADERS)
                    return resp

                tasks = (
                    [fetch_video_page(u) for u in page_urls]
                    + [fetch_photos_listing(photos_url), fetch_playlists_listing(playlists_url)]
                )
                results = await asyncio.gather(*tasks, return_exceptions=True)

                num_pages = len(page_urls)
                video_resps = results[:num_pages]
                photos_resp = results[num_pages] if len(results) > num_pages else None
                playlists_resp = results[num_pages + 1] if len(results) > num_pages + 1 else None
                if isinstance(playlists_resp, Exception) or getattr(playlists_resp, "status_code", 0) != 200:
                    discovery_errors.append("playlists")
                photos_status = 0 if isinstance(photos_resp, Exception) else getattr(photos_resp, "status_code", 0)
                if photos_status != 200 and not (photos_status == 404 and root_parsed.get("total_photos_reported", 0) == 0):
                    discovery_errors.append("albums")
                if any(isinstance(item, Exception) or getattr(item, "status_code", 0) != 200 for item in video_resps):
                    discovery_errors.append("videos")

                for vr in video_resps:
                    if not isinstance(vr, Exception) and getattr(vr, "status_code", 0) == 200:
                        extra_video_soups.append(listing_parsed[id(vr)])

                is_account_profile = "/profile/" in urlsplit(final_url).path.lower()
                section_urls = discover_profile_section_urls(
                    final_url,
                    html,
                    fallback_suffixes=(
                        {"playlists": ("playlists/",), "videos": ("videos/",)}
                        if is_account_profile
                        else None
                    ),
                )

                async def _emit_progress():
                    if not on_profile:
                        return
                    partial = parse_profile_page(
                        final_url,
                        root_parsed,
                        extra_video_soups=extra_video_soups,
                        photos_html=photos_html,
                        playlists_html=playlists_html,
                        first_playlist_videos=first_playlist_videos,
                        gifs_html=gifs_html,
                        search_gifs_html=search_gifs_html,
                    )
                    partial["discovery_pending"] = True
                    await on_profile(partial)

                async def _on_video_batch(b_can, b_raw):
                    extra_video_soups.append((b_can, b_raw))
                    await _emit_progress()

                is_streaming = on_profile is not None

                # Additive infinite-scroll stream completion (unbounded in streaming mode)
                await collect_cursor_stream(
                    client,
                    final_url,
                    html,
                    extract_fn=lambda p_url, p_html: extract_eporner_videos_lexbor(p_url, p_html),
                    item_key_fn=lambda item: item.get("originalUrl") or "",
                    initial_seen_keys={v.get("originalUrl") or "" for v in root_parsed["videos"][0] if v.get("originalUrl")},
                    max_batches=None if is_streaming else 35,
                    max_duration_seconds=None if is_streaming else 18.0,
                    on_batch=_on_video_batch if is_streaming else None,
                    delay_seconds=0.35 if is_streaming else 0.2,
                ) if is_streaming else extra_video_soups.extend((await collect_cursor_stream(
                    client,
                    final_url,
                    html,
                    extract_fn=lambda p_url, p_html: extract_eporner_videos_lexbor(p_url, p_html),
                    item_key_fn=lambda item: item.get("originalUrl") or "",
                    initial_seen_keys={v.get("originalUrl") or "" for v in root_parsed["videos"][0] if v.get("originalUrl")},
                    max_batches=35,
                    max_duration_seconds=18.0,
                ))[0])

                # Additive video completion: if root had 0 videos (e.g. /profile/<user>/) or a dedicated videos tab exists
                extra_video_tab_urls = [
                    u for u in section_urls.get("videos", [])
                    if u.rstrip("/") != final_url.rstrip("/")
                ]
                if (len(root_parsed["videos"][0]) == 0 and extra_video_tab_urls) or (
                    is_account_profile and extra_video_tab_urls
                ):
                    if is_streaming:
                        await collect_paginated_section(
                            client,
                            extra_video_tab_urls,
                            extract_fn=lambda p_url, p_html: extract_eporner_videos_lexbor(p_url, p_html),
                            item_key_fn=lambda item: item.get("originalUrl") or "",
                            max_pages=None,
                            concurrency=2,
                            on_batch=_on_video_batch,
                            delay_seconds=0.35,
                        )
                    else:
                        tab_video_batches, _ = await collect_paginated_section(
                            client,
                            extra_video_tab_urls,
                            extract_fn=lambda p_url, p_html: extract_eporner_videos_lexbor(p_url, p_html),
                            item_key_fn=lambda item: item.get("originalUrl") or "",
                            max_pages=20,
                            concurrency=10,
                        )
                        extra_video_soups.extend(tab_video_batches)

                # Additive continuation if page 1 truncated pagination links before the true last page
                last_ok_video_resp = next(
                    (vr for vr in reversed(video_resps) if not isinstance(vr, Exception) and getattr(vr, "status_code", 0) == 200),
                    None,
                )
                if last_ok_video_resp is not None:
                    trailing_video_urls = [
                        u for u in extract_next_page_urls(
                            str(last_ok_video_resp.url),
                            last_ok_video_resp.text,
                            current_page_num=max_video_page,
                            section_prefix=urlsplit(final_url).path.rstrip("/") + "/",
                        )
                        if u.rstrip("/") not in {pu.rstrip("/") for pu in page_urls}
                        and u.rstrip("/") != final_url.rstrip("/")
                    ]
                    if trailing_video_urls:
                        extra_v_batches, _ = await collect_paginated_section(
                            client,
                            trailing_video_urls,
                            extract_fn=lambda p_url, p_html: extract_eporner_videos_lexbor(p_url, p_html),
                            item_key_fn=lambda item: item.get("originalUrl") or "",
                            max_pages=20,
                        )
                        extra_video_soups.extend(extra_v_batches)

                # Additive album/photos pagination (beyond page 1)
                if photos_resp and not isinstance(photos_resp, Exception) and getattr(photos_resp, "status_code", 0) == 200:
                    p1_can, p1_raw = listing_parsed[id(photos_resp)]
                    extra_album_urls = [
                        u for u in extract_next_page_urls(
                            str(photos_resp.url),
                            photos_resp.text,
                            current_page_num=1,
                        )
                    ] + [
                        u for u in section_urls.get("albums", [])
                        if u.rstrip("/") != photos_url.rstrip("/")
                    ]
                    if extra_album_urls:
                        extra_alb_batches, _ = await collect_paginated_section(
                            client,
                            extra_album_urls,
                            extract_fn=lambda p_url, p_html: extract_eporner_albums_lexbor(p_url, p_html),
                            item_key_fn=lambda item: item.get("url") or "",
                            max_pages=None if is_streaming else 15,
                        )
                        all_alb_can = list(p1_can)
                        all_alb_raw = list(p1_raw)
                        for b_can, b_raw in extra_alb_batches:
                            all_alb_can.extend(b_can)
                            all_alb_raw.extend(b_raw)
                        photos_html = (all_alb_can, all_alb_raw)
                    else:
                        photos_html = (p1_can, p1_raw)

                playlists_html_list = []
                # Include any playlist cards already rendered directly on the profile root page
                root_pl_can, root_pl_raw, _ = extract_eporner_playlists_lexbor(
                    final_url, final_url, html, fallback_avatar
                )
                if root_pl_can:
                    playlists_html_list.append((root_pl_can, root_pl_raw))

                if playlists_resp and not isinstance(playlists_resp, Exception) and getattr(playlists_resp, "status_code", 0) == 200:
                    search_pl_list, search_complete = await collect_playlist_search_pages(
                        client,
                        playlists_url,
                        playlists_resp,
                        listing_parsed[id(playlists_resp)],
                        profile_url=final_url,
                        fallback_avatar=fallback_avatar,
                    )
                    playlists_html_list.extend(search_pl_list)
                    if not search_complete and "playlists" not in discovery_errors:
                        discovery_errors.append("playlists")

                # Additive profile-owned playlist tabs (e.g. /profile/<user>/playlists/ and discovered tabs)
                extra_pl_urls = [
                    u for u in section_urls.get("playlists", [])
                    if u.rstrip("/") != playlists_url.rstrip("/")
                ]
                if extra_pl_urls:
                    tab_pl_batches, _ = await collect_paginated_section(
                        client,
                        extra_pl_urls,
                        extract_fn=lambda p_url, p_html: extract_eporner_playlists_lexbor(
                            final_url, p_url, p_html, fallback_avatar
                        )[:2],
                        item_key_fn=lambda item: item.get("url") or "",
                        max_pages=None if is_streaming else 20,
                    )
                    if tab_pl_batches:
                        playlists_html_list.extend(tab_pl_batches)
                        if "playlists" in discovery_errors:
                            discovery_errors.remove("playlists")

                playlists_html = playlists_html_list if playlists_html_list else None

    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="Could not load the profile page") from exc

    parse_options = dict(
        extra_video_soups=extra_video_soups,
        photos_html=photos_html,
        playlists_html=playlists_html,
        first_playlist_videos=first_playlist_videos,
        gifs_html=gifs_html,
        search_gifs_html=search_gifs_html,
    )
    manifest = parse_profile_page(final_url, root_parsed, **parse_options)

    for kind, section in (("video", "canonical_videos"), ("album", "canonical_albums"), ("playlist", "canonical_playlists")):
        for item in manifest.get(section, []):
            metadata = cached_metadata(item.get("originalUrl") or item.get("url"), kind)
            if metadata:
                item.update({key: value for key, value in metadata.items() if key not in ("url", "kind")})
                if metadata.get("reportedCount") is not None and kind != "video":
                    item["photoCount" if kind == "album" else "videoCount"] = metadata["reportedCount"]
    manifest["discovery_errors"] = discovery_errors
    manifest["discovery_pending"] = False
    if "profile_data" in manifest:
        for kind in discovery_errors:
            if not (is_xhamster and kind == "videos"):
                manifest["profile_data"]["stats"][kind] = None
    start_catalog_prefetch(manifest, DEFAULT_HEADERS)
    return manifest


@router.post("/scan")
async def scan_profile(request: ProfileScanRequest):
    return await _scan_profile(request)


@router.post("/scan-stream")
async def stream_profile(request: ProfileScanRequest):
    """Deliver the first useful profile before deep catalog discovery finishes."""
    parsed = urlsplit(request.url.strip())
    if parsed.scheme not in ("http", "https") or not parsed.netloc or parsed.username or parsed.password:
        raise HTTPException(status_code=400, detail="A valid HTTP or HTTPS profile URL is required")

    async def events():
        queue = asyncio.Queue(maxsize=32)

        async def initial(profile):
            await queue.put({"type": "profile", "profile": profile})

        async def run():
            try:
                profile = await _scan_profile(request, on_profile=initial)
                await queue.put({"type": "complete", "profile": profile})
            except HTTPException as exc:
                await queue.put({"type": "error", "detail": str(exc.detail)})
            except Exception:
                await queue.put({"type": "error", "detail": "Could not complete profile discovery"})

        task = asyncio.create_task(run())
        try:
            while True:
                event = await queue.get()
                yield json.dumps(event) + "\n"
                if event["type"] in ("complete", "error"):
                    break
        finally:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    return StreamingResponse(
        events(),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )


@router.post("/album-photos")
async def get_album_photos(request: AlbumPhotosRequest):
    """Scrapes all high-resolution photos for a specific album/gallery URL."""
    gallery_url = request.url.strip()
    parsed = urlsplit(gallery_url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise HTTPException(status_code=400, detail="A valid HTTP or HTTPS gallery URL is required")

    # Dedicated fast path for global GIF search collections
    is_gif_search = is_pornhub_host(gallery_url) and (
        "/gifs/search" in gallery_url
        or "/gifs?search=" in gallery_url
        or ("search=" in parsed.query and "/gifs" in parsed.path)
    )
    if is_gif_search:
        batch_start, batch_end = album_batch_bounds(request.page)
        root_url = album_query_page_url(gallery_url, 1)
        try:
            async with httpx.AsyncClient(timeout=30, follow_redirects=True, headers=DEFAULT_HEADERS) as client:
                first = await _fetch_ph_or_default(client, root_url)
                first.raise_for_status()
                if not first.text or "leastFactor" in first.text:
                    raise HTTPException(status_code=502, detail={"code": "gif_search_unconfirmed"})
                last_page = extract_pornhub_max_video_page(first.text)
                if batch_start > last_page:
                    raise HTTPException(status_code=404, detail={"code": "gif_search_batch_unavailable"})
                sem = asyncio.Semaphore(ALBUM_HTML_CONCURRENCY)
                page_urls = [album_query_page_url(gallery_url, number) for number in range(batch_start, min(last_page, batch_end) + 1)]
                pending_urls = [url for url in page_urls if url != root_url]
                responses = await asyncio.gather(*(_fetch_ph_or_default(client, url, sem) for url in pending_urls), return_exceptions=True)
                by_url = {root_url: first}
                for url, response in zip(pending_urls, responses):
                    if isinstance(response, Exception) or response.status_code != 200 or not response.text or "leastFactor" in response.text:
                        raise HTTPException(status_code=502, detail={"code": "gif_search_batch_incomplete"})
                    by_url[url] = response
            photos = []
            seen_keys = set()
            reported_count = None
            counter_tree = LexborHTMLParser(first.text)
            for counter in counter_tree.css(".showingInfo, .showingCounter, .videoCounter, span.showing"):
                match = re.search(r"Showing\s+[\d\-]+\s+of\s+([\d,]+)", counter.text(separator=" ", strip=True), re.I)
                if match:
                    reported_count = int(match.group(1).replace(",", ""))
                    break
            for url in page_urls:
                response = by_url[url]
                parsed_page = await run_in_worker_pool(("pornhub_gifs", url, response.text), html_size=len(response.content))
                for item in parsed_page[0]:
                    key = item.get("id") or item.get("originalUrl") or item.get("thumbnailUrl")
                    if key and key not in seen_keys:
                        seen_keys.add(key)
                        original = item.get("originalUrl") or ""
                        if original:
                            proxy = "proxy-video-stream" if item.get("format") in ("mp4", "webm") or ".mp4" in original else "proxy-image"
                            item["streamUrl"] = f"/api/{proxy}?url={quote(original)}&referer={quote(root_url)}"
                        photos.append(item)
            if not photos and reported_count != 0:
                raise HTTPException(status_code=502, detail={"code": "gif_search_items_unconfirmed"})
            return {"success": True, "gallery_url": gallery_url, "count": len(photos), "photos": photos,
                "paginationComplete": batch_end >= last_page, "reportedCount": reported_count, "page": request.page}
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=502, detail={"code": "gif_search_unavailable"}) from exc

    batch_start, batch_end = album_batch_bounds(request.page)
    extra_pages_html: list[tuple[str, int, str]] = []
    selected_page_urls: list[str] = []
    source_pages: dict[int, str] = {}
    boundary_known = False
    try:
        async with httpx.AsyncClient(timeout=25, follow_redirects=True, headers=DEFAULT_HEADERS) as client:
            resp = await _fetch_ph_or_default(client, gallery_url)
            resp.raise_for_status()
            html = resp.text
            final_url = str(resp.url)
            payload_len = len(resp.content)
            if not html or "leastFactor" in html:
                raise HTTPException(status_code=502, detail={"code": "album_source_unconfirmed"})
            source_pages[1] = final_url
            if is_pornhub_host(final_url):
                base_alb_url = final_url.split("?")[0].rstrip("/")
                if base_alb_url.endswith("/gifs") and any(seg in final_url for seg in ("/pornstar/", "/model/", "/channels/", "/users/")):
                    for sub in ("public", "video"):
                        if f"/gifs/{sub}" in html:
                            source_pages[len(source_pages) + 1] = f"{base_alb_url}/{sub}"
                else:
                    last_page = extract_pornhub_max_video_page(html)
                    # Build only this request's batch, not a huge range of URLs.
                    for number in range(max(2, batch_start), min(last_page, batch_end) + 1):
                        source_pages[number] = album_query_page_url(final_url, number)
                    if last_page > batch_end:
                        source_pages[last_page] = album_query_page_url(final_url, last_page)
                boundary_known = True
            elif is_xhamster_host(final_url):
                initials = _extract_xhamster_initials(html)
                gp = initials.get("galleryPage", {})
                pagination = gp.get("paginationProps", {})
                pagination = pagination if isinstance(pagination, dict) else {}
                last_page = pagination.get("lastPageNumber", 1)
                template = pagination.get("pageLinkTemplate")
                if not isinstance(last_page, int) or isinstance(last_page, bool) or last_page < 1:
                    raise HTTPException(status_code=502, detail={"code": "album_pagination_invalid"})
                base_alb_url = re.sub(r"/\d+$", "", final_url.split("?")[0].rstrip("/"))
                for number in range(max(2, batch_start), min(last_page, batch_end) + 1):
                    candidate = template.replace("{#}", str(number)) if isinstance(template, str) and "{#}" in template else f"{base_alb_url}/{number}"
                    candidate = _http_url(final_url, candidate)
                    if not candidate or urlsplit(candidate).netloc != urlsplit(final_url).netloc:
                        raise HTTPException(status_code=502, detail={"code": "album_pagination_destination_invalid"})
                    source_pages[number] = candidate
                if last_page > batch_end:
                    source_pages[last_page] = final_url
                boundary_known = True
            else:
                tree_first = LexborHTMLParser(html)
                for link in tree_first.css(".pagination a[href], .pagenav a[href], div[class*='page'] a[href], div.numlist a[href], div.numlist2 a[href], ul.pagination a[href]"):
                    candidate = _http_url(final_url, link.attributes.get("href") or "")
                    if not candidate or urlsplit(candidate).netloc != urlsplit(final_url).netloc:
                        continue
                    text = link.text(strip=True)
                    if text.isdigit() and int(text) > 1:
                        source_pages[int(text)] = candidate
                    if text.isdigit() and "last" in (link.attributes.get("rel") or "").split():
                        boundary_known = True
            last_known_page = max(source_pages)
            if not is_pornhub_host(final_url) and not is_xhamster_host(final_url):
                for number in range(batch_start, min(last_known_page, batch_end) + 1):
                    if number not in source_pages:
                        candidate = album_link_page_url(source_pages, number)
                        if not candidate:
                            raise HTTPException(status_code=502, detail={"code": "album_pagination_unconfirmed"})
                        source_pages[number] = candidate
            selected_page_urls = [url for number, url in sorted(source_pages.items()) if batch_start <= number <= batch_end]
            if not selected_page_urls:
                raise HTTPException(status_code=404, detail={"code": "album_batch_unavailable"})
            sem = asyncio.Semaphore(ALBUM_HTML_CONCURRENCY)
            extra_urls = [url for url in selected_page_urls if url != final_url]
            responses = await asyncio.gather(*(_fetch_ph_or_default(client, url, sem) for url in extra_urls), return_exceptions=True)
            for url, response in zip(extra_urls, responses):
                if isinstance(response, Exception) or response.status_code != 200 or not response.text or "leastFactor" in response.text:
                    # Retry the same batch instead of advancing past a missing page.
                    raise HTTPException(status_code=502, detail={"code": "album_batch_incomplete"})
                extra_pages_html.append((response.text, len(response.content), str(response.url)))
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail={"code": "album_source_unavailable"}) from exc

    first_res = await run_in_worker_pool(("album_page", html, final_url), html_size=payload_len)
    photos = list(first_res.get("photos", [])) if final_url in selected_page_urls else []
    seen_keys = {photo.get("id") or photo.get("originalUrl") or photo.get("thumbnailUrl") for photo in photos}
    for page_html, page_length, page_url in extra_pages_html:
        sub_res = await run_in_worker_pool(("album_page", page_html, page_url), html_size=page_length)
        for item in sub_res.get("photos", []):
            key = item.get("id") or item.get("originalUrl") or item.get("thumbnailUrl")
            if key and key not in seen_keys:
                seen_keys.add(key)
                photos.append(item)

    if is_pornhub_host(final_url) and photos and any(p.get("type") == "gif" for p in photos):
        # Fast concurrent probe to drop legacy 410 Gone / 404 dead media cards
        verify_sem = asyncio.Semaphore(16)
        async with httpx.AsyncClient(timeout=4.0, headers={"User-Agent": "Mozilla/5.0", "Referer": "https://www.pornhub.com/"}) as v_client:
            async def _is_live(p_item):
                thumb = p_item.get("thumbnailUrl")
                if not thumb:
                    return None
                async with verify_sem:
                    try:
                        r = await v_client.head(thumb)
                        if r.status_code == 200:
                            return p_item
                        if r.status_code in (404, 410):
                            return None
                        r2 = await v_client.get(thumb, headers={"Range": "bytes=0-10"})
                        if r2.status_code in (200, 206):
                            return p_item
                        return None
                    except Exception:
                        return p_item

            verified = await asyncio.gather(*(_is_live(p) for p in photos))
            photos = [p for p in verified if p is not None]

    if is_pornhub_host(final_url) and photos:
        for p_item in photos:
            orig = p_item.get("originalUrl") or ""
            if orig and ("phncdn.com" in orig or is_pornhub_host(final_url)):
                if p_item.get("format") in ("mp4", "webm") or ".mp4" in orig:
                    p_item["streamUrl"] = f"/api/proxy-video-stream?url={quote(orig)}&referer=https://www.pornhub.com/"
                else:
                    p_item["streamUrl"] = f"/api/proxy-image?url={quote(orig)}&referer=https://www.pornhub.com/"

    first_res["photos"] = photos
    first_res["count"] = len(photos)
    reported = first_res.get("reportedCount")
    has_more_pages = last_known_page > batch_end
    if last_known_page > 1:
        complete = boundary_known and not has_more_pages
        if request.page == 1 and reported is not None and len(photos) != reported:
            complete = False
    else:
        complete = (len(photos) == reported) if reported is not None else first_res.get("paginationComplete") is True
    first_res["paginationComplete"] = complete
    first_res["page"] = request.page
    return first_res


@router.post("/resolve-photo", response_model=PhotoResolveResult)
async def resolve_album_photo(request: PhotoResolveRequest):
    """Dynamically resolves full-resolution original image URL and physical metadata on-demand."""
    if not request.thumbnail_url and not request.page_url:
        raise HTTPException(status_code=400, detail="thumbnail_url or page_url is required")
    return await resolve_photo_original(request)


@router.post("/playlist-videos")
async def get_playlist_videos(request: PlaylistVideosRequest):
    """Scrapes all real videos from a specific playlist URL."""
    playlist_url = request.url.strip()
    parsed = urlsplit(playlist_url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise HTTPException(status_code=400, detail="A valid HTTP or HTTPS playlist URL is required")

    try:
        async with httpx.AsyncClient(timeout=25, follow_redirects=True, headers=DEFAULT_HEADERS) as client:
            resp = await _fetch_ph_or_default(client, playlist_url)
            resp.raise_for_status()
            html = resp.text
            final_url = str(resp.url)
            payload_len = len(resp.content)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Could not load playlist: {exc}") from exc

    return await run_in_worker_pool(("playlist_page", html, final_url), html_size=payload_len)


@router.post("/batch-save")
async def profile_hub_batch_save(request: ProfileBatchSaveRequest):
    """Saves selected albums and videos from the Profile Hub directly into the designated library folder."""
    if request.albums:
        raise HTTPException(status_code=409, detail="profile_hub_confirmed_execution_required")
    from .video_service import sanitize_folder_name, video_service

    folder = sanitize_folder_name(request.folder or "Arquivo Geral")
    saved_albums_count = 0
    saved_videos_count = 0

    try:
        os.makedirs(os.path.join(video_service.base_dir, folder), exist_ok=True)
    except Exception:
        pass

    # 1. Register Videos as stream items in the library
    for v in request.videos:
        v_url = (v.get("originalUrl") or v.get("url") or "").strip()
        v_title = v.get("title") or "Vídeo"
        v_thumb = v.get("thumbnailUrl")
        v_dur = v.get("duration")

        if not v_url:
            continue

        seed = v_url
        vid_id = hashlib.md5(seed.encode("utf-8")).hexdigest()[:12]
        proxied_stream = f"/api/proxy-video-stream?url={v_url}"

        dur_secs = None
        if v_dur:
            try:
                parts = [int(p) for p in str(v_dur).split(":") if p.isdigit()]
                if len(parts) == 2:
                    dur_secs = float(parts[0] * 60 + parts[1])
                elif len(parts) == 3:
                    dur_secs = float(parts[0] * 3600 + parts[1] * 60 + parts[2])
            except Exception:
                dur_secs = None

        try:
            video_service._update_single_metadata(
                file_path=None,
                title=v_title,
                folder=folder,
                is_favorite=False,
                vid_id=vid_id,
                storage_location="stream_url",
                stream_url=proxied_stream,
                source_url=v_url,
                source_thumbnail_url=v_thumb,
                duration_seconds=dur_secs,
            )
            saved_videos_count += 1
        except Exception as err:
            import logging
            logging.getLogger(__name__).warning("Failed to save stream metadata for %s: %s", v_url, err)

    # Albums require the confirmed executor; never count unqueued albums as saved.
    saved_albums_count = 0

    return {
        "success": True,
        "folder": folder,
        "saved_videos": saved_videos_count,
        "saved_albums": saved_albums_count,
        "message": f"{saved_videos_count} vídeos e {saved_albums_count} álbuns adicionados à pasta '{folder}' com sucesso!",
    }
