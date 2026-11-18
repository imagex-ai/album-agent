"""Renew a GIF video from its source page; never persist a signed CDN URL."""
import asyncio
import re
import weakref
from urllib.parse import urlencode, urlsplit, unquote

import httpcore
import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import RedirectResponse
from selectolax.lexbor import LexborHTMLParser

from .profile_hub_execution import https_url
from .profile_hub_execution_runtime import PublicHTTPSHttpxTransport
from .profile_directory_transport import DEFAULT_TRANSPORT_HEADERS, REQUEST_TIMEOUT, DirectoryFetchError
from .profile_hub_workers import is_pornhub_host

router = APIRouter()
# Source-page lookups share two slots; media bytes still use the existing proxy.
GIF_SOURCE_CONCURRENCY = 2
_limits = weakref.WeakKeyDictionary()


def gif_source_identity(url):
    safe = https_url(url)
    parts = urlsplit(safe)
    match = re.fullmatch(r'/gif/(\d+)/?',parts.path)
    if not is_pornhub_host(safe) or not match or parts.query:
        raise ValueError('Unsupported GIF source page')
    return match[1], safe


def gif_video_from_page(html, page_url):
    identity, _ = gif_source_identity(page_url)
    # The requested entity declares its video in OpenGraph. Global menu/related
    # videos are not candidates. A JPEG poster is never a playable substitute.
    for node in LexborHTMLParser(html).css('meta[property="og:video"],meta[property="og:video:secure_url"]'):
        raw = node.attributes.get('content') or ''
        try:
            candidate = https_url(raw)
        except ValueError:
            continue
        filename = unquote(urlsplit(candidate).path.rsplit('/',1)[-1])
        if re.fullmatch(re.escape(identity)+r'[A-Za-z]*\.(?:mp4|webm)',filename):
            return candidate
    raise ValueError('Source did not declare the requested GIF video')


async def read_gif_video(url):
    _, safe = gif_source_identity(url)
    # Import the bounded reader only when invoked, keeping router imports acyclic.
    from .profile_hub_recent import fetch_recent_html
    slots = _limits.setdefault(asyncio.get_running_loop(),asyncio.Semaphore(GIF_SOURCE_CONCURRENCY))
    async with asyncio.timeout(REQUEST_TIMEOUT), slots:
        async with httpx.AsyncClient(transport=PublicHTTPSHttpxTransport(), timeout=REQUEST_TIMEOUT,
                follow_redirects=False,headers=DEFAULT_TRANSPORT_HEADERS) as client:
            selected,html = await fetch_recent_html(safe,'pornhub',client)
        return gif_video_from_page(html,selected)


@router.get('/gif-stream')
async def gif_stream(url: str):
    try:
        _, safe = gif_source_identity(url)
    except ValueError as error:
        raise HTTPException(422,detail={'code':'invalid_gif_source'}) from error
    try:
        media = await read_gif_video(safe)
    except (ValueError, httpx.HTTPError, httpcore.NetworkError, httpcore.ProtocolError,
            httpcore.TimeoutException, DirectoryFetchError, OSError, TimeoutError) as error:
        raise HTTPException(502,detail={'code':'gif_source_unavailable'}) from error
    # A non-cacheable 307 keeps GET/Range semantics on the existing media proxy.
    # No application initializer, download job, metadata write or cloud service.
    return RedirectResponse('/api/proxy-video-stream?'+urlencode({'url':media,'referer':safe}),
                            status_code=307,headers={'Cache-Control':'no-store'})
