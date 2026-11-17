"""Bounded recent-publications reads, separate from deep profile discovery.

Never follows catalog pagination, starts metadata prefetch, or writes storage.
An unordered profile showcase is not accepted as evidence of recent uploads.
"""
import asyncio
import json
import logging
from datetime import datetime, timezone
import re
from urllib.parse import urljoin, urlsplit, urlunsplit, unquote, urlencode

import httpx
import httpcore
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from selectolax.lexbor import LexborHTMLParser

from .profile_directory_manifest import ADAPTERS
from .profile_directory_transport import DEFAULT_TRANSPORT_HEADERS, MAX_REDIRECTS, REQUEST_TIMEOUT, DirectoryFetchError, _read_bounded_listing
from .profile_hub_execution import https_url
from .profile_hub_execution_runtime import PublicHTTPSHttpxTransport
from .profile_hub_manifest import parse_profile_page
from .profile_hub_pagination import (
    collect_cursor_stream,
    collect_youtube_continuation_stream,
    collect_paginated_section,
    discover_profile_section_urls,
)
from .profile_hub_workers import (is_youtube_channel_url, normalize_youtube_channel_base_url,
    extract_eporner_albums_lexbor, extract_eporner_playlists_lexbor, extract_eporner_videos_lexbor,
    extract_pornhub_albums_lexbor, extract_pornhub_gifs_lexbor, extract_pornhub_playlists_lexbor,
    extract_pornhub_max_video_page, extract_pornhub_videos_lexbor,
    extract_xhamster_max_video_page, extract_xhamster_videos_lexbor,
    extract_youtube_playlists_lexbor, extract_youtube_videos_lexbor,
    normalize_pornhub_profile_base_url, normalize_xhamster_profile_base_url)
from .profile_hub_workers import _extract_xhamster_initials, _extract_yt_initial_data
from .profile_hub_publication_dates import enrich_publication_dates, enrich_pornhub_publication_dates

logger = logging.getLogger(__name__)

router = APIRouter()
from .profile_hub_gifs import router as gif_router
router.include_router(gif_router)


class RecentProfileRequest(BaseModel):
    url: str
    expected_name: str | None = None
    known_video_urls: list[str] = Field(default_factory=list)
    known_media_urls: list[str] = Field(default_factory=list)


_EPORNER_HOSTS = frozenset({'eporner.com', 'www.eporner.com'})
_EPORNER_USER_PROFILE_PATH = re.compile(r'/(?:profile|channel)/[A-Za-z0-9_-]+/?\Z')
_PORNHUB_PROFILE_PATH = re.compile(
    r'/(?:pornstar|model|channels|users)/[A-Za-z0-9_-]+(?:/(?:videos|photos|playlists|gifs|about|stream))?/?\Z',
    re.I,
)


def _is_eporner_user_profile_url(url: str) -> bool:
    parts = urlsplit(url)
    host = (parts.hostname or '').lower()
    valid_host = host == 'eporner.com' or host.endswith('.eporner.com')
    return (
        parts.scheme == 'https'
        and valid_host
        and parts.port in (None, 443)
        and not parts.username
        and not parts.password
        and not parts.query
        and not parts.fragment
        and bool(_EPORNER_USER_PROFILE_PATH.fullmatch(parts.path))
    )


def _is_pornhub_profile_route(url: str) -> bool:
    parts = urlsplit(url)
    host = (parts.hostname or '').lower()
    valid_host = host == 'pornhub.com' or host.endswith('.pornhub.com')
    return (
        parts.scheme == 'https'
        and valid_host
        and parts.port in (None, 443)
        and not parts.username
        and not parts.password
        and not parts.fragment
        and bool(_PORNHUB_PROFILE_PATH.fullmatch(parts.path))
    )


def _same_resource_url(left: str, right: str) -> bool:
    a, b = urlsplit(left), urlsplit(right)
    return (a.scheme, a.netloc, a.path.rstrip('/'), a.query) == (
        b.scheme, b.netloc, b.path.rstrip('/'), b.query
    )


def recent_source(url):
    safe = https_url(url)
    if is_youtube_channel_url(safe):
        return 'youtube'
    if _is_eporner_user_profile_url(safe):
        return 'eporner'
    if _is_pornhub_profile_route(safe):
        return 'pornhub'
    adapter = next((adapter for adapter in ADAPTERS if adapter.recognize(safe) == 'profile'), None)
    if adapter is None:
        raise ValueError('Recent publication discovery is not installed for this source')
    return adapter.adapter_id


def recent_video_link(source_url, html, source):
    """Use source-declared links. Never execute onclick or guess sort queries."""
    if source == 'youtube':
        return normalize_youtube_channel_base_url(source_url)+'/videos'
    tree = LexborHTMLParser(html)
    base = urlsplit(source_url)
    base_path = base.path.rstrip('/')
    prefix = base_path + '/'
    if source == 'xhamster':
        # This source publishes its sort links in window.initials, rather than
        # anchors. Follow the declared Newest destination within this profile;
        # never infer a sort URL from the slug or accept a global listing.
        def declared_latest(value):
            if isinstance(value, dict):
                if value.get('label') == 'Newest' and isinstance(value.get('url'), str):
                    yield value['url']
                for child in value.values():
                    yield from declared_latest(child)
            elif isinstance(value, list):
                for child in value:
                    yield from declared_latest(child)
        for href in declared_latest(_extract_xhamster_initials(html)):
            target = urljoin(source_url, href)
            parts = urlsplit(target)
            if (parts.scheme == 'https' and parts.netloc == base.netloc
                    and (parts.path.rstrip('/') == base_path or parts.path.startswith(prefix))
                    and not parts.fragment and not parts.username and not parts.password):
                return target
    for anchor in tree.css('a[href]'):
        if not re.fullmatch(r'(?:\+\s*More\s+)?Most [Rr]ecent(?: Videos)?', anchor.text(separator=' ', strip=True)):
            continue
        href = anchor.attributes.get('href', '')
        if href == '#':
            # The Eporner source exposes the destination as a literal navigation
            # argument. Accept only that literal, not arbitrary JS expressions.
            match = re.fullmatch(r"\s*return EP\.page\.topBelNav\((['\"])(/[^'\"<>]*)\1\);?\s*", anchor.attributes.get('onclick', ''))
            href = match[2] if match else ''
        target = urljoin(source_url, href)
        parts = urlsplit(target)
        same_or_child = parts.path.rstrip('/') == base_path or parts.path.startswith(prefix)
        if href and parts.scheme == 'https' and parts.netloc == base.netloc and same_or_child and not parts.fragment:
            return target
    return None


