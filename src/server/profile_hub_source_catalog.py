"""Read the source-declared xHamster video tab and all its linked pages.

No storage or application startup. Root showcases must not suppress a video tab,
and overlapping pages must not prevent discovery of subsequent pages.
"""
import asyncio
from urllib.parse import urljoin, urlsplit, urlunsplit

import httpx

from .profile_hub_pagination import discover_profile_section_urls, extract_next_page_urls
from .profile_hub_workers import extract_xhamster_videos_lexbor

CATALOG_PAGE_DELAY_SECONDS = 0.4  # Pace sequential source requests, as in the existing scanner.
MAX_CATALOG_REDIRECTS = 5  # Match the scanner's bounded redirect budget.


async def collect_xhamster_catalog(client, profile_url, root_html, *, on_batch,
                                   initial_videos=(), reported_total=None,
                                   delay_seconds=CATALOG_PAGE_DELAY_SECONDS):
    origin = urlsplit(profile_url)
    root_path = origin.path.rstrip('/')

    def scoped(url):
        parts = urlsplit(url)
        return (parts.scheme == origin.scheme == 'https'
                and parts.netloc.lower() == origin.netloc.lower()
                and not parts.username and not parts.password
                and (parts.path.rstrip('/') == root_path or parts.path.startswith(root_path + '/')))

    def key(url):
        parts = urlsplit(url)
        return urlunsplit((parts.scheme, parts.netloc.lower(), parts.path.rstrip('/'), parts.query, ''))

    seen_pages = {key(profile_url)}
    seen_items = {v['originalUrl'] for v in initial_videos if v.get('originalUrl')}
    pending = discover_profile_section_urls(profile_url, root_html)['videos']
    if not pending:
        pending = extract_next_page_urls(profile_url, root_html, section_prefix=root_path + '/')
    complete = True
    while pending:
        url = pending.pop(0)
        if not scoped(url) or key(url) in seen_pages:
            continue
        seen_pages.add(key(url))
        try:
            fetch_url = url
            for _ in range(MAX_CATALOG_REDIRECTS + 1):
                response = await client.get(fetch_url, follow_redirects=False)
                if response.status_code not in (301, 302, 303, 307, 308):
                    break
                destination = urljoin(fetch_url, response.headers.get('location', ''))
                if not response.headers.get('location') or not scoped(destination):
                    break
                fetch_url = destination
            final_url = str(response.url)
            if response.status_code != 200 or not scoped(final_url):
                complete = False
                continue
            final_key = key(final_url)
            if final_key != key(url) and final_key in seen_pages:
                complete = False  # Redirected back to an already-read showcase/page.
                continue
            seen_pages.add(final_key)
            canonical, raw = extract_xhamster_videos_lexbor(final_url, response.text)
            new_can, new_raw = [], []
            for index, video in enumerate(canonical):
                identity = video.get('originalUrl')
                if identity and identity not in seen_items:
                    seen_items.add(identity)
                    new_can.append(video)
                    new_raw.append(raw[index])
            if new_can:
                await on_batch(new_can, new_raw)
            # The first tab may repeat every root card, but still declare page 2.
            tabs = discover_profile_section_urls(profile_url, response.text)['videos']
            following = extract_next_page_urls(final_url, response.text, section_prefix=root_path + '/')
            pending.extend(u for u in tabs + following if scoped(u) and key(u) not in seen_pages)
            if not canonical:
                complete = False  # A challenge/empty document is not proof of a complete catalog.
        except (httpx.HTTPError, OSError, ValueError, asyncio.TimeoutError):
            complete = False
        if pending and delay_seconds:
            await asyncio.sleep(delay_seconds)
    if isinstance(reported_total, int) and len(seen_items) < reported_total:
        complete = False
    return complete
