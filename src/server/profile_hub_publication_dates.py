"""Publication-date enrichment for already verified Eporner profile videos.

Search is an optimization, never a discovery source: only exact case-sensitive
IDs from the requested profile page are accepted. Missing IDs use the official
ID method. No credentials, media, disk cache or library writes.
"""
import asyncio
from datetime import datetime, timedelta, timezone
import json
import re
from urllib.parse import urlencode, urlsplit, urlunsplit
import weakref

import httpcore
import httpx
from selectolax.lexbor import LexborHTMLParser
from yt_dlp.extractor.eporner import EpornerIE

from src.core.network_profiles import get_enrichment_api_url
from .profile_directory_transport import DirectoryFetchError, REQUEST_TIMEOUT, _read_bounded_listing
from .profile_hub_execution import https_url

# Official API protocol bound: https://www.eporner.com/api/v2/ . This does not
# limit the profile catalog; only one already-discovered page is enriched.
EPORNER_API_MAX_PAGE_SIZE = 1000
# Reserve source/network capacity for playback and comments rather than issuing
# one metadata request per card simultaneously. Shared across requests per loop.
PUBLICATION_REQUEST_CONCURRENCY = 2
PORNHUB_DATE_LOOKUP_LIMIT = 12
PORNHUB_DATE_CONCURRENCY = 3
PORNHUB_DATE_TIMEOUT = 8.0
PORNHUB_MIN_VALID_YEAR = 2005
_limits = weakref.WeakKeyDictionary()


def video_identity(url):
    if not isinstance(url, str) or not EpornerIE.suitable(url):
        return None
    try:
        return EpornerIE()._match_id(url)
    except (ValueError, AttributeError):
        return None


def publication_record(record, requested):
    """Keep source day precision; the API datetime has no declared timezone."""
    if not isinstance(record, dict):
        return None
    identity = record.get('id')
    if not isinstance(identity, str) or identity not in requested or video_identity(record.get('url')) != identity:
        return None
    raw = record.get('added')
    if not isinstance(raw, str):
        return None
    try:
        day = datetime.strptime(raw, '%Y-%m-%d %H:%M:%S').date().isoformat()
    except ValueError:
        return None
    return identity, {'day':day, 'raw':raw}