def profile_media_link(source_url, html, tab):
    """Read one literal child tab in this profile, never global media navigation."""
    base = urlsplit(source_url)
    child_path = base.path.rstrip('/')+'/'+tab
    for anchor in LexborHTMLParser(html).css('a[href]'):
        parts = urlsplit(urljoin(source_url, anchor.attributes['href']))
        if parts.scheme == 'https' and parts.netloc == base.netloc and parts.path.rstrip('/') == child_path and not parts.query:
            return urlunsplit(parts._replace(fragment=''))
    return None


def photo_source_identity(url, profile_url):
    """Eporner gallery/photo IDs are case-sensitive; slugs are presentation.

    Only recognize this adapter's paths on the already verified source host.
    Never apply trailing-slash/slug equivalence to arbitrary media URLs.
    """
    if not isinstance(url,str):
        return None
    parts, base = urlsplit(url), urlsplit(profile_url)
    if parts.scheme != 'https' or parts.netloc != base.netloc or parts.query or parts.fragment:
        return None
    match = re.fullmatch(r'/(gallery|photo)/([a-zA-Z0-9]+)(?:/[^?#]*)?',parts.path)
    return (match[1],match[2]) if match else None


async def read_recent_albums(root_url, root_html, source, client, known_media_urls=()):
    """Read only the source-declared first latest-photo page, without per-album IO.

    Listing order proves which page was selected, not an individual publication
    date. Gallery creation/last-update semantics remain unknown when absent.
    """
    if source != 'eporner':
        return None
    tab = profile_media_link(root_url, root_html, 'photos') or profile_media_link(root_url, root_html, 'uploaded-pics')
    if not tab:
        return None
    tab_url, tab_html = await fetch_recent_html(tab, source, client)
    latest = recent_video_link(tab_url, tab_html, source)
    if not latest:
        raise ValueError('Source recent-photo order is not verified')
    if _same_resource_url(latest, tab_url):
        selected, body = tab_url, tab_html
    else:
        selected, body = await fetch_recent_html(latest, source, client)
    # A successful arbitrary/empty HTML response must not become an empty
    # verified collection. The native photos grid is also present when empty.
    grid = LexborHTMLParser(body).css_first('.photosgrid')
    if grid is None:
        raise ValueError('Source latest-photo listing could not be verified')
    # The shared parser also supports standalone gallery cards elsewhere in a
    # document. Limit this read to the profile grid, excluding recommendations.
    parsed_cards, parsed_raw = extract_eporner_albums_lexbor(selected, grid.html)
    cards, raw, seen = [], [], set()
    aliases = {}
    for url in known_media_urls:
        identity = photo_source_identity(url,root_url)
        if identity:
            aliases.setdefault(identity,[]).append(url)
    for card, item in zip(parsed_cards, parsed_raw):
        if card['url'] in seen:
            continue
        seen.add(card['url'])
        card.update(sourcePage=selected, dateKind='unknown',
                    source_aliases=aliases.get(photo_source_identity(card['url'],root_url),[]))
        cards.append(card)
        raw.append(item)
    return {'page_url':selected, 'items':cards, 'raw_items':raw,
            'loaded_count':len(cards), 'page_complete':True, 'catalog_complete':False,
            'order':'source_latest', 'date_kind':'unknown'}


async def read_pornhub_media(root_url, root_html, client):
    """Read declared profile collections, without claiming upload chronology.

    Public uploads and GIFs from this profile's videos have different source
    associations. Neither the global GIF menu nor search results belong here.
    Each declared collection is one bounded page, never a catalog crawl.
    """
    result = {'albums':[], 'gifs':[], 'raw_albums':[], 'raw_gifs':[], 'pages':{}, 'reported_totals':{}, 'errors':[]}
    for kind, tab_name, collections, selector, parser in (
        ('albums','photos',('public',),'.photosPage > ul#moreData.photosAlbumsListing',extract_pornhub_albums_lexbor),
        ('gifs','gifs',('public','video'),'.gifsWrapperProfile > ul#moreData.gifs',extract_pornhub_gifs_lexbor),
    ):
        tab = profile_media_link(root_url,root_html,tab_name)
        if not tab:
            continue
        seen = set()
        collection_reported_total = 0
        try:
            tab_url, tab_html = await fetch_recent_html(tab,'pornhub',client)
        except (ValueError, httpx.HTTPError, httpcore.NetworkError, httpcore.ProtocolError,
                httpcore.TimeoutException, DirectoryFetchError, OSError, TimeoutError):
            result['errors'].append(kind)
            continue
        for collection in collections:
            target = profile_media_link(tab_url,tab_html,collection)
            if not target:
                continue
            try:
                selected, body = await fetch_recent_html(target,'pornhub',client)
                parsed_body = LexborHTMLParser(body)
                scope = parsed_body.css_first(selector)
                if scope is None:
                    raise ValueError('Source media collection could not be verified')
                for counter_node in parsed_body.css('.showingInfo, .showingCounter'):
                    m_cnt = re.search(
                        r'\b\d+\s*-\s*\d+\s*(?:of|de|von|sur|/)\s*([0-9][0-9,.\s]*)',
                        counter_node.text(separator=' ', strip=True),
                        re.I,
                    )
                    if m_cnt:
                        try:
                            collection_reported_total += int(re.sub(r'[^\d]', '', m_cnt.group(1)))
                            break
                        except ValueError:
                            pass
                cards, raw = parser(selected,scope.html)
                page_count = 0
                page_seen = set()
                for card, item in zip(cards,raw):
                    url = card.get('pageUrl') or card.get('url')
                    if not url or url in page_seen:
                        continue
                    page_seen.add(url)
                    page_count += 1
                    if url in seen:
                        continue
                    seen.add(url)
                    association = 'profile_videos' if collection == 'video' else 'profile_uploads'
                    card.update(sourcePage=selected,dateKind='unknown',sourceAssociation=association)
                    if kind == 'gifs':
                        # Stable source lookup survives cache reload and CDN expiry.
                        card['streamResolverUrl'] = '/api/profile-hub/gif-stream?'+urlencode({'url':url})
                    item['provenance']={'page_url':selected,'evidence':'declared profile collection',
                                        'ownership':'unverified','association':association}
                    result[kind].append(card)
                    result['raw_'+kind].append(item)
                result['pages'].setdefault(kind,[]).append({'page_url':selected,'loaded_count':page_count,
                    'page_complete':True,'catalog_complete':False,'order':'source_listing','date_kind':'unknown',
                    'association':'profile_videos' if collection == 'video' else 'profile_uploads'})
            except (ValueError, httpx.HTTPError, httpcore.NetworkError, httpcore.ProtocolError,
                    httpcore.TimeoutException, DirectoryFetchError, OSError, TimeoutError):
                if kind not in result['errors']:
                    result['errors'].append(kind)
        if collection_reported_total > 0:
            result['reported_totals'][kind] = max(collection_reported_total, len(result[kind]))
    return result


