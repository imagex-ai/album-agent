"""Unified SSRF-safe batch profile/creator/artist/commenter avatar resolver.

Single backend entry point for resolving missing profile photos asynchronously
across registered and future providers using pinned public DNS transport,
bounded streaming reads, per-host rate limiting, single-flight coalescing,
and dual-TTL caching (long positive TTL, negative TTL for confirmed empty
profiles, short error backoff for transient/challenge failures).
"""
from __future__ import annotations

import asyncio
from collections import OrderedDict
from dataclasses import dataclass
import time
from urllib.parse import urljoin, urlsplit

from fastapi import APIRouter, Query
import httpx
from pydantic import BaseModel, Field

from .profile_directory_transport import DEFAULT_TRANSPORT_HEADERS
from .profile_hub_avatar_extractors import (
    extract_structured_profile_avatar,
    looks_like_challenge_page,
)
from .profile_hub_execution_runtime import PublicHTTPSHttpxTransport
from .profile_hub_providers import canonicalize_profile_url, resolve_provider

MAX_AVATAR_BATCH_SIZE = 24
MAX_AVATAR_HTML_BYTES = 2 * 1024 * 1024
MAX_AVATAR_REDIRECTS = 3
AVATAR_FETCH_TIMEOUT_SECONDS = 12.0
RESOLVE_TIMEOUT_PADDING_SECONDS = 2.0

FOUND_TTL_SECONDS = 3600.0
NEGATIVE_TTL_SECONDS = 900.0
ERROR_TTL_SECONDS = 60.0
MAX_CACHE_ENTRIES = 2048
MAX_HOST_SEMAPHORES = 256

router = APIRouter()

_GLOBAL_SEMAPHORE = asyncio.Semaphore(6)
_HOST_SEMAPHORES: OrderedDict[str, asyncio.Semaphore] = OrderedDict()
_AVATAR_CACHE: OrderedDict[str, tuple[float, dict]] = OrderedDict()
_INFLIGHT: dict[str, "_PendingAvatarResolve"] = {}


class AvatarFetchError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


@dataclass
class _PendingAvatarResolve:
    task: asyncio.Task
    readers: int = 0


def clear_avatar_cache() -> None:
    """Clear avatar resolution caches and reset inflight tracking (tests)."""
    _AVATAR_CACHE.clear()
    _INFLIGHT.clear()
    _HOST_SEMAPHORES.clear()


def _cache_key(canonical_url: str) -> str:
    parts = urlsplit(canonical_url)
    host = (parts.hostname or "").lower().removeprefix("www.").removeprefix("m.")
    path = parts.path.rstrip("/") or "/"
    query = f"?{parts.query}" if parts.query else ""
    return f"https://{host}{path}{query}"


def _host_semaphore(canonical_url: str) -> asyncio.Semaphore:
    host = (urlsplit(canonical_url).hostname or "").lower().removeprefix("www.").removeprefix("m.") or "default"
    sem = _HOST_SEMAPHORES.get(host)
    if sem is None:
        while len(_HOST_SEMAPHORES) >= MAX_HOST_SEMAPHORES:
            _HOST_SEMAPHORES.popitem(last=False)
        sem = asyncio.Semaphore(2)
        _HOST_SEMAPHORES[host] = sem
    else:
        _HOST_SEMAPHORES.move_to_end(host)
    return sem


def _get_cached(key: str) -> dict | None:
    item = _AVATAR_CACHE.get(key)
    if item is None:
        return None
    expires_at, payload = item
    if expires_at <= time.monotonic():
        _AVATAR_CACHE.pop(key, None)
        return None
    _AVATAR_CACHE.move_to_end(key)
    return dict(payload)


def _set_cached(key: str, payload: dict, ttl: float) -> None:
    if key in _AVATAR_CACHE:
        _AVATAR_CACHE.pop(key, None)
    while len(_AVATAR_CACHE) >= MAX_CACHE_ENTRIES:
        _AVATAR_CACHE.popitem(last=False)
    _AVATAR_CACHE[key] = (time.monotonic() + ttl, dict(payload))


