"""Dynamic Original Photo Resolution Service.

Provides on-demand resolution of full-resolution original images from photo viewer pages
and CDN pattern induction across multiple gallery hosts (Pornhub, Eporner, generic galleries),
with physical binary validation (dimensions, file size, format) and in-memory caching.
"""
from __future__ import annotations

import asyncio
import io
import re
import struct
import time
from typing import Dict, Optional
from urllib.parse import urljoin, urlsplit

import httpx
from PIL import Image
from pydantic import BaseModel
from selectolax.lexbor import LexborHTMLParser

DEFAULT_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9,pt-BR;q=0.8,pt;q=0.7",
}

RE_EXCLUDED_ASSET = re.compile(
    r"(?:logo|icon|banner|avatar|advert|sprite|flag|flags|lang|button|badge|catimg|nav|blank|rating|pixel|arrow|spinner|widget|track|\.svg$|ENG\.PNG)",
    re.IGNORECASE,
)

CACHE_MAX_SIZE = 5000
_RESOLVED_CACHE: Dict[str, PhotoResolveResult] = {}


class PhotoResolveRequest(BaseModel):
    photo_id: Optional[str] = None
    page_url: Optional[str] = None
    thumbnail_url: str
    source_page: Optional[str] = None


class PhotoResolveResult(BaseModel):
    success: bool
    photo_id: Optional[str] = None
    original_url: str
    width: int = 0
    height: int = 0
    file_size: int = 0
    format: str = "jpg"
    is_resolved: bool = False
    elapsed_seconds: float = 0.0


def _cache_key(page_url: Optional[str], thumb_url: str) -> str:
    return f"{(page_url or '').strip()}::{(thumb_url or '').strip()}"


def _parse_binary_dimensions(data: bytes) -> tuple[int, int, str]:
    """Fast binary parsing of image dimensions without decompressing full raster data."""
    if len(data) >= 24 and data.startswith(b"\x89PNG\r\n\x1a\n") and data[12:16] == b"IHDR":
        w, h = struct.unpack(">II", data[16:24])
        return w, h, "png"
    if len(data) >= 10 and (data.startswith(b"GIF87a") or data.startswith(b"GIF89a")):
        w, h = struct.unpack("<HH", data[6:10])
        return w, h, "gif"
    if len(data) >= 30 and data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        if data[12:16] == b"VP8 ":
            w = struct.unpack("<H", data[26:28])[0] & 0x3FFF
            h = struct.unpack("<H", data[28:30])[0] & 0x3FFF
            return w, h, "webp"
        elif data[12:16] == b"VP8L" and len(data) >= 25:
            b0, b1, b2, b3 = data[21:25]
            w = 1 + (((b1 & 0x3F) << 8) | b0)
            h = 1 + (((b3 & 0xF) << 10) | (b2 << 2) | ((b1 & 0xC0) >> 6))
            return w, h, "webp"
    try:
        im = Image.open(io.BytesIO(data))
        return im.size[0], im.size[1], (im.format or "jpg").lower()
    except Exception:
        pass
    return 0, 0, "jpg"