def performer_slug(name):
    return re.sub(r'[^\w]+', '-', (name or '').strip().casefold()).strip('-')


def eporner_canonical_alias(original, target, expected_name):
    """Only a source-issued root alias for the same explicitly named performer.

    Eporner has changed opaque suffixes on existing performer URLs. Generic
    same-host redirects, nested listings and different names remain rejected.
    The returned document must additionally prove its canonical URL/name below.
    """
    name = performer_slug(expected_name)
    if not name or original.netloc != target.netloc or original.query or target.query:
        return False
    prefix = '/pornstar/'+name+'-'
    bare = '/pornstar/'+name
    paths = (unquote(original.path).rstrip('/').casefold(), unquote(target.path).rstrip('/').casefold())
    return all(
        path == bare or (path.startswith(prefix) and re.fullmatch(r'[a-z0-9]+', path[len(prefix):]))
        for path in paths
    )


async def fetch_recent_html(url, source, client, *, expected_name=None):
    original = urlsplit(https_url(url))
    context = (original.netloc, original.path.rstrip('/'), original.query)
    for _ in range(MAX_REDIRECTS+1):
        # The root was recognized by an installed adapter; child links were
        # extracted within that profile. Redirects cannot change their origin.
        current = urlsplit(https_url(url))
        alias = source == 'eporner' and eporner_canonical_alias(original, current, expected_name)
        ctx_path_low = context[1].lower()
        cur_path_low = current.path.rstrip('/').lower()
        same_host = current.netloc.lower().removeprefix('www.') == context[0].lower().removeprefix('www.')
        same_case_insensitive_account = (
            _is_account_profile_url(url)
            and same_host
            and current.query == context[2]
            and (cur_path_low == ctx_path_low or cur_path_low == ctx_path_low + '/1')
        )
        if (current.netloc, current.path.rstrip('/'), current.query) != context and not alias and not same_case_insensitive_account:
            raise ValueError('Source redirect changed profile or selected listing; canonical URL must be resolved first')
        async with client.stream('GET', url) as response:
            if response.status_code in (301,302,303,307,308):
                location = response.headers.get('location')
                if not location:
                    raise ValueError('Missing source redirect')
                url = https_url(urljoin(url, location))
                continue
            response.raise_for_status()
            if response.headers.get('content-type','').split(';',1)[0].strip().lower() not in ('text/html','application/xhtml+xml'):
                raise ValueError('Source did not return HTML')
            html = await _read_bounded_listing(response)
            if alias:
                tree = LexborHTMLParser(html)
                canonical = tree.css_first('link[rel="canonical"]')
                declared = urlsplit(urljoin(url, canonical.attributes.get('href',''))) if canonical else None
                root = parse_profile_page(url, html)
                if (not declared or (declared.netloc,declared.path.rstrip('/'),declared.query) !=
                    (current.netloc,current.path.rstrip('/'),current.query) or
                    performer_slug(root.get('name')) != performer_slug(expected_name)):
                    raise ValueError('Source canonical profile alias could not be verified')
            return url, html
    raise ValueError('Source redirect limit reached')


_DEFAULT_FETCH_RECENT_HTML = fetch_recent_html


async def _fetch_pornhub_watch_html(watch_url, source, client):
    if fetch_recent_html is _DEFAULT_FETCH_RECENT_HTML:
        from .profile_directory_transport import _fetch_public_httpx_listing
        from .profile_hub_comment_sources import html_comment_source
        watch_source = html_comment_source(watch_url)
        if watch_source is None:
            raise ValueError('Invalid watch source')
        return await _fetch_public_httpx_listing(watch_source, watch_url)
    return await fetch_recent_html(watch_url, source, client)


async def _fetch_declared_recent_target(source_url, html, source, client):
    target = recent_video_link(source_url, html, source)
    if not target:
        return None
    if _same_resource_url(target, source_url):
        return source_url, html
    return await fetch_recent_html(target, source, client)


