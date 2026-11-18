"""Read-only directory API. Import-safe: no library or application startup."""
import asyncio
import json
import re
from urllib.parse import urlsplit
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import Field

from .profile_directory_manifest import (
    ContractModel, DirectoryInputError, DirectoryPage, DirectoryStructureError,
    recognize_profile_input,
)
from .profile_directory_transport import (
    DirectoryFetchError, fetch_directory_html, fetch_profile_metadata_html,
)
from .profile_site_icon_service import router as profile_site_icon_router

router = APIRouter(prefix="/api/profile-directory", tags=["Profile Hub directories"])
_discovery_slots = asyncio.Semaphore(2)
_META_CACHE: dict[str, dict] = {}
_META_SEMAPHORE = asyncio.Semaphore(15)
# Preserve the enrichment's short upstream deadline after adopting the shared
# listing transport (whose own deadline also covers longer directory discovery).
METADATA_FETCH_TIMEOUT_SECONDS = 5.0


def _extract_meta_from_html(html: str, source_url: str = "") -> dict:
    result = {"image_url": None, "video_count": None, "photo_count": None, "description": None, "gender": None}
    m = re.search(r'window\.initials\s*=\s*(\{.*?\});\s*</script>', html)
    data = None
    if m:
        try:
            data = json.loads(m.group(1))
        except Exception:
            pass

    def find_val(obj, key):
        if isinstance(obj, dict):
            if key in obj and obj[key] is not None:
                return obj[key]
            for v in obj.values():
                res = find_val(v, key)
                if res is not None:
                    return res
        elif isinstance(obj, list):
            for item in obj:
                res = find_val(item, key)
                if res is not None:
                    return res
        return None

    if data:
        thumb = find_val(data, "thumbUrl") or find_val(data, "thumbURL")
        vc = find_val(data, "videoCount")
        if vc is None:
            vc = find_val(data, "videosCount")
        if isinstance(vc, int) and not isinstance(vc, bool) and vc >= 0:
            result["video_count"] = vc
        views = find_val(data, "viewsCount") or find_val(data, "views")
        country = find_val(data, "translatedCountryName") or find_val(data, "country")
        desc_parts = []
        if views:
            if isinstance(views, int):
                if views >= 1_000_000:
                    desc_parts.append(f"{views/1_000_000:.1f}M views")
                elif views >= 1_000:
                    desc_parts.append(f"{views/1_000:.1f}K views")
                else:
                    desc_parts.append(f"{views} views")
        if country:
            desc_parts.append(str(country).title())
        if desc_parts:
            result["description"] = " • ".join(desc_parts)

        raw_gender = find_val(data, "gender")
        g_name = None
        if isinstance(raw_gender, dict):
            g_name = (raw_gender.get("name") or "").lower()
        elif isinstance(raw_gender, str):
            g_name = raw_gender.lower()
        if g_name in ("male", "masculino", "man", "m"):
            result["gender"] = "male"
        elif g_name in ("female", "feminino", "woman", "f"):
            result["gender"] = "female"
        elif g_name in ("trans", "transgender", "shemale", "transgênero"):
            result["gender"] = "trans"
    else:
        thumb = None

    if not thumb:
        matches = re.findall(r'https?://[a-zA-Z0-9.\-_]*xhcdn\.com[^\s"\'\\]+', html)
        for cand in matches:
            cand = cand.replace(r"\/", "/")
            if any(ext in cand.lower() for ext in (".jpg", ".jpeg", ".png", ".webp")) and not any(x in cand.lower() for x in ("logo", "icon", "blank", "placeholder")):
                thumb = cand
                break

    if not thumb and source_url:
        from .profile_hub_avatar_extractors import extract_structured_profile_avatar
        from .profile_hub_providers import resolve_provider

        thumb, _ = extract_structured_profile_avatar(
            html,
            source_url,
            provider_spec=resolve_provider(source_url),
        )

    result["image_url"] = thumb
    return result


