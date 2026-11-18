"""Read-only site icons for Profile Hub; never imports app startup or storage."""
from __future__ import annotations

import asyncio
from collections import OrderedDict
from html.parser import HTMLParser
from io import BytesIO
import ssl
import time
from urllib.parse import urldefrag, urljoin, urlsplit, urlunsplit
import warnings

import certifi
import httpcore
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import Response
from PIL import Image, UnidentifiedImageError

from .profile_directory_transport import DEFAULT_TRANSPORT_HEADERS, DirectoryFetchError, directory_pool
from .profile_hub_execution import https_url

router = APIRouter()

# These limits bound untrusted remote HTML/images, redirects, memory and work;
# they are transport safeguards, not source-specific or product limits.
MAX_HTML_BYTES = 512 * 1024
MAX_ICON_BYTES = 128 * 1024
MAX_ICON_PIXELS = 1024 * 1024
MAX_ICON_LINKS = 4
MAX_REDIRECTS = 4
LOOKUP_TIMEOUT_SECONDS = 8
MAX_CONCURRENT_LOOKUPS = 4
# Allow several full batches to drain; canceled clients release their queue slots.
ADMISSION_TIMEOUT_SECONDS = LOOKUP_TIMEOUT_SECONDS * MAX_CONCURRENT_LOOKUPS + 1
CACHE_ITEMS = 64
CACHE_SUCCESS_SECONDS = 3600
CACHE_FAILURE_SECONDS = 2
DEFAULT_ICON_PATH = "/favicon.ico"  # Conventional browser fallback, not an assumed source capability.

_slots = asyncio.Semaphore(MAX_CONCURRENT_LOOKUPS)
_cache: OrderedDict[str, tuple[float, tuple[bytes, str] | None]] = OrderedDict()
_BUSY = object()


class _InFlight:
    def __init__(self, task: asyncio.Task):
        self.task = task
        self.waiters = 0


_inflight: dict[str, _InFlight] = {}


def _checked_url(value: str) -> str:
    value = urldefrag(value)[0]
    https_url(value)
    return value


def _checked_origin(value: str) -> str:
    # The caller sends an origin only: never transmit a profile path/query.
    https_url(value)
    parts = urlsplit(value)
    if parts.path not in ("", "/") or parts.query or parts.fragment:
        raise ValueError("expected_origin")
    return urlunsplit(("https", parts.netloc.lower(), "", "", ""))