async def enrich_publication_dates(profile, client, known_video_urls=()):
    requested = {}
    unrecognized = 0
    for video in profile.get('canonical_videos', []):
        identity = video_identity(video.get('originalUrl'))
        if identity:
            requested[identity] = video['originalUrl']
        else:
            unrecognized += 1
    known = {identity for url in known_video_urls if (identity := video_identity(url)) in requested}
    needed = {identity:url for identity,url in requested.items() if identity not in known}
    diagnostics = {'source':'official_api', 'precision':'day', 'status':'retained',
                   'observed_count':0, 'skipped_client_known':len(known), 'unresolved_count':len(needed)+unrecognized,
                   'search_requests':0, 'id_requests':0}
    if not needed:
        if unrecognized:
            diagnostics['status'] = 'partial'
        profile['publication_dates'] = diagnostics
        return
    dates = {}
    ambiguous = set()
    slots = _limits.setdefault(asyncio.get_running_loop(), asyncio.Semaphore(PUBLICATION_REQUEST_CONCURRENCY))

    async def read(url, kind):
        async with slots:
            diagnostics[kind] += 1
            async with client.stream('GET', url, headers={'Accept':'application/json', 'Accept-Encoding':'identity'}) as response:
                response.raise_for_status()
                if response.headers.get('content-type','').split(';',1)[0] != 'application/json':
                    raise ValueError('Publication source did not return JSON')
                return json.loads(await _read_bounded_listing(response))

    def accept(record, expected_identity=None):
        if expected_identity is not None and (not isinstance(record,dict) or record.get('id') != expected_identity):
            return
        value = publication_record(record, needed)
        if value:
            if expected_identity is None:
                if value[0] in ambiguous:
                    return
                if value[0] in dates and dates[value[0]] != value[1]:
                    del dates[value[0]]
                    ambiguous.add(value[0])
                    return
            else:
                ambiguous.discard(value[0])
            dates[value[0]] = value[1]

    try:
        # This is a work deadline for the whole metadata phase, including queue
        # waits, rather than a fresh timeout multiplied by every missing video.
        async with asyncio.timeout(REQUEST_TIMEOUT):
            allow_id_fallback = True
            if len(needed) > 1 and profile.get('name'):
                first = next(iter(needed))
                api = urlsplit(get_enrichment_api_url(first, requested[first]))
                search = urlunsplit((api.scheme, api.netloc, api.path.removesuffix('id/')+'search/',
                    urlencode({'query':profile['name'], 'per_page':min(len(requested),EPORNER_API_MAX_PAGE_SIZE),
                               'order':'latest', 'gay':1, 'lq':1, 'format':'json'}), ''))
                try:
                    batch = await read(search, 'search_requests')
                    if not isinstance(batch, dict) or not isinstance(batch.get('videos'), list):
                        raise ValueError('Invalid publication search response')
                    for record in batch['videos']:
                        accept(record)
                except httpx.HTTPStatusError as error:
                    # Do not turn a provider overload/rate-limit response into
                    # a burst of per-ID requests. Other search failures can
                    # still use the independent official ID method.
                    allow_id_fallback = error.response.status_code not in (429,503)
                except (ValueError, httpx.HTTPError, httpcore.NetworkError, httpcore.ProtocolError,
                        httpcore.TimeoutException, DirectoryFetchError, OSError):
                    pass

            async def missing(identity, url):
                accept(await read(get_enrichment_api_url(identity,url), 'id_requests'), identity)
            pending = iter((identity,url) for identity,url in needed.items() if identity not in dates)
            async def worker():
                for identity,url in pending:
                    try:
                        await missing(identity,url)
                    except (ValueError, httpx.HTTPError, httpcore.NetworkError, httpcore.ProtocolError,
                            httpcore.TimeoutException, DirectoryFetchError, OSError, TimeoutError):
                        continue
            # A fixed worker set avoids allocating one waiting task per card.
            # The outer deadline cancels workers and retains completed dates.
            if allow_id_fallback:
                await asyncio.gather(*(worker() for _ in range(PUBLICATION_REQUEST_CONCURRENCY)))
    except (ValueError, httpx.HTTPError, httpcore.NetworkError, httpcore.ProtocolError,
            httpcore.TimeoutException, DirectoryFetchError, OSError, TimeoutError):
        pass

    for video in profile.get('canonical_videos', []):
        value = dates.get(video_identity(video.get('originalUrl')))
        if value:
            video.update(uploadedAt=value['day'], timeAgo=value['day'],
                         publicationDateRaw=value['raw'], publicationDatePrecision='day')
    diagnostics.update(observed_count=len(dates), unresolved_count=len(needed)-len(dates)+unrecognized,
                       status='complete' if len(dates)==len(needed) and not unrecognized else 'partial')
    profile['publication_dates'] = diagnostics


def pornhub_video_identity(url):
    if not isinstance(url, str) or not url.strip():
        return None
    try:
        safe = https_url(url.strip())
    except ValueError:
        return None
    from .profile_hub_comment_sources import PornhubCommentsSource
    identity = PornhubCommentsSource.match_watch_identity(safe)
    if not identity:
        return None
    host = urlsplit(safe).netloc
    return identity, f'https://{host}/view_video.php?viewkey={identity}'


def _parse_pornhub_date_candidate(raw, *, now=None):
    if not isinstance(raw, str):
        return None
    cleaned = raw.strip()
    if not cleaned:
        return None
    ref_now = now or datetime.now(timezone.utc)
    if ref_now.tzinfo is None:
        ref_now = ref_now.replace(tzinfo=timezone.utc)

    date_only = re.fullmatch(r'(\d{4})-(\d{2})-(\d{2})', cleaned)
    if date_only:
        try:
            parsed_day = datetime.strptime(cleaned, '%Y-%m-%d').replace(tzinfo=timezone.utc)
        except ValueError:
            return None
        if parsed_day.year < PORNHUB_MIN_VALID_YEAR or parsed_day.date() > (ref_now + timedelta(days=1)).date():
            return None
        return {'raw': cleaned, 'value': cleaned, 'precision': 'day'}

    iso_match = re.fullmatch(
        r'(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?',
        cleaned,
    )
    if not iso_match:
        return None
    normalized = f'{iso_match.group(1)}T{iso_match.group(2)}'
    tz_part = iso_match.group(3)
    if tz_part:
        if tz_part != 'Z' and ':' not in tz_part:
            tz_part = f'{tz_part[:3]}:{tz_part[3:]}'
        normalized = f'{normalized}{tz_part}'
    try:
        parsed_dt = datetime.fromisoformat(normalized)
    except ValueError:
        return None
    if parsed_dt.year < PORNHUB_MIN_VALID_YEAR:
        return None
    if parsed_dt.tzinfo is not None:
        utc_dt = parsed_dt.astimezone(timezone.utc)
        if utc_dt > ref_now + timedelta(days=1):
            return None
        return {'raw': cleaned, 'value': utc_dt.strftime('%Y-%m-%dT%H:%M:%SZ'), 'precision': None}
    # Naive timestamp without timezone: preserve confirmed calendar day only.
    day_str = parsed_dt.strftime('%Y-%m-%d')
    if parsed_dt.date() > (ref_now + timedelta(days=1)).date():
        return None
    return {'raw': cleaned, 'value': day_str, 'precision': 'day'}