def _make_public_async_client(timeout: float) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        transport=PublicHTTPSHttpxTransport(),
        follow_redirects=False,
        timeout=timeout,
        headers={
            **DEFAULT_TRANSPORT_HEADERS,
            "Accept-Encoding": "identity",
        },
    )


async def _fetch_public_profile_html(canonical_url: str) -> tuple[str, str]:
    provider = resolve_provider(canonical_url)
    max_bytes = min(int(provider.max_html_bytes or MAX_AVATAR_HTML_BYTES), MAX_AVATAR_HTML_BYTES)
    current = canonical_url

    async with _make_public_async_client(AVATAR_FETCH_TIMEOUT_SECONDS) as client:
        for _hop in range(MAX_AVATAR_REDIRECTS + 1):
            async with client.stream("GET", current) as response:
                if response.status_code in (301, 302, 303, 307, 308):
                    location = response.headers.get("location")
                    if not location:
                        raise AvatarFetchError("unavailable")
                    nxt = canonicalize_profile_url(urljoin(current, location))
                    if not nxt:
                        raise AvatarFetchError("invalid_url")
                    current = nxt
                    continue

                if response.status_code in (401, 403, 429, 503):
                    raise AvatarFetchError("challenge" if response.status_code in (403, 503) else "unavailable")
                if response.status_code >= 400:
                    raise AvatarFetchError("unavailable")

                ct = (response.headers.get("content-type") or "").split(";", 1)[0].strip().lower()
                if ct and ct not in ("text/html", "application/xhtml+xml", "text/plain"):
                    raise AvatarFetchError("unavailable")

                chunks = bytearray()
                async for chunk in response.aiter_bytes():
                    remaining = max_bytes - len(chunks)
                    if remaining <= 0:
                        break
                    chunks.extend(chunk[:remaining])
                return current, bytes(chunks).decode("utf-8", errors="replace")

    raise AvatarFetchError("unavailable")


async def _resolve_uncached(canonical_url: str) -> dict:
    provider = resolve_provider(canonical_url)
    host_sem = _host_semaphore(canonical_url)
    try:
        timeout_budget = max(0.05, float(AVATAR_FETCH_TIMEOUT_SECONDS) + float(RESOLVE_TIMEOUT_PADDING_SECONDS))
        async with host_sem, _GLOBAL_SEMAPHORE:
            async with asyncio.timeout(timeout_budget):
                final_url, html = await _fetch_public_profile_html(canonical_url)
    except (TimeoutError, httpx.TimeoutException):
        return {
            "canonical_url": canonical_url,
            "provider": provider.provider_id,
            "status": "error",
            "avatar_url": None,
            "confirmed_empty": False,
            "cached": False,
            "error_code": "timeout",
        }
    except AvatarFetchError as exc:
        return {
            "canonical_url": canonical_url,
            "provider": provider.provider_id,
            "status": "error",
            "avatar_url": None,
            "confirmed_empty": False,
            "cached": False,
            "error_code": exc.code,
        }
    except Exception:
        return {
            "canonical_url": canonical_url,
            "provider": provider.provider_id,
            "status": "error",
            "avatar_url": None,
            "confirmed_empty": False,
            "cached": False,
            "error_code": "unavailable",
        }

    # Re-resolve provider in case canonical host alias redirected cleanly.
    final_provider = resolve_provider(final_url) if final_url else provider
    avatar_url, confirmed_empty = await asyncio.to_thread(
        extract_structured_profile_avatar,
        html,
        final_url or canonical_url,
        provider_spec=final_provider,
    )
    if avatar_url:
        return {
            "canonical_url": final_url or canonical_url,
            "provider": final_provider.provider_id,
            "status": "found",
            "avatar_url": avatar_url,
            "confirmed_empty": False,
            "cached": False,
            "error_code": None,
        }
    if confirmed_empty:
        return {
            "canonical_url": final_url or canonical_url,
            "provider": final_provider.provider_id,
            "status": "not_found",
            "avatar_url": None,
            "confirmed_empty": True,
            "cached": False,
            "error_code": None,
        }
    is_challenge = looks_like_challenge_page(html)
    return {
        "canonical_url": final_url or canonical_url,
        "provider": final_provider.provider_id,
        "status": "error",
        "avatar_url": None,
        "confirmed_empty": False,
        "cached": False,
        "error_code": "challenge" if is_challenge else "unavailable",
    }