async def _fetch_meta_url(url: str) -> tuple[str, dict]:
    try:
        # Validate before cache access as well as before network creation. The
        # metadata API enriches installed directory profiles, not arbitrary URLs.
        adapter, kind = recognize_profile_input(url)
        if kind != 'profile':
            return url, {}
        canonical = adapter.normalize_url(url, kind='profile')
        # Some legacy resolvers recognize mirror-like host spellings broadly.
        # Enrichment receives canonical directory links; only the canonical
        # owner and its subdomains may claim that profile identity here.
        owner = (urlsplit(canonical).hostname or '').removeprefix('www.')
        supplied_host = urlsplit(url).hostname or ''
        if supplied_host != owner and not supplied_host.endswith('.' + owner):
            return url, {}
        if canonical in _META_CACHE:
            return url, _META_CACHE[canonical]
        async with _META_SEMAPHORE:
            async with asyncio.timeout(METADATA_FETCH_TIMEOUT_SECONDS):
                _, html = await fetch_profile_metadata_html(adapter, canonical)
            meta = _extract_meta_from_html(html, canonical)
            _META_CACHE[canonical] = meta
            return url, meta
    except Exception:
        pass
    return url, {}


class BatchMetaRequest(ContractModel):
    urls: list[str] = Field(min_length=1, max_length=100)


class DirectoryDiscoveryRequest(ContractModel):
    url: str = Field(min_length=1, max_length=4096)
    page_url: str | None = Field(default=None, max_length=4096)


class ProfileHubInputResolution(ContractModel):
    kind: Literal["directory", "profile", "existing_profile_scan"]
    url: str
    adapter_id: str | None = None


@router.post("/resolve", response_model=ProfileHubInputResolution)
async def resolve_profile_hub_input(request: DirectoryDiscoveryRequest):
    """Recognize installed adapters; leave older profile scanning behavior intact.

    existing_profile_scan does not claim that an unknown site is supported. It
    delegates validation/discovery to the existing Hub, without fetching here.
    """
    try:
        adapter, kind = recognize_profile_input(request.url)
        return ProfileHubInputResolution(kind=kind, url=adapter.normalize_url(request.url, kind=kind), adapter_id=adapter.adapter_id)
    except DirectoryInputError:
        try:
            parts = urlsplit(request.url)
            valid = (parts.scheme in ("http", "https") and parts.hostname and not parts.username
                     and not parts.password and not any(ord(c) < 33 for c in request.url))
            _ = parts.port
        except ValueError:
            valid = False
        if not valid:
            raise HTTPException(status_code=422, detail={"code": "invalid_profile_hub_url", "recoverable": True})
        return ProfileHubInputResolution(kind="existing_profile_scan", url=request.url)


@router.post("/discover", response_model=DirectoryPage)
async def discover_directory(request: DirectoryDiscoveryRequest):
    try:
        adapter, kind = recognize_profile_input(request.url)
        if kind != "directory":
            raise DirectoryInputError("expected_directory_url")
        source = adapter.normalize_url(request.url)
        target = adapter.normalize_url(request.page_url) if request.page_url else source
        if adapter.context_url(target) != adapter.context_url(source):
            raise DirectoryInputError("page_context_mismatch")
    except DirectoryInputError as exc:
        raise HTTPException(status_code=422, detail={"code": str(exc), "recoverable": True}) from exc
    try:
        # At most two upstream calls per worker, with a bounded admission wait.
        await asyncio.wait_for(_discovery_slots.acquire(), timeout=5)
    except TimeoutError as exc:
        raise HTTPException(status_code=503, detail={"code": "directory_busy", "recoverable": True}, headers={"Retry-After": "5"}) from exc
    try:
        final_url, html = await fetch_directory_html(adapter, target)
        return await asyncio.to_thread(adapter.parse, final_url, html)
    except DirectoryFetchError as exc:
        headers = {"Retry-After": exc.retry_after} if exc.retry_after else None
        raise HTTPException(status_code=exc.status, detail={"code": exc.code, "recoverable": True}, headers=headers) from exc
    except DirectoryStructureError as exc:
        raise HTTPException(status_code=502, detail={"code": str(exc), "recoverable": True}) from exc
    finally:
        _discovery_slots.release()


@router.post("/batch-meta")
async def batch_meta(request: BatchMetaRequest):
    results = await asyncio.gather(*[_fetch_meta_url(u) for u in request.urls])
    return {"profiles": dict(results)}


@router.get("/avatar")
async def get_avatar(url: str):
    _, meta = await _fetch_meta_url(url)
    return {"image_url": meta.get("image_url")}


router.include_router(profile_site_icon_router)
