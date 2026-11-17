"""Signals that a saved progressive stream must be resolved from its source.

This detects a changed delivery route, not the visual identity of arbitrary
media. No site names, fallback filenames or size thresholds are assumed.
"""
from urllib.parse import urlsplit

from .media_classification import VIDEO_FORMATS, media_source_format
from .network_profiles import extract_canonical_target_page


def redirected_progressive_video(response, requested_url: str, source_page: str | None) -> bool:
    if response.status_code not in (200, 206) or not getattr(response, 'history', None):
        return False
    if media_source_format(requested_url) not in VIDEO_FORMATS - {'m3u8'}:
        return False
    # Adaptive segments refer to their manifest, not a canonical watch page.
    if not source_page or media_source_format(source_page):
        return False
    if not extract_canonical_target_page(source_page):
        return False
    source = urlsplit(source_page)
    requested = urlsplit(requested_url)
    final = urlsplit(str(getattr(response, 'url', '') or ''))
    content_type = response.headers.get('content-type', '').lower().split(';', 1)[0]
    return bool(source.scheme in ('http', 'https') and source.hostname
        and requested.hostname and final.hostname and requested.hostname != final.hostname
        and (content_type.startswith('video/') or content_type == 'application/octet-stream'))