async def _resolve_single_canonical(canonical_url: str, *, force: bool = False) -> dict:
    key = _cache_key(canonical_url)
    if not force:
        cached = _get_cached(key)
        if cached is not None:
            cached["cached"] = True
            return cached

    entry = _INFLIGHT.get(key)
    if entry is None:
        async def run_and_cache() -> dict:
            try:
                result = await _resolve_uncached(canonical_url)
                if result["status"] == "found":
                    _set_cached(key, result, FOUND_TTL_SECONDS)
                elif result["status"] == "not_found" and result["confirmed_empty"]:
                    _set_cached(key, result, NEGATIVE_TTL_SECONDS)
                else:
                    _set_cached(key, result, ERROR_TTL_SECONDS)
                return result
            finally:
                if _INFLIGHT.get(key) is entry:
                    _INFLIGHT.pop(key, None)

        entry = _PendingAvatarResolve(asyncio.create_task(run_and_cache(), name="Profile Hub avatar resolve"))
        _INFLIGHT[key] = entry

    entry.readers += 1
    try:
        result = await asyncio.shield(entry.task)
        return dict(result)
    finally:
        entry.readers -= 1
        if entry.readers == 0:
            if _INFLIGHT.get(key) is entry:
                _INFLIGHT.pop(key, None)
            if not entry.task.done():
                entry.task.cancel()
                await asyncio.gather(entry.task, return_exceptions=True)


async def resolve_single_avatar(raw_url: str, *, force: bool = False) -> dict:
    """Resolve one profile URL safely and preserve caller-supplied `url`."""
    canonical = canonicalize_profile_url(raw_url)
    if not canonical:
        return {
            "url": raw_url,
            "canonical_url": None,
            "provider": "invalid",
            "status": "invalid",
            "avatar_url": None,
            "confirmed_empty": False,
            "cached": False,
            "error_code": "invalid_url",
        }
    resolved = await _resolve_single_canonical(canonical, force=force)
    resolved["url"] = raw_url
    return resolved


async def resolve_avatars(urls: list[str], *, force: bool = False) -> dict[str, dict]:
    """Batch-resolve profile URLs concurrently with deduplication by canonical identity."""
    unique_raw: list[str] = []
    seen_raw: set[str] = set()
    for raw in urls:
        if raw in seen_raw:
            continue
        seen_raw.add(raw)
        unique_raw.append(raw)

    resolved_list = await asyncio.gather(
        *(resolve_single_avatar(raw, force=force) for raw in unique_raw)
    )
    return {entry["url"]: entry for entry in resolved_list}


class AvatarResolveBatchRequest(BaseModel):
    urls: list[str] = Field(min_length=1, max_length=MAX_AVATAR_BATCH_SIZE)
    force: bool = False


@router.post("/avatars/resolve")
async def post_resolve_avatars(body: AvatarResolveBatchRequest):
    results = await resolve_avatars(body.urls, force=body.force)
    return {"results": results}


@router.get("/avatars/resolve-single")
async def get_resolve_single_avatar(
    url: str = Query(min_length=1, max_length=4096),
    force: bool = False,
):
    return await resolve_single_avatar(url, force=force)