async def _resolve_recent_videos_page(root_url, root_html, source, client):
    """Follow only source-declared profile tabs to the verified recent-videos page."""
    resolved = await _fetch_declared_recent_target(root_url, root_html, source, client)
    if resolved is not None:
        return resolved
    if source == 'pornhub':
        videos_tab = profile_media_link(root_url, root_html, 'videos')
        if videos_tab:
            videos_url, videos_html = await fetch_recent_html(videos_tab, source, client)
            resolved = await _fetch_declared_recent_target(videos_url, videos_html, source, client)
            if resolved is not None:
                return resolved
            public_tab = profile_media_link(videos_url, videos_html, 'public')
            if public_tab:
                public_url, public_html = await fetch_recent_html(public_tab, source, client)
                resolved = await _fetch_declared_recent_target(public_url, public_html, source, client)
                if resolved is not None:
                    return resolved
    elif source == 'eporner':
        uploads_tab = profile_media_link(root_url, root_html, 'uploaded-videos')
        if uploads_tab:
            uploads_url, uploads_html = await fetch_recent_html(uploads_tab, source, client)
            resolved = await _fetch_declared_recent_target(uploads_url, uploads_html, source, client)
            if resolved is not None:
                return resolved

    # If root already renders recent/activity videos, preserve it instead of switching to a sub-tab.
    root_parsed = parse_profile_page(root_url, root_html)
    if root_parsed.get('canonical_videos'):
        return root_url, root_html

    # Generic fallback for profiles without a declared "Most recent" link
    # (e.g. user-account profiles with /videos/ tab or playlist-only profiles).
    section_urls = discover_profile_section_urls(root_url, root_html)
    video_tab_candidates = list(section_urls.get('videos', []))
    if not video_tab_candidates and _is_account_profile_url(root_url) and not section_urls.get('playlists'):
        video_tab_candidates = discover_profile_section_urls(
            root_url,
            root_html,
            fallback_suffixes={'videos': ('videos/',)},
        ).get('videos', [])
    for tab_url in video_tab_candidates:
        if _same_resource_url(tab_url, root_url):
            continue
        try:
            tab_final_url, tab_html = await fetch_recent_html(tab_url, source, client)
        except (ValueError, httpx.HTTPError, httpcore.NetworkError, httpcore.ProtocolError,
                httpcore.TimeoutException, DirectoryFetchError, OSError, TimeoutError):
            continue
        resolved = await _fetch_declared_recent_target(tab_final_url, tab_html, source, client)
        if resolved is not None:
            return resolved
        return tab_final_url, tab_html
    return root_url, root_html



_ACCOUNT_PROFILE_PREFIXES = ('/profile/', '/users/', '/user/', '/u/')


def _is_account_profile_url(url: str) -> bool:
    path = urlsplit(url).path.lower()
    return any(path.startswith(prefix) for prefix in _ACCOUNT_PROFILE_PREFIXES)


def _recent_fetch_adapter(source: str, client):
    async def _fetch(url: str) -> tuple[int, str, str]:
        try:
            final_url, body = await fetch_recent_html(url, source, client)
            return 200, final_url, body
        except httpx.HTTPStatusError as exc:
            status = getattr(exc.response, 'status_code', 0)
            if status == 404:
                return 404, url, ''
            raise
    return _fetch


_PLAYLIST_EXTRACTORS = {
    'eporner': lambda prof, page, html, av: extract_eporner_playlists_lexbor(prof, page, html, av)[:2],
    'pornhub': lambda prof, _page, html, av: extract_pornhub_playlists_lexbor(prof, html, av),
    'youtube': lambda prof, _page, html, av: extract_youtube_playlists_lexbor(prof, '', html, av)[:2],
}