def _iter_json_ld_dates(node):
    if isinstance(node, list):
        for item in node:
            yield from _iter_json_ld_dates(item)
        return
    if not isinstance(node, dict):
        return
    for key in ('uploadDate', 'datePublished'):
        val = node.get(key)
        if isinstance(val, str):
            yield val
    graph = node.get('@graph')
    if graph is not None:
        yield from _iter_json_ld_dates(graph)


def extract_pornhub_publication_date(html: str, *, now=None):
    if not isinstance(html, str) or not html:
        return None
    tree = LexborHTMLParser(html)
    for script in tree.css('script[type="application/ld+json"]'):
        body = (script.text() or '').strip()
        if not body:
            continue
        try:
            payload = json.loads(body)
        except (ValueError, TypeError):
            continue
        for candidate in _iter_json_ld_dates(payload):
            parsed = _parse_pornhub_date_candidate(candidate, now=now)
            if parsed is not None:
                return parsed
    for selector in (
        'meta[property="video:release_date"]',
        'meta[itemprop="uploadDate"]',
        'meta[name="upload_date"]',
    ):
        node = tree.css_first(selector)
        if node is None:
            continue
        parsed = _parse_pornhub_date_candidate(node.attributes.get('content'), now=now)
        if parsed is not None:
            return parsed
    return None


async def enrich_pornhub_publication_dates(profile, client, fetch_html, known_video_urls=()):
    videos = profile.get('canonical_videos') or []
    known = set()
    for url in known_video_urls:
        ident = pornhub_video_identity(url)
        if ident is not None:
            known.add(ident[0])

    candidates = []
    skipped_known = 0
    for video in videos:
        ident = pornhub_video_identity(video.get('originalUrl'))
        if ident is None:
            continue
        vid, canonical_url = ident
        if vid in known:
            skipped_known += 1
            continue
        existing = _parse_pornhub_date_candidate(video.get('uploadedAt') or video.get('timeAgo') or '')
        if existing is not None:
            continue
        candidates.append((vid, canonical_url, video))

    targets = candidates[:PORNHUB_DATE_LOOKUP_LIMIT]
    observed = {}
    if targets:
        pending = iter(targets)

        async def worker():
            for vid, canonical_url, _ in pending:
                try:
                    _, html = await fetch_html(canonical_url, 'pornhub', client)
                except (
                    ValueError,
                    httpx.HTTPError,
                    httpcore.NetworkError,
                    httpcore.ProtocolError,
                    httpcore.TimeoutException,
                    DirectoryFetchError,
                    OSError,
                    TimeoutError,
                ):
                    continue
                parsed = extract_pornhub_publication_date(html)
                if parsed is not None:
                    observed[canonical_url] = (vid, parsed)

        try:
            async with asyncio.timeout(PORNHUB_DATE_TIMEOUT):
                worker_count = min(PORNHUB_DATE_CONCURRENCY, len(targets))
                await asyncio.gather(*(worker() for _ in range(worker_count)))
        except (
            ValueError,
            httpx.HTTPError,
            httpcore.NetworkError,
            httpcore.ProtocolError,
            httpcore.TimeoutException,
            DirectoryFetchError,
            OSError,
            TimeoutError,
        ):
            pass

    observed_ids = {}
    for canonical_url, (vid, parsed) in observed.items():
        observed_ids[vid] = parsed

    for vid, canonical_url, video in targets:
        parsed = observed_ids.get(vid)
        if parsed is None:
            continue
        video['uploadedAt'] = parsed['value']
        video['timeAgo'] = parsed['value']
        video['publicationDateRaw'] = parsed['raw']
        if parsed['precision'] == 'day':
            video['publicationDatePrecision'] = 'day'
        else:
            video.pop('publicationDatePrecision', None)

    profile['publication_dates'] = {
        'source': 'pornhub',
        'attempted_count': len(targets),
        'observed_count': len(observed_ids),
        'unresolved_count': max(0, len(targets) - len(observed_ids)),
        'skipped_client_known': skipped_known,
        'status': 'complete' if len(observed_ids) == len(candidates) else 'partial',
    }