class _IconLinks(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.links: list[str] = []
        self.base_href: str | None = None

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        values = dict(attrs)
        if tag == "base" and self.base_href is None and values.get("href") is not None:
            self.base_href = values["href"].strip()
            return
        if tag != "link" or len(self.links) >= MAX_ICON_LINKS:
            return
        rel = (values.get("rel") or "").lower().split()
        href = (values.get("href") or "").strip()
        if href and ("icon" in rel or "apple-touch-icon" in rel):
            self.links.append(href)


async def _get(pool, url: str, limit: int, *, expect_html: bool):
    current = _checked_url(url)
    seen: set[str] = set()
    headers = {
        "User-Agent": DEFAULT_TRANSPORT_HEADERS["User-Agent"],
        "Accept": "text/html,application/xhtml+xml" if expect_html else "image/*,application/octet-stream",
        "Accept-Encoding": "identity",
    }
    for _ in range(MAX_REDIRECTS + 1):
        if current in seen:
            raise ValueError("redirect_loop")
        seen.add(current)
        async with pool.stream("GET", current, headers=headers,
                               extensions={"timeout": {"connect": 4, "read": 4, "write": 4, "pool": 4}}) as response:
            received = {k.decode("ascii").lower(): v.decode("latin-1") for k, v in response.headers}
            if response.status in (301, 302, 303, 307, 308):
                location = received.get("location")
                if not location:
                    raise ValueError("redirect_without_location")
                current = _checked_url(urljoin(current, location))
                continue
            if response.status != 200:
                raise ValueError("upstream_unavailable")
            if received.get("content-encoding", "identity").lower() != "identity":
                raise ValueError("unsupported_encoding")
            content_type = received.get("content-type", "").split(";", 1)[0].strip().lower()
            if expect_html:
                if content_type not in ("text/html", "application/xhtml+xml"):
                    raise ValueError("expected_html")
            elif content_type and not (content_type.startswith("image/") or content_type == "application/octet-stream"):
                raise ValueError("expected_image")
            if content_type == "image/svg+xml":
                raise ValueError("unsupported_vector")
            declared = received.get("content-length", "")
            if not expect_html and declared.isdigit() and int(declared) > limit:
                raise ValueError("response_too_large")
            body = bytearray()
            async for chunk in response.aiter_stream():
                if len(body) + len(chunk) > limit:
                    if not expect_html:
                        raise ValueError("response_too_large")
                    # Icons are usually declared near the start of the document.
                    # Inspect a bounded prefix instead of discarding a large page.
                    body.extend(chunk[:limit - len(body)])
                    break
                body.extend(chunk)
                if expect_html and len(body) == limit:
                    break
            return current, bytes(body)
    raise ValueError("redirect_limit")


def _validated_icon(data: bytes) -> tuple[bytes, str]:
    # Render only bounded raster formats; never relay active SVG/HTML content.
    media = {"PNG": "image/png", "JPEG": "image/jpeg", "GIF": "image/gif", "WEBP": "image/webp", "ICO": "image/x-icon"}
    with warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        with Image.open(BytesIO(data)) as image:
            if image.format not in media or image.width < 1 or image.height < 1 or image.width * image.height > MAX_ICON_PIXELS:
                raise ValueError("invalid_icon")
            content_type = media[image.format]
            image.verify()
    return data, content_type


def _icon_pool():
    # Prefer the maintained public roots, while retaining the system's custom
    # trust roots. Hostname and certificate validation stay enabled for all sites.
    context = ssl.create_default_context(cafile=certifi.where())
    context.load_default_certs()
    return directory_pool(ssl_context=context)


async def _lookup(origin: str) -> tuple[bytes, str] | None:
    async with _icon_pool() as pool:
        candidates: list[str] = []
        try:
            page_url, html = await _get(pool, origin + "/", MAX_HTML_BYTES, expect_html=True)
            parser = _IconLinks()
            parser.feed(html.decode("utf-8", errors="replace"))
            try:
                # Resolve locally first; only the final icon URL is requested,
                # and each such destination is validated below.
                base_url = urljoin(page_url, parser.base_href) if parser.base_href is not None else page_url
            except ValueError:
                base_url = None
            for href in parser.links:
                try:
                    candidate = _checked_url(urljoin(base_url, href) if base_url is not None else href)
                except ValueError:
                    continue
                if candidate not in candidates:
                    candidates.append(candidate)
        except (ValueError, DirectoryFetchError, httpcore.NetworkError, httpcore.TimeoutException, httpcore.ProtocolError, OSError):
            pass
        conventional = origin + DEFAULT_ICON_PATH
        if conventional not in candidates:
            candidates.append(conventional)
        for candidate in candidates:
            try:
                _, image = await _get(pool, candidate, MAX_ICON_BYTES, expect_html=False)
                return _validated_icon(image)
            except (ValueError, DirectoryFetchError, httpcore.NetworkError, httpcore.TimeoutException, httpcore.ProtocolError,
                    OSError, SyntaxError, UnidentifiedImageError, Image.DecompressionBombWarning, Image.DecompressionBombError):
                continue
        return None


async def _bounded_lookup(origin: str):
    try:
        await asyncio.wait_for(_slots.acquire(), timeout=ADMISSION_TIMEOUT_SECONDS)
    except TimeoutError:
        return _BUSY
    try:
        async with asyncio.timeout(LOOKUP_TIMEOUT_SECONDS):
            return await _lookup(origin)
    except (TimeoutError, DirectoryFetchError, httpcore.NetworkError, httpcore.TimeoutException, httpcore.ProtocolError, OSError, ValueError):
        return None
    finally:
        _slots.release()


async def _lookup_and_cache(origin: str):
    result = await _bounded_lookup(origin)
    if result is _BUSY:
        return _BUSY
    ttl = CACHE_SUCCESS_SECONDS if result else CACHE_FAILURE_SECONDS
    _cache[origin] = (time.monotonic() + ttl, result)
    _cache.move_to_end(origin)
    while len(_cache) > CACHE_ITEMS:
        _cache.popitem(last=False)
    return result


async def _icon_for(origin: str):
    cached = _cache.get(origin)
    if cached and cached[0] > time.monotonic():
        _cache.move_to_end(origin)
        return cached[1]
    _cache.pop(origin, None)
    entry = _inflight.get(origin)
    if entry is None:
        task = asyncio.create_task(_lookup_and_cache(origin))
        entry = _InFlight(task)
        _inflight[origin] = entry
        def finish(done):
            if _inflight.get(origin) is entry:
                _inflight.pop(origin, None)
            if not done.cancelled():
                done.exception()
        task.add_done_callback(finish)
    entry.waiters += 1
    try:
        # One canceled tab must not cancel another tab's identical request.
        return await asyncio.shield(entry.task)
    finally:
        entry.waiters -= 1
        if not entry.waiters and not entry.task.done():
            if _inflight.get(origin) is entry:
                _inflight.pop(origin, None)
            entry.task.cancel()


async def _watch_disconnect(request: Request):
    while True:
        if (await request.receive()).get("type") == "http.disconnect":
            return


@router.get("/site-icon")
async def site_icon(request: Request, origin: str = Query(..., max_length=4096)):
    try:
        normalized = _checked_origin(origin)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="invalid_origin") from exc
    lookup = asyncio.create_task(_icon_for(normalized))
    disconnected = asyncio.create_task(_watch_disconnect(request))
    try:
        done, _ = await asyncio.wait((lookup, disconnected), return_when=asyncio.FIRST_COMPLETED)
        if lookup not in done:
            return Response(status_code=499, headers={"Cache-Control": "no-store"})
        icon = lookup.result()
    finally:
        if not lookup.done():
            lookup.cancel()
        if not disconnected.done():
            disconnected.cancel()
        await asyncio.gather(lookup, disconnected, return_exceptions=True)
    if icon is _BUSY:
        return Response(status_code=503, headers={"Cache-Control": "no-store"})
    if icon is None:
        return Response(status_code=404, headers={"Cache-Control": f"private, max-age={CACHE_FAILURE_SECONDS}"})
    body, media_type = icon
    return Response(body, media_type=media_type, headers={
        "Cache-Control": f"private, max-age={CACHE_SUCCESS_SECONDS}",
        "X-Content-Type-Options": "nosniff",
    })