async def read_recent_playlists(
    root_url: str,
    root_html: str,
    source: str,
    client,
    *,
    fallback_avatar: str = '',
    allow_fallback_tab: bool = False,
) -> dict:
    extractor = _PLAYLIST_EXTRACTORS.get(source)
    if extractor is None:
        return {'items': [], 'raw_items': [], 'loaded_count': 0, 'complete': True, 'had_source': False}

    can_items: list[dict] = []
    raw_items: list[dict] = []
    seen_keys: set[str] = set()

    def _merge(can_batch, raw_batch):
        for idx, c in enumerate(can_batch or []):
            key = c.get('url') or c.get('id') or ''
            if not key or key in seen_keys:
                continue
            seen_keys.add(key)
            can_items.append(c)
            if idx < len(raw_batch or []):
                raw_items.append(raw_batch[idx])

    root_can, root_raw = extractor(root_url, root_url, root_html, fallback_avatar)
    _merge(root_can, root_raw)

    section_urls = discover_profile_section_urls(root_url, root_html)
    tab_urls = [u for u in section_urls.get('playlists', []) if not _same_resource_url(u, root_url)]
    if not tab_urls and allow_fallback_tab:
        fallback_sections = discover_profile_section_urls(
            root_url,
            root_html,
            fallback_suffixes={'playlists': ('playlists/',)},
        )
        tab_urls = [u for u in fallback_sections.get('playlists', []) if not _same_resource_url(u, root_url)]

    complete = True
    if tab_urls:
        batches, complete = await collect_paginated_section(
            client,
            tab_urls,
            extract_fn=lambda p_url, p_html: extractor(root_url, p_url, p_html, fallback_avatar),
            item_key_fn=lambda item: item.get('url') or item.get('id') or '',
            max_pages=15,
            fetch_fn=_recent_fetch_adapter(source, client),
        )
        for b_can, b_raw in batches:
            _merge(b_can, b_raw)
        if (not complete or not batches) and hasattr(client, 'get'):
            root_host = urlsplit(root_url).netloc.lower().removeprefix('www.')
            async def _safe_tab_fetch(url: str) -> tuple[int, str, str]:
                resp = await client.get(url, follow_redirects=True)
                final_u = str(resp.url)
                if urlsplit(final_u).netloc.lower().removeprefix('www.') != root_host:
                    return 404, url, ''
                return resp.status_code, final_u, resp.text if resp.status_code == 200 else ''
            fb_batches, fb_complete = await collect_paginated_section(
                client,
                tab_urls,
                extract_fn=lambda p_url, p_html: extractor(root_url, p_url, p_html, fallback_avatar),
                item_key_fn=lambda item: item.get('url') or item.get('id') or '',
                max_pages=15,
                fetch_fn=_safe_tab_fetch,
            )
            for b_can, b_raw in fb_batches:
                _merge(b_can, b_raw)
            if fb_batches:
                complete = fb_complete

    if source == 'eporner' and hasattr(client, 'get'):
        parts = urlsplit(root_url)
        slug_parts = [seg for seg in parts.path.strip('/').split('/') if seg]
        root_host = parts.netloc.lower().removeprefix('www.')
        extra_pl_targets: list[str] = []
        if len(can_items) <= len(root_can or []) and tab_urls:
            extra_pl_targets.extend(tab_urls)
        if len(slug_parts) >= 2 and slug_parts[0].lower() == 'profile':
            clean_slug = slug_parts[1].lower()
            extra_pl_targets.append(f"{parts.scheme}://{parts.netloc}/search-playlists/{clean_slug}/")
        if extra_pl_targets:
            if type(client) is httpx.AsyncClient:
                async with httpx.AsyncClient(timeout=20, follow_redirects=True, max_redirects=5, headers=DEFAULT_TRANSPORT_HEADERS) as pl_client:
                    async def _direct_pl_fetch(url: str) -> tuple[int, str, str]:
                        resp = await pl_client.get(url)
                        final_u = str(resp.url)
                        if urlsplit(final_u).netloc.lower().removeprefix('www.') != root_host:
                            return 404, url, ''
                        return resp.status_code, final_u, resp.text if resp.status_code == 200 else ''
                    sp_batches, sp_complete = await collect_paginated_section(
                        pl_client,
                        extra_pl_targets,
                        extract_fn=lambda p_url, p_html: extractor(root_url, p_url, p_html, fallback_avatar),
                        item_key_fn=lambda item: item.get('url') or item.get('id') or '',
                        max_pages=15,
                        fetch_fn=_direct_pl_fetch,
                    )
            else:
                async def _mock_pl_fetch(url: str) -> tuple[int, str, str]:
                    resp = await client.get(url, follow_redirects=True)
                    final_u = str(resp.url)
                    if urlsplit(final_u).netloc.lower().removeprefix('www.') != root_host:
                        return 404, url, ''
                    return resp.status_code, final_u, resp.text if resp.status_code == 200 else ''
                sp_batches, sp_complete = await collect_paginated_section(
                    client,
                    extra_pl_targets,
                    extract_fn=lambda p_url, p_html: extractor(root_url, p_url, p_html, fallback_avatar),
                    item_key_fn=lambda item: item.get('url') or item.get('id') or '',
                    max_pages=15,
                    fetch_fn=_mock_pl_fetch,
                )
            for b_can, b_raw in sp_batches:
                _merge(b_can, b_raw)
            if sp_batches:
                complete = sp_complete

    logger.info(
        'read_recent_playlists root=%s root_count=%d tab_urls=%s total=%d complete=%s',
        root_url,
        len(root_can or []),
        tab_urls,
        len(can_items),
        complete,
    )

    return {
        'items': can_items,
        'raw_items': raw_items,
        'loaded_count': len(can_items),
        'complete': complete,
        'had_source': bool(tab_urls or can_items),
    }


def _merge_root_identity(result: dict, root_url: str, root_html: str) -> dict:
    """Keep profile-root identity/hero metadata when recent videos live on a child tab."""
    root_result = parse_profile_page(root_url, root_html)
    for key in ('profile_key', 'source_url', 'name', 'description', 'cover_url'):
        if root_result.get(key):
            result[key] = root_result[key]
    root_pd = root_result.get('profile_data')
    if isinstance(root_pd, dict) and root_pd:
        target_pd = result.get('profile_data')
        merged_pd = dict(target_pd) if isinstance(target_pd, dict) else {}
        for key, value in root_pd.items():
            if value not in (None, '', {}, []):
                merged_pd[key] = value
        if (
            isinstance(root_pd.get('stats'), dict)
            and isinstance(target_pd, dict)
            and isinstance(target_pd.get('stats'), dict)
        ):
            stats = dict(target_pd['stats'])
            for stat_key, stat_val in root_pd['stats'].items():
                if isinstance(stat_val, int) and isinstance(stats.get(stat_key), int):
                    stats[stat_key] = max(stats[stat_key], stat_val)
                elif stat_val not in (None, '', 0) or stat_key not in stats:
                    stats[stat_key] = stat_val
            merged_pd['stats'] = stats
        result['profile_data'] = merged_pd
    return result