async def resolve_photo_original(req: PhotoResolveRequest) -> PhotoResolveResult:
    """Dynamically resolves the true high-resolution original image URL for a given photo."""
    key = _cache_key(req.page_url, req.thumbnail_url)
    if key in _RESOLVED_CACHE:
        cached = _RESOLVED_CACHE[key]
        return cached.model_copy(update={"photo_id": req.photo_id or cached.photo_id})

    t0 = time.time()
    resolved_url: Optional[str] = None
    is_resolved = False
    width = 0
    height = 0
    file_size = 0
    fmt = "jpg"

    page_url = (req.page_url or "").strip()
    thumb_url = (req.thumbnail_url or "").strip()
    source_page = (req.source_page or "").strip()
    referer = source_page or page_url

    req_headers = dict(DEFAULT_HEADERS)
    if referer:
        req_headers["Referer"] = referer

    # 1. Scrape Photo Viewer Page if available
    if page_url and page_url.startswith("http"):
        try:
            async with httpx.AsyncClient(timeout=15, follow_redirects=True, headers=req_headers) as client:
                resp = await client.get(page_url)
                if ("pornhub.com" in page_url or "phncdn.com" in page_url) and resp.status_code == 200:
                    for _ in range(3):
                        if "leastFactor" not in resp.text:
                            break
                        from .profile_directory_transport import solve_js_challenge
                        solved = await asyncio.to_thread(solve_js_challenge, resp.text)
                        if solved:
                            for k, v in solved.items():
                                for domain in (".pornhub.com", "pornhub.com", "www.pornhub.com"):
                                    try:
                                        client.cookies.set(k.strip(), v.strip(), domain=domain)
                                    except Exception:
                                        pass
                        else:
                            m_ck = re.search(r"document\.cookie\s*=\s*[\"']([^\"']+)[\"']", resp.text)
                            if m_ck:
                                ck = m_ck.group(1).split(";")[0]
                                if "=" in ck:
                                    k, v = ck.split("=", 1)
                                    for domain in (".pornhub.com", "pornhub.com", "www.pornhub.com"):
                                        try:
                                            client.cookies.set(k.strip(), v.strip(), domain=domain)
                                        except Exception:
                                            pass
                        await asyncio.sleep(0.2)
                        resp = await client.get(page_url)
                if resp.status_code == 200:
                    tree = LexborHTMLParser(resp.text)
                    candidate_urls = []

                    # A. Pornhub photo page
                    if "pornhub.com" in page_url:
                        for img in tree.css("#photoWrapper img, div.photoWrapper img, #photoImageSection img, .centerImage img"):
                            src = img.attributes.get("src") or img.attributes.get("data-src") or ""
                            if src and "users/" not in src and "avatar" not in src and "blank.gif" not in src:
                                if "original_" in src and ("rs:fit:" in src or "plain/" in src):
                                    candidate_urls.append(urljoin(page_url, src))
                        # Prioritize higher-resolution Pornhub candidates over thumbnail strips
                        candidate_urls.sort(
                            key=lambda u: (
                                0 if ("rs:fit:200:250" in u or "rs:fit:150:188" in u) else 1
                            ),
                            reverse=True,
                        )

                    # B. Eporner photo page (ultra-high resolution 5000x3333)
                    if "eporner.com" in page_url:
                        for a in tree.css('a[href*="/gallery/"]'):
                            href = a.attributes.get("href") or ""
                            if re.search(r"\.(?:jpe?g|png|webp)(?:\?|$)", href, re.I):
                                candidate_urls.append(urljoin(page_url, href))
                        for sel in ["img.mainphoto", "#mainphoto", "img#mainphoto", ".mainphoto"]:
                            mp = tree.css_first(sel)
                            if mp:
                                src = mp.attributes.get("src") or mp.attributes.get("data-src") or ""
                                if src and not RE_EXCLUDED_ASSET.search(src):
                                    orig = re.sub(r"_\d+x\d+\.(jpe?g|png|webp|gif)(\?.*)?$", r".\1\2", src, flags=re.I)
                                    candidate_urls.append(urljoin(page_url, orig))

                    # C. Generic high-priority gallery selectors
                    for sel in [
                        "a[href*='download'][href*='.']",
                        "img#show_image",
                        "img.main-image",
                        "img.mainphoto",
                        "img#mainphoto",
                        ".mainphoto",
                        "img.centred",
                        "img.centred_element",
                        "img#photo_img",
                        "div.photo-box img",
                        "div#image-container img",
                        "div.image-container img",
                        "img#image",
                        "div#photo img",
                        "div.photo img",
                        "#photo img",
                        "#thepic",
                    ]:
                        node = tree.css_first(sel)
                        if node:
                            s = node.attributes.get("src") or node.attributes.get("data-src") or node.attributes.get("href")
                            if s and not s.startswith("data:") and not RE_EXCLUDED_ASSET.search(s):
                                candidate_urls.append(urljoin(page_url, s))

                    # D. OpenGraph fallback
                    if not candidate_urls:
                        og = tree.css_first('meta[property="og:image"]')
                        if og:
                            s = og.attributes.get("content") or ""
                            if s and not RE_EXCLUDED_ASSET.search(s):
                                candidate_urls.append(urljoin(page_url, s))

                    # Filter out any blacklisted UI/flag assets
                    valid_candidates = [c for c in candidate_urls if not RE_EXCLUDED_ASSET.search(c)]
                    if valid_candidates:
                        resolved_url = valid_candidates[0]
                        is_resolved = True
        except Exception:
            pass

    # 2. Fast Pattern Deduction on Thumbnail URL
    if not is_resolved and thumb_url and thumb_url.startswith("http"):
        # Pattern A: Eporner dimensions (_880x660.jpg -> .jpg)
        m_ep = re.search(r'_\d+x\d+\.(jpe?g|png|webp|gif)(\?.*)?$', thumb_url, re.I)
        if m_ep:
            cand = re.sub(r'_\d+x\d+\.(jpe?g|png|webp|gif)(\?.*)?$', r'.\1\2', thumb_url, flags=re.I)
            try:
                async with httpx.AsyncClient(timeout=6, follow_redirects=True, headers=req_headers) as client:
                    head_res = await client.head(cand)
                    if head_res.status_code == 200:
                        resolved_url = cand
                        is_resolved = True
            except Exception:
                pass

        # Pattern B: Generic thumbnail suffixes (-thumb, _thumb, _small, _preview)
        if not is_resolved:
            m_gen = re.search(r'[-_](?:thumb|small|preview|thumb_b)\.(jpe?g|png|webp|gif)(\?.*)?$', thumb_url, re.I)
            if m_gen:
                cand = re.sub(r'[-_](?:thumb|small|preview|thumb_b)\.(jpe?g|png|webp|gif)(\?.*)?$', r'.\1\2', thumb_url, flags=re.I)
                try:
                    async with httpx.AsyncClient(timeout=6, follow_redirects=True, headers=req_headers) as client:
                        head_res = await client.head(cand)
                        if head_res.status_code == 200:
                            resolved_url = cand
                            is_resolved = True
                except Exception:
                    pass

        # Pattern C: PornPics thumbnail to 1280 original (/460/ -> /1280/)
        if not is_resolved and "cdni.pornpics.com/460/" in thumb_url:
            cand = thumb_url.replace("/460/", "/1280/")
            try:
                async with httpx.AsyncClient(timeout=6, follow_redirects=True, headers=req_headers) as client:
                    head_res = await client.head(cand)
                    if head_res.status_code == 200:
                        resolved_url = cand
                        is_resolved = True
            except Exception:
                pass

        # Pattern D: imx.to forum image boards (/u/t/ -> /u/i/)
        if not is_resolved and "/u/t/" in thumb_url:
            cand = thumb_url.replace("/u/t/", "/u/i/")
            try:
                async with httpx.AsyncClient(timeout=6, follow_redirects=True, headers=req_headers) as client:
                    head_res = await client.head(cand)
                    if head_res.status_code == 200:
                        resolved_url = cand
                        is_resolved = True
            except Exception:
                pass

    target_url = resolved_url or thumb_url

    # 3. Physical Binary Probing (Dimensions, Format, Exact File Size)
    if target_url and target_url.startswith("http"):
        try:
            probe_headers = dict(DEFAULT_HEADERS)
            probe_headers["Referer"] = page_url or referer
            async with httpx.AsyncClient(timeout=8, follow_redirects=True, headers=probe_headers) as client:
                head = await client.head(target_url)
                if head.status_code == 200:
                    cl = head.headers.get("content-length")
                    if cl and cl.isdigit():
                        file_size = int(cl)
                    ct = head.headers.get("content-type", "").lower()
                    if "png" in ct:
                        fmt = "png"
                    elif "gif" in ct:
                        fmt = "gif"
                    elif "webp" in ct:
                        fmt = "webp"
                    elif "jpeg" in ct or "jpg" in ct:
                        fmt = "jpeg"

                    # CDN dimensions header fast path (Pornhub / CDN77 / ATS)
                    rw = head.headers.get("x-origin-width") or head.headers.get("x-result-width")
                    rh = head.headers.get("x-origin-height") or head.headers.get("x-result-height")
                    if rw and rh and rw.isdigit() and rh.isdigit():
                        width = int(rw)
                        height = int(rh)

                if width == 0 or height == 0:
                    range_headers = dict(probe_headers)
                    range_headers["Range"] = "bytes=0-65535"
                    range_res = await client.get(target_url, headers=range_headers)
                    if range_res.status_code in (200, 206):
                        w, h, f = _parse_binary_dimensions(range_res.content)
                        if w and h:
                            width, height = w, h
                            fmt = f
                        if not file_size and range_res.status_code == 200:
                            file_size = len(range_res.content)
        except Exception:
            pass

    # Validation guard: ensure resolved image is genuinely a photo and not an icon, blank pixel, or error page
    if is_resolved:
        if (width > 0 and width < 120) or (height > 0 and height < 120) or (file_size > 0 and file_size < 3000):
            is_resolved = False
            target_url = thumb_url
            width = 0
            height = 0
            file_size = 0

    elapsed = round(time.time() - t0, 3)
    result = PhotoResolveResult(
        success=True,
        photo_id=req.photo_id,
        original_url=target_url,
        width=width,
        height=height,
        file_size=file_size,
        format=fmt,
        is_resolved=is_resolved,
        elapsed_seconds=elapsed,
    )

    if len(_RESOLVED_CACHE) >= CACHE_MAX_SIZE:
        _RESOLVED_CACHE.clear()
    _RESOLVED_CACHE[key] = result

    return result