async def read_recent_profile(url, expected_name=None, known_video_urls=(), known_media_urls=(), *, on_profile=None):
    safe = https_url(url.strip())
    source = recent_source(safe)
    async with httpx.AsyncClient(transport=PublicHTTPSHttpxTransport(), timeout=REQUEST_TIMEOUT,
                                follow_redirects=False, headers=DEFAULT_TRANSPORT_HEADERS) as client:
        if source == 'youtube':
            target = normalize_youtube_channel_base_url(safe)+'/videos'
            target, html = await fetch_recent_html(target, source, client)
            root_url, root_html = target, html
        else:
            root_url, root_html = await fetch_recent_html(safe, source, client, expected_name=expected_name)
            target, html = await _resolve_recent_videos_page(root_url, root_html, source, client)
        result = parse_profile_page(target, html)
        if source != 'youtube' and not _same_resource_url(target, root_url):
            _merge_root_identity(result, root_url, root_html)
        early_playlists_res = None
        if source == 'eporner':
            fallback_avatar_early = ''
            if isinstance(result.get('profile_data'), dict):
                fallback_avatar_early = result['profile_data'].get('avatarUrl') or ''
            if not fallback_avatar_early:
                fallback_avatar_early = result.get('cover_url') or ''
            try:
                early_playlists_res = await read_recent_playlists(
                    root_url,
                    root_html,
                    source,
                    client,
                    fallback_avatar=fallback_avatar_early,
                    allow_fallback_tab=_is_account_profile_url(root_url) and not result.get('canonical_videos'),
                )
            except (ValueError, httpx.HTTPError, httpcore.NetworkError, httpcore.ProtocolError,
                    httpcore.TimeoutException, DirectoryFetchError, OSError, TimeoutError):
                early_playlists_res = None
        is_streaming = on_profile is not None
        if is_streaming:
            snap = dict(result)
            snap['canonical_videos'] = list(result.get('canonical_videos', []))
            if early_playlists_res is not None:
                snap['canonical_playlists'] = list(early_playlists_res['items'])
                snap['playlists'] = {
                    'status': 'complete' if early_playlists_res['complete'] else 'partial',
                    'items': list(early_playlists_res['raw_items']),
                    'loaded_count': early_playlists_res['loaded_count'],
                }
            snap['discovery_pending'] = True
            await on_profile(snap)

        if source == 'eporner' and hasattr(client, 'post'):
            existing_v_urls = {v.get('originalUrl') for v in result.get('canonical_videos', []) if v.get('originalUrl')}

            async def _emit_recent_progress():
                if not is_streaming:
                    return
                if isinstance(result.get('profile_data'), dict) and result.get('canonical_videos'):
                    pd_stats = result['profile_data'].setdefault('stats', {})
                    pd_stats['videos'] = max(pd_stats.get('videos') or 0, len(result['canonical_videos']))
                snap = dict(result)
                snap['canonical_videos'] = list(result.get('canonical_videos', []))
                if early_playlists_res is not None:
                    snap['canonical_playlists'] = list(early_playlists_res['items'])
                    snap['playlists'] = {
                        'status': 'complete' if early_playlists_res['complete'] else 'partial',
                        'items': list(early_playlists_res['raw_items']),
                        'loaded_count': early_playlists_res['loaded_count'],
                    }
                snap['discovery_pending'] = True
                await on_profile(snap)

            async def _append_dedup_videos(b_can, b_raw):
                added = False
                for idx, c in enumerate(b_can):
                    u = c.get('originalUrl')
                    if not u or u in existing_v_urls:
                        continue
                    existing_v_urls.add(u)
                    result.setdefault('canonical_videos', []).append(c)
                    if isinstance(result.get('videos'), dict) and isinstance(result['videos'].get('items'), list):
                        if idx < len(b_raw):
                            result['videos']['items'].append(b_raw[idx])
                        result['videos']['loaded_count'] = len(result['canonical_videos'])
                    added = True
                if added:
                    await _emit_recent_progress()

            await collect_cursor_stream(
                client,
                target,
                html,
                extract_fn=lambda p_url, p_html: extract_eporner_videos_lexbor(p_url, p_html),
                item_key_fn=lambda item: item.get('originalUrl') or '',
                initial_seen_keys=existing_v_urls,
                stop_on_keys=(),
                max_batches=None if is_streaming else 40,
                max_duration_seconds=None if is_streaming else 15.0,
                on_batch=_append_dedup_videos if is_streaming else None,
                delay_seconds=0.35 if is_streaming else 0.2,
            ) if is_streaming else await _append_dedup_videos(*(lambda batches: ([c for b_c, _ in batches for c in b_c], [r for _, b_r in batches for r in b_r]))((await collect_cursor_stream(
                client,
                target,
                html,
                extract_fn=lambda p_url, p_html: extract_eporner_videos_lexbor(p_url, p_html),
                item_key_fn=lambda item: item.get('originalUrl') or '',
                initial_seen_keys=existing_v_urls,
                stop_on_keys=(),
                max_batches=40,
                max_duration_seconds=15.0,
            ))[0]))

            if hasattr(client, 'get'):
                extra_sec = discover_profile_section_urls(root_url, root_html)
                hyphen_video_tabs = [
                    u for u in extra_sec.get('videos', [])
                    if '-videos' in urlsplit(u).path.lower() and not _same_resource_url(u, target)
                ]
                if hyphen_video_tabs:
                    root_host = urlsplit(root_url).netloc.lower().removeprefix('www.')
                    async def _safe_vtab_fetch(url: str) -> tuple[int, str, str]:
                        resp = await client.get(url, follow_redirects=True)
                        final_u = str(resp.url)
                        if urlsplit(final_u).netloc.lower().removeprefix('www.') != root_host:
                            return 404, url, ''
                        return resp.status_code, final_u, resp.text if resp.status_code == 200 else ''
                    if is_streaming:
                        await collect_paginated_section(
                            client,
                            hyphen_video_tabs,
                            extract_fn=lambda p_url, p_html: extract_eporner_videos_lexbor(p_url, p_html),
                            item_key_fn=lambda item: item.get('originalUrl') or '',
                            max_pages=None,
                            concurrency=2,
                            fetch_fn=_safe_vtab_fetch,
                            on_batch=_append_dedup_videos,
                            delay_seconds=0.35,
                        )
                    else:
                        vtab_batches, _ = await collect_paginated_section(
                            client,
                            hyphen_video_tabs,
                            extract_fn=lambda p_url, p_html: extract_eporner_videos_lexbor(p_url, p_html),
                            item_key_fn=lambda item: item.get('originalUrl') or '',
                            max_pages=15,
                            concurrency=6,
                            fetch_fn=_safe_vtab_fetch,
                        )
                        for b_can, b_raw in vtab_batches:
                            await _append_dedup_videos(b_can, b_raw)
            if isinstance(result.get('profile_data'), dict) and result.get('canonical_videos'):
                pd_stats = result['profile_data'].setdefault('stats', {})
                pd_stats['videos'] = max(pd_stats.get('videos') or 0, len(result['canonical_videos']))

        elif is_streaming and source in ('youtube', 'xhamster', 'pornhub'):
            existing_v_urls = {v.get('originalUrl') for v in result.get('canonical_videos', []) if v.get('originalUrl')}

            async def _emit_other_progress():
                if isinstance(result.get('profile_data'), dict) and result.get('canonical_videos'):
                    pd_stats = result['profile_data'].setdefault('stats', {})
                    pd_stats['videos'] = max(pd_stats.get('videos') or 0, len(result['canonical_videos']))
                snap = dict(result)
                snap['canonical_videos'] = list(result.get('canonical_videos', []))
                snap['discovery_pending'] = True
                await on_profile(snap)

            async def _append_other_videos(b_can, b_raw):
                added = False
                for idx, c in enumerate(b_can):
                    u = c.get('originalUrl')
                    if not u or u in existing_v_urls:
                        continue
                    existing_v_urls.add(u)
                    result.setdefault('canonical_videos', []).append(c)
                    if isinstance(result.get('videos'), dict) and isinstance(result['videos'].get('items'), list):
                        if idx < len(b_raw):
                            result['videos']['items'].append(b_raw[idx])
                        result['videos']['loaded_count'] = len(result['canonical_videos'])
                    added = True
                if added:
                    await _emit_other_progress()
                return added

            if source == 'youtube' and hasattr(client, 'post'):
                yt_init = _extract_yt_initial_data(html)
                await collect_youtube_continuation_stream(
                    client,
                    target,
                    html,
                    yt_init,
                    extract_fn=lambda p_url, p_data: extract_youtube_videos_lexbor(p_url, p_data),
                    item_key_fn=lambda item: item.get('originalUrl') or '',
                    initial_seen_keys=existing_v_urls,
                    max_batches=None,
                    delay_seconds=0.45,
                    on_batch=_append_other_videos,
                )
            elif source == 'xhamster' and hasattr(client, 'get'):
                base_xh = normalize_xhamster_profile_base_url(root_url)
                max_xh_page = extract_xhamster_max_video_page(
                    html, total_videos=result.get('profile_data', {}).get('stats', {}).get('videos')
                )
                root_host = urlsplit(root_url).netloc.lower().removeprefix('www.')
                p_num = 2
                while max_xh_page >= 2 and p_num <= max_xh_page:
                    p_url = f"{base_xh}/videos/{p_num}" if "/users/" in base_xh else f"{base_xh}/{p_num}"
                    try:
                        resp = await client.get(p_url, follow_redirects=True)
                        if resp.status_code in (429, 503):
                            await asyncio.sleep(2.5)
                            resp = await client.get(p_url, follow_redirects=True)
                        if resp.status_code != 200 or urlsplit(str(resp.url)).netloc.lower().removeprefix('www.') != root_host:
                            break
                        b_can, b_raw = extract_xhamster_videos_lexbor(root_url, resp.text)
                        if not b_can or not await _append_other_videos(b_can, b_raw):
                            break
                    except Exception:
                        break
                    p_num += 1
                    await asyncio.sleep(0.45)
            elif source == 'pornhub' and hasattr(client, 'get'):
                base_ph = normalize_pornhub_profile_base_url(root_url)
                videos_base = f"{base_ph}/videos"
                max_ph_page = extract_pornhub_max_video_page(html)
                root_host = urlsplit(root_url).netloc.lower().removeprefix('www.')
                p_num = 2
                while max_ph_page >= 2 and p_num <= max_ph_page:
                    p_url = f"{videos_base}?page={p_num}"
                    try:
                        resp = await client.get(p_url, follow_redirects=True)
                        if resp.status_code in (429, 503):
                            await asyncio.sleep(2.5)
                            resp = await client.get(p_url, follow_redirects=True)
                        if resp.status_code != 200 or "leastFactor" in resp.text or urlsplit(str(resp.url)).netloc.lower().removeprefix('www.') != root_host:
                            break
                        b_can, b_raw = extract_pornhub_videos_lexbor(root_url, resp.text)
                        if not b_can or not await _append_other_videos(b_can, b_raw):
                            break
                    except Exception:
                        break
                    p_num += 1
                    await asyncio.sleep(0.5)

        result['canonical_albums'] = []
        result['canonical_gifs'] = []
        result['gifs'] = {'status':'partial', 'items':[], 'loaded_count':0}
        result['albums'] = {'status':'partial', 'items':[], 'loaded_count':0}
        result['recent_capabilities'] = {'videos':'source_latest', 'photos':'unverified', 'albums':'unverified', 'gifs':'unverified'}
        errors = []
        if source == 'eporner':
            await enrich_publication_dates(result, client, known_video_urls)
            try:
                albums = await read_recent_albums(root_url, root_html, source, client, known_media_urls)
                if albums is not None:
                    result['canonical_albums'] = albums.pop('items')
                    result['albums'] = {'status':'partial', 'items':albums.pop('raw_items'), 'loaded_count':albums['loaded_count']}
                    result['recent_media_pages'] = {'albums':albums}
                    result['recent_capabilities'].update(photos='source_latest', albums='source_latest')
                    if isinstance(result.get('profile_data'), dict):
                        stats = result['profile_data'].setdefault('stats', {})
                        stats['albums'] = max(stats.get('albums') or 0, albums.get('loaded_count') or 0, len(result['canonical_albums']))
            except (ValueError, httpx.HTTPError, httpcore.NetworkError, httpcore.ProtocolError,
                    httpcore.TimeoutException, DirectoryFetchError, OSError, TimeoutError):
                # Optional collection failure must not discard valid videos.
                errors.append('albums')
                if isinstance(result.get('profile_data'), dict):
                    stats = result['profile_data'].setdefault('stats', {})
                    if not stats.get('albums'):
                        stats['albums'] = None
        elif source == 'pornhub':
            await enrich_pornhub_publication_dates(result, client, _fetch_pornhub_watch_html, known_video_urls)
            media = await read_pornhub_media(root_url,root_html,client)
            errors.extend(media['errors'])
            reported_totals = media.get('reported_totals') or {}
            stats = result['profile_data'].setdefault('stats', {}) if isinstance(result.get('profile_data'), dict) else None
            for kind in ('albums','gifs'):
                result['canonical_'+kind] = media[kind]
                result[kind] = {'status':'partial','items':media['raw_'+kind],'loaded_count':len(media[kind])}
                if kind in media['pages']:
                    result.setdefault('recent_media_pages',{})[kind] = {'pages':media['pages'][kind],
                        'loaded_count':len(media[kind]),'catalog_complete':False,'date_kind':'unknown'}
                    result['recent_capabilities'][kind] = 'source_listing'
                    if kind == 'albums':
                        result['recent_capabilities']['photos'] = 'source_listing'
                if stats is not None:
                    rep = reported_totals.get(kind)
                    if kind == 'albums':
                        if media[kind] or rep is not None or stats.get('albums'):
                            stats['albums'] = max(stats.get('albums') or 0, rep or 0, len(media[kind]))
                        elif kind in media['errors']:
                            stats['albums'] = None
                    elif rep is not None or media[kind] or stats.get('gifs') is not None:
                        stats['gifs'] = max(stats.get('gifs') or 0, rep or 0, len(media[kind]))
    fallback_avatar = ''
    if isinstance(result.get('profile_data'), dict):
        fallback_avatar = result['profile_data'].get('avatarUrl') or ''
    if not fallback_avatar:
        fallback_avatar = result.get('cover_url') or ''

    playlists_res = {'items': [], 'raw_items': [], 'loaded_count': 0, 'complete': True, 'had_source': False}
    if early_playlists_res is not None:
        playlists_res = early_playlists_res
    else:
        try:
            playlists_res = await read_recent_playlists(
                root_url,
                root_html,
                source,
                client,
                fallback_avatar=fallback_avatar,
                allow_fallback_tab=_is_account_profile_url(root_url) and not result.get('canonical_videos'),
            )
        except (ValueError, httpx.HTTPError, httpcore.NetworkError, httpcore.ProtocolError,
                httpcore.TimeoutException, DirectoryFetchError, OSError, TimeoutError):
            errors.append('playlists')

    result['canonical_playlists'] = playlists_res['items']
    result['playlists'] = {
        'status': 'complete' if playlists_res['complete'] else 'partial',
        'items': playlists_res['raw_items'],
        'loaded_count': playlists_res['loaded_count'],
    }
    if playlists_res['had_source']:
        result['recent_capabilities']['playlists'] = 'source_listing'
        if isinstance(result.get('profile_data'), dict) and playlists_res['loaded_count'] > 0:
            stats = result['profile_data'].setdefault('stats', {})
            stats['playlists'] = max(stats.get('playlists') or 0, playlists_res['loaded_count'])
    else:
        result['recent_capabilities']['playlists'] = 'unverified'

    if not result.get('canonical_videos'):
        has_any_media = bool(result.get('canonical_albums') or result.get('canonical_gifs') or result.get('canonical_playlists'))
        has_valid_identity = bool(result.get('profile_key') and result.get('name'))
        if not has_any_media and not has_valid_identity:
            raise ValueError('Source latest-video listing could not be verified')
        result['recent_capabilities']['videos'] = 'unverified'
    # Never fill unverified media from unrelated/root showcases.
    for key in ('canonical_search_gifs','canonical_highlights'):
        result[key] = []
    for key in ('search_gifs','highlights'):
        result[key] = {'status':'partial', 'items':[], 'loaded_count':0}
    for video in result.get('canonical_videos', []):
        # Existing catalog parsers carry default quality labels; a recent-page
        # read does not resolve actual available streams/quality.
        video.pop('resolution', None)
    result['source_checked_at'] = datetime.now(timezone.utc).isoformat()
    video_dates_incomplete = source == 'eporner' and result.get('publication_dates',{}).get('status') == 'partial'
    result['discovery_errors'] = errors+(['videos'] if video_dates_incomplete else [])
    result['discovery_pending'] = False
    return result


@router.post('/recent')
async def recent_profile(request: RecentProfileRequest):
    try:
        return await read_recent_profile(request.url, request.expected_name, request.known_video_urls, request.known_media_urls)
    except ValueError as error:
        raise HTTPException(422, detail=str(error)) from error
    except (httpx.HTTPError, httpcore.NetworkError, httpcore.ProtocolError, httpcore.TimeoutException,
            DirectoryFetchError, OSError, TimeoutError) as error:
        # The pinned transport can surface httpcore errors directly. Preserve
        # loaded data through a controlled error, not an unhandled ASGI failure.
        raise HTTPException(502, detail={'code':'recent_source_unavailable'}) from error


@router.post('/recent-stream')
async def recent_profile_stream(request: RecentProfileRequest):
    """Stream recent profile root immediately and emit incremental batches in the background."""
    async def events():
        queue = asyncio.Queue(maxsize=32)

        async def emit(profile):
            await queue.put({'type': 'profile', 'profile': profile})

        async def run():
            try:
                profile = await read_recent_profile(
                    request.url,
                    request.expected_name,
                    request.known_video_urls,
                    request.known_media_urls,
                    on_profile=emit,
                )
                await queue.put({'type': 'complete', 'profile': profile})
            except ValueError as error:
                await queue.put({'type': 'error', 'detail': str(error)})
            except (httpx.HTTPError, httpcore.NetworkError, httpcore.ProtocolError, httpcore.TimeoutException,
                    DirectoryFetchError, OSError, TimeoutError):
                await queue.put({'type': 'error', 'detail': 'recent_source_unavailable'})
            except Exception:
                await queue.put({'type': 'error', 'detail': 'Could not complete recent profile discovery'})

        task = asyncio.create_task(run())
        try:
            while True:
                event = await queue.get()
                yield json.dumps(event) + '\n'
                if event['type'] in ('complete', 'error'):
                    break
        finally:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    return StreamingResponse(
        events(),
        media_type='application/x-ndjson',
        headers={'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no'},
    )
