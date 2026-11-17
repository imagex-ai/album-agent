"""Generic, provider-agnostic profile tab discovery and multi-strategy pagination.

Designed following the Open/Closed Principle (OCP) so any profile source
(Eporner, Pornhub, xHamster, generic or future sites) can discover dedicated
videos/albums/playlists tabs and paginate reliably without site-specific hardcoding.
"""
from __future__ import annotations

import asyncio
import re
import time
from typing import Any, Awaitable, Callable, Iterable, Optional, Sequence
from urllib.parse import parse_qs, urlencode, urljoin, urlsplit, urlunsplit

from bs4 import BeautifulSoup

try:
    from selectolax.lexbor import LexborHTMLParser
except Exception:  # pragma: no cover - optional in minimal environments
    LexborHTMLParser = None  # type: ignore[assignment,misc]

DEFAULT_MAX_EXTRA_PAGES = 25

_NEXT_TEXT_TOKENS = frozenset({
    "next",
    "next »",
    "next >",
    "next ›",
    "»",
    "›",
    "próxima",
    "proxima",
    "seguinte",
    "suivante",
    "weiter",
    "siguiente",
})

_SECTION_PATH_KEYWORDS: dict[str, tuple[str, ...]] = {
    "videos": ("/videos", "-videos", "/uploads", "/clips", "/movies", "tab=videos"),
    "albums": ("/photos", "/albums", "/galleries", "/pics", "/pictures", "-pics", "-photos", "-albums", "tab=photos", "tab=albums"),
    "playlists": ("/playlists", "/lists", "/collections", "tab=playlists"),
}

_ITEM_DETAIL_SEGMENT_RE = re.compile(
    r"/(?:video-[a-z0-9]+|view_video|watch(?:/|\?|$)|playlist/[a-z0-9]+|gallery/[a-z0-9]+|photo/[a-z0-9]+|album/)",
    re.IGNORECASE,
)


def _normalize_url(base_url: str, href: str) -> Optional[str]:
    raw = (href or "").strip()
    if not raw or raw.startswith(("#", "javascript:", "mailto:", "data:")):
        return None
    joined = urljoin(base_url, raw)
    parts = urlsplit(joined)
    if parts.scheme not in ("http", "https") or not parts.netloc:
        return None
    return urlunsplit((parts.scheme, parts.netloc, parts.path, parts.query, ""))


def _canonical_path_key(url: str) -> str:
    parts = urlsplit(url)
    return f"{parts.netloc.lower()}{parts.path.rstrip('/') or '/'}?{parts.query}"


def _iter_anchors(html_or_tree: Any) -> list[tuple[str, str, str, str, str, str]]:
    """Return list of (tag, href, rel, text, title_or_aria, parent_classes) across Lexbor/BS4/HTML."""
    anchors: list[tuple[str, str, str, str, str, str]] = []

    if LexborHTMLParser is not None and isinstance(html_or_tree, LexborHTMLParser):
        for el in html_or_tree.css("link[href], a[href]"):
            tag = (el.tag or "a").lower()
            attrs = el.attributes or {}
            href = attrs.get("href") or ""
            rel = str(attrs.get("rel") or "").lower()
            text = el.text(separator=" ", strip=True) if tag == "a" else ""
            label = f"{attrs.get('title') or ''} {attrs.get('aria-label') or ''}".strip().lower()
            parent_cls = ""
            p = el.parent
            depth = 0
            while p is not None and depth < 4:
                p_cls = p.attributes.get("class") if hasattr(p, "attributes") and p.attributes else ""
                if p_cls:
                    parent_cls += " " + str(p_cls)
                p = p.parent
                depth += 1
            cls = str(attrs.get("class") or "").lower()
            anchors.append((tag, href, rel, text, f"{label} {cls}".strip(), parent_cls.lower()))
        return anchors

    soup = html_or_tree if isinstance(html_or_tree, BeautifulSoup) else BeautifulSoup(str(html_or_tree or ""), "html.parser")
    for el in soup.find_all(["link", "a"], href=True):
        tag = el.name.lower()
        href = str(el.get("href") or "")
        raw_rel = el.get("rel")
        rel = " ".join(str(x) for x in raw_rel).lower() if isinstance(raw_rel, list) else str(raw_rel or "").lower()
        text = el.get_text(" ", strip=True) if tag == "a" else ""
        raw_cls = el.get("class")
        cls = " ".join(str(x) for x in raw_cls).lower() if isinstance(raw_cls, list) else str(raw_cls or "").lower()
        label = f"{el.get('title') or ''} {el.get('aria-label') or ''} {cls}".strip().lower()
        parent_cls = " ".join(
            " ".join(str(c) for c in (p.get("class") or [])) if isinstance(p.get("class"), list) else str(p.get("class") or "")
            for p in list(el.parents)[:4]
            if hasattr(p, "get")
        ).lower()
        anchors.append((tag, href, rel, text, label, parent_cls))
    return anchors


def discover_profile_section_urls(
    profile_url: str,
    html_or_tree: Any,
    *,
    fallback_suffixes: Optional[dict[str, tuple[str, ...]]] = None,
) -> dict[str, list[str]]:
    """Discover dedicated videos/albums/playlists tab URLs from a profile root page.

    Keeps discovered URLs strictly scoped to the same host and profile path prefix
    so unrelated site navigation links are never followed.
    """
    discovered: dict[str, list[str]] = {"videos": [], "albums": [], "playlists": []}
    seen_per_section: dict[str, set[str]] = {k: set() for k in discovered}

    root_parts = urlsplit(profile_url)
    root_host = root_parts.netloc.lower().removeprefix("www.")
    root_path = root_parts.path.rstrip("/") or "/"
    root_key = _canonical_path_key(profile_url)

    def _add(section: str, candidate_url: Optional[str]) -> None:
        if not candidate_url:
            return
        key = _canonical_path_key(candidate_url)
        if key == root_key or key in seen_per_section[section]:
            return
        seen_per_section[section].add(key)
        discovered[section].append(candidate_url)

    for tag, href, _rel, text, label, _parent_cls in _iter_anchors(html_or_tree):
        if tag != "a":
            continue
        candidate = _normalize_url(profile_url, href)
        if not candidate:
            continue
        parts = urlsplit(candidate)
        cand_host = parts.netloc.lower().removeprefix("www.")
        if cand_host != root_host:
            continue
        cand_path = parts.path.rstrip("/") or "/"
        # Must stay under the exact profile path prefix (case-insensitive)
        root_low = root_path.lower()
        cand_low = cand_path.lower()
        root_prefix = root_low.rstrip("/") + "/"
        if root_low != "/" and cand_low != root_low and not cand_low.startswith(root_prefix):
            continue
        if _ITEM_DETAIL_SEGMENT_RE.search(cand_path):
            continue

        haystack_url = f"{cand_path.lower()}?{parts.query.lower()}"
        text_lower = text.strip().lower()
        if text_lower in ('all videos', 'todos os vídeos', 'todos os videos'):
            _add('videos', candidate)
            continue
        for section, keywords in _SECTION_PATH_KEYWORDS.items():
            if any(kw in haystack_url for kw in keywords):
                _add(section, candidate)
                break
            if (
                text_lower in (section, section.rstrip("s"))
                or re.match(rf"^{re.escape(section)}(?:\s*\(?\d+\)?)?$", text_lower)
                or any(kw.strip("/") == text_lower for kw in keywords if kw.startswith("/"))
            ):
                if section in label or section in text_lower:
                    _add(section, candidate)
                    break

    if fallback_suffixes:
        base = profile_url.rstrip("/") + "/"
        for section, suffixes in fallback_suffixes.items():
            if section not in discovered:
                continue
            for suffix in suffixes:
                _add(section, urljoin(base, suffix.lstrip("/")))

    return discovered


def extract_next_page_urls(
    current_url: str,
    html_or_tree: Any,
    *,
    current_page_num: int = 1,
    section_prefix: Optional[str] = None,
) -> list[str]:
    """Multi-strategy next-page URL discovery (rel=next, CSS selectors, text, numbered links)."""
    origin = urlsplit(current_url)
    origin_host = origin.netloc.lower().removeprefix("www.")
    prefix = (section_prefix or re.sub(r"\d+/?$", "", origin.path.rstrip("/") + "/")).rstrip("/") + "/"
    current_key = _canonical_path_key(current_url)

    anchors = _iter_anchors(html_or_tree)
    candidates: list[str] = []
    seen_keys: set[str] = {current_key}

    def _accept(href: str) -> Optional[str]:
        cand = _normalize_url(current_url, href)
        if not cand:
            return None
        parts = urlsplit(cand)
        if parts.netloc.lower().removeprefix("www.") != origin_host:
            return None
        key = _canonical_path_key(cand)
        if key in seen_keys:
            return None
        return cand

    # Strategy 1: rel="next"
    for _tag, href, rel, _text, _label, _pcls in anchors:
        if "next" in rel.split():
            cand = _accept(href)
            if cand:
                seen_keys.add(_canonical_path_key(cand))
                candidates.append(cand)

    # Strategy 2: Pagination CSS classes / labels / text
    for tag, href, _rel, text, label, parent_cls in anchors:
        if tag != "a":
            continue
        t_low = text.strip().lower()
        is_next_label = (
            t_low in _NEXT_TEXT_TOKENS
            or "next page" in label
            or "próxima" in label
            or "proxima" in label
            or "pagination-next" in label
            or "next-page" in label
            or "next_page" in label
        )
        if is_next_label:
            cand = _accept(href)
            if cand:
                parts = urlsplit(cand)
                if parts.path.startswith(prefix) or prefix == "/":
                    seen_keys.add(_canonical_path_key(cand))
                    candidates.append(cand)

    # Strategy 3: Numbered pagination (current_page_num + 1, or >= 2 inside pagination containers)
    target_num = str(current_page_num + 1)
    for tag, href, _rel, text, _label, parent_cls in anchors:
        if tag != "a":
            continue
        in_pag_container = any(kw in parent_cls for kw in ("numlist", "pag", "page", "paging", "nav"))
        if not in_pag_container:
            continue
        cand = _accept(href)
        if not cand:
            continue
        parts = urlsplit(cand)
        suffix = parts.path[len(prefix):] if parts.path.startswith(prefix) else ""
        qs = parse_qs(parts.query)
        page_param = qs.get("page", qs.get("p", [None]))[0]
        is_numeric_suffix = bool(re.fullmatch(r"\d+/?", suffix)) and int(suffix.strip("/")) >= 2
        is_numeric_query = bool(page_param and page_param.isdigit() and int(page_param) >= 2)
        if text.strip() == target_num or is_numeric_suffix or is_numeric_query:
            if parts.path.startswith(prefix) or is_numeric_query:
                seen_keys.add(_canonical_path_key(cand))
                candidates.append(cand)

    return candidates


async def collect_paginated_section(
    client: Any,
    start_urls: Sequence[str],
    *,
    extract_fn: Callable[[str, str], tuple[list[dict[str, Any]], list[dict[str, Any]]]],
    item_key_fn: Callable[[dict[str, Any]], str],
    max_pages: Optional[int] = DEFAULT_MAX_EXTRA_PAGES,
    concurrency: int = 6,
    initial_pages: Optional[list[tuple[str, str]]] = None,
    section_prefix: Optional[str] = None,
    fetch_fn: Optional[Callable[[str], Awaitable[tuple[int, str, str]]]] = None,
    on_batch: Optional[Callable[[list[dict[str, Any]], list[dict[str, Any]]], Any]] = None,
    delay_seconds: float = 0.0,
) -> tuple[list[tuple[list[dict[str, Any]], list[dict[str, Any]]]], bool]:
    """Fetch and paginate one or more section URLs concurrently with loop/duplicate guards.

    Returns (batches, complete) where batches is a list of (canonical, raw) tuples.
    """
    batches: list[tuple[list[dict[str, Any]], list[dict[str, Any]]]] = []
    seen_pages: set[str] = set()
    seen_items: set[str] = set()
    complete = True
    pages_fetched = 0

    pending: list[str] = []
    for url in start_urls:
        key = _canonical_path_key(url)
        if key not in seen_pages:
            seen_pages.add(key)
            pending.append(url)

    def _consume_html(page_url: str, html: str, page_num: int) -> list[str]:
        can, raw = extract_fn(page_url, html)
        new_can, new_raw = [], []
        for idx, c in enumerate(can):
            r = raw[idx] if idx < len(raw) else {}
            ikey = item_key_fn(c)
            if not ikey or ikey in seen_items:
                continue
            seen_items.add(ikey)
            new_can.append(c)
            new_raw.append(r)
        if new_can:
            batches.append((new_can, new_raw))
        if not new_can:
            return []
        next_urls: list[str] = []
        for cand in extract_next_page_urls(
            page_url,
            html,
            current_page_num=page_num,
            section_prefix=section_prefix,
        ):
            ckey = _canonical_path_key(cand)
            if ckey not in seen_pages:
                seen_pages.add(ckey)
                next_urls.append(cand)
        return next_urls

    if initial_pages:
        for p_url, p_html in initial_pages:
            seen_pages.add(_canonical_path_key(p_url))
            pages_fetched += 1
            pending.extend(_consume_html(p_url, p_html, pages_fetched))

    sem = asyncio.Semaphore(max(1, concurrency))

    while pending and (max_pages is None or max_pages <= 0 or pages_fetched < max_pages):
        if max_pages is not None and max_pages > 0:
            remaining = max_pages - pages_fetched
            batch = pending[:remaining]
            pending = pending[remaining:]
        else:
            batch = pending[:concurrency]
            pending = pending[concurrency:]

        async def _fetch(url: str):
            async with sem:
                if fetch_fn is not None:
                    res = await fetch_fn(url)
                    if res[0] in (429, 503):
                        await asyncio.sleep(2.0)
                        res = await fetch_fn(url)
                    return url, res
                resp = await client.get(url)
                if getattr(resp, "status_code", 0) in (429, 503):
                    retry_after = getattr(resp, "headers", {}).get("retry-after", "")
                    wait_s = min(10.0, float(retry_after)) if str(retry_after).isdigit() else 2.0
                    await asyncio.sleep(wait_s)
                    resp = await client.get(url)
            return url, resp

        results = await asyncio.gather(*(_fetch(u) for u in batch), return_exceptions=True)
        for item in results:
            if isinstance(item, Exception):
                if isinstance(item, asyncio.CancelledError):
                    raise item
                complete = False
                continue
            req_url, payload = item
            if fetch_fn is not None:
                status, final_page_url, html_body = payload
            else:
                status = getattr(payload, "status_code", 0)
                final_page_url = str(getattr(payload, "url", req_url))
                html_body = payload.text if status == 200 else ""
            if status == 404:
                continue
            if status != 200:
                complete = False
                continue
            pages_fetched += 1
            seen_pages.add(_canonical_path_key(final_page_url))
            prev_len = len(batches)
            discovered_next = _consume_html(final_page_url, html_body, pages_fetched)
            if on_batch is not None and len(batches) > prev_len:
                for b_can, b_raw in batches[prev_len:]:
                    res_cb = on_batch(b_can, b_raw)
                    if asyncio.iscoroutine(res_cb):
                        await res_cb
            pending.extend(discovered_next)
        if pending and delay_seconds > 0:
            await asyncio.sleep(delay_seconds)

    return batches, complete


_STREAM_CURSOR_RE = re.compile(r"(?:EP_UP_)?streamCursor\s*=\s*([\"'])([^\"']+)\1")
_STREAM_POS_RE = re.compile(r"(?:EP_UP_)?streamPos\s*=\s*(\d+)")
_STREAM_HAS_MORE_RE = re.compile(r"(?:EP_UP_)?streamHasMore\s*=\s*(true|false)", re.I)
_CSRF_TOKEN_RE = re.compile(r"""(?:csrfToken|csrf_token)\s*[:=]\s*([\"'])([A-Za-z0-9_\-.:]{16,})\1""")


def _extract_csrf_token(html: str) -> str:
    if not html:
        return ""
    m = _CSRF_TOKEN_RE.search(html)
    if m:
        return m.group(2)
    soup = BeautifulSoup(html, "html.parser")
    meta = soup.select_one('meta[name="csrf-token"][content], input[name="csrf_token"][value], input[name="_token"][value]')
    if meta is not None:
        return str(meta.get("content") or meta.get("value") or "").strip()
    return ""


def discover_infinite_scroll_streams(page_url: str, html: str) -> list[dict[str, Any]]:
    """Detect declared cursor-based infinite-scroll streams in an HTML page."""
    if not html:
        return []
    streams: list[dict[str, Any]] = []

    cursor_match = _STREAM_CURSOR_RE.search(html)
    if cursor_match:
        has_more_match = _STREAM_HAS_MORE_RE.search(html)
        has_more = True if not has_more_match else (has_more_match.group(1).lower() == "true")
        if has_more:
            pos_match = _STREAM_POS_RE.search(html)
            csrf = _extract_csrf_token(html)
            streams.append({
                "kind": "post_cursor",
                "endpoint": page_url,
                "cursor": cursor_match.group(2),
                "pos": int(pos_match.group(1)) if pos_match else 0,
                "csrf_token": csrf,
            })

    soup = BeautifulSoup(html, "html.parser")
    for el in soup.select("[data-next-cursor], [data-cursor][data-endpoint], [data-cursor][data-more-url]"):
        cursor_val = (el.get("data-next-cursor") or el.get("data-cursor") or "").strip()
        endpoint_raw = (el.get("data-endpoint") or el.get("data-more-url") or "").strip()
        endpoint = _normalize_url(page_url, endpoint_raw) if endpoint_raw else page_url
        if cursor_val and endpoint and not any(s.get("cursor") == cursor_val for s in streams):
            csrf = _extract_csrf_token(html)
            streams.append({
                "kind": "post_cursor",
                "endpoint": endpoint,
                "cursor": cursor_val,
                "pos": 0,
                "csrf_token": csrf,
            })

    return streams


async def collect_cursor_stream(
    client: Any,
    page_url: str,
    initial_html: str,
    *,
    extract_fn: Callable[[str, str], tuple[list[dict[str, Any]], list[dict[str, Any]]]],
    item_key_fn: Callable[[dict[str, Any]], str],
    max_batches: Optional[int] = DEFAULT_MAX_EXTRA_PAGES,
    max_duration_seconds: Optional[float] = 12.0,
    initial_seen_keys: Optional[Iterable[str]] = None,
    stop_on_keys: Optional[Iterable[str]] = None,
    post_fn: Optional[Callable[[str, dict[str, Any]], Awaitable[tuple[int, dict[str, Any]]]]] = None,
    on_batch: Optional[Callable[[list[dict[str, Any]], list[dict[str, Any]]], Any]] = None,
    delay_seconds: float = 0.25,
) -> tuple[list[tuple[list[dict[str, Any]], list[dict[str, Any]]]], bool]:
    """Follow cursor-based infinite-scroll AJAX streams with loop and duplicate guards."""
    streams = discover_infinite_scroll_streams(page_url, initial_html)
    if not streams:
        return [], True

    batches: list[tuple[list[dict[str, Any]], list[dict[str, Any]]]] = []
    seen_items: set[str] = set(initial_seen_keys or ())
    stop_keys: set[str] = set(stop_on_keys or ())
    complete = True

    deadline = time.monotonic() + max_duration_seconds if (max_duration_seconds is not None and max_duration_seconds > 0) else None
    for stream in streams:
        cursor = stream["cursor"]
        pos = stream.get("pos", 0)
        endpoint = stream["endpoint"]
        csrf_token = stream.get("csrf_token") or ""
        req_headers = {
            "X-Requested-With": "XMLHttpRequest",
            "Referer": page_url,
        }
        if csrf_token:
            req_headers["X-CSRF-TOKEN"] = csrf_token
        seen_cursors: set[str] = set()
        fetched = 0

        while cursor and cursor not in seen_cursors and (max_batches is None or max_batches <= 0 or fetched < max_batches):
            if deadline is not None and time.monotonic() >= deadline:
                complete = False
                break
            seen_cursors.add(cursor)
            fetched += 1
            payload = {"xhr": "true", "curPos": pos, "cursor": cursor}
            try:
                if post_fn is not None:
                    status, data = await post_fn(endpoint, payload)
                else:
                    resp = await client.post(
                        endpoint,
                        data=payload,
                        headers=req_headers,
                    )
                    if getattr(resp, "status_code", 0) in (301, 302, 303, 307, 308):
                        loc = resp.headers.get("location") if hasattr(resp, "headers") else None
                        if loc:
                            redir_url = _normalize_url(endpoint, loc)
                            if redir_url and urlsplit(redir_url).netloc.lower().removeprefix("www.") == urlsplit(endpoint).netloc.lower().removeprefix("www."):
                                endpoint = redir_url
                                resp = await client.post(endpoint, data=payload, headers=req_headers)
                    status = getattr(resp, "status_code", 0)
                    if status in (429, 503):
                        await asyncio.sleep(2.5)
                        resp = await client.post(endpoint, data=payload, headers=req_headers)
                        status = getattr(resp, "status_code", 0)
                    data = resp.json() if status == 200 else {}
            except Exception:
                complete = False
                break

            if status != 200 or not isinstance(data, dict):
                complete = False
                break
            st = data.get("status")
            if st is not None and st not in (1, "1", True, "ok"):
                break

            chunk_html = data.get("html") or ""
            if not chunk_html:
                break

            can, raw = extract_fn(page_url, chunk_html)
            new_can, new_raw = [], []
            hit_known = False
            for idx, c in enumerate(can):
                r = raw[idx] if idx < len(raw) else {}
                ikey = item_key_fn(c)
                if not ikey:
                    continue
                if ikey in stop_keys:
                    hit_known = True
                    continue
                if ikey in seen_items:
                    continue
                seen_items.add(ikey)
                new_can.append(c)
                new_raw.append(r)

            if new_can:
                batches.append((new_can, new_raw))
                if on_batch is not None:
                    res_cb = on_batch(new_can, new_raw)
                    if asyncio.iscoroutine(res_cb):
                        await res_cb

            if hit_known or not new_can:
                break

            has_more = data.get("hasMore")
            if has_more is False:
                break

            next_cursor = data.get("cursor")
            if not isinstance(next_cursor, str) or not next_cursor or next_cursor in seen_cursors:
                if "hasMore" not in data and data.get("count", 0) == 0:
                    break
                if not next_cursor:
                    break
            cursor = next_cursor if isinstance(next_cursor, str) else ""
            if isinstance(data.get("streamPos"), int):
                pos = data["streamPos"]
            elif isinstance(data.get("count"), int):
                pos += data["count"]
            else:
                pos += len(can)
            if delay_seconds > 0:
                await asyncio.sleep(delay_seconds)

    return batches, complete


_YT_API_KEY_RE = re.compile(r'"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"')
_YT_CLIENT_VER_RE = re.compile(r'"INNERTUBE_CLIENT_VERSION"\s*:\s*"([^"]+)"')


def _extract_yt_continuation_token(obj: Any) -> Optional[str]:
    if isinstance(obj, dict):
        cmd = obj.get("continuationCommand")
        if isinstance(cmd, dict) and isinstance(cmd.get("token"), str) and cmd["token"]:
            return cmd["token"]
        for v in obj.values():
            tok = _extract_yt_continuation_token(v)
            if tok:
                return tok
    elif isinstance(obj, list):
        for item in obj:
            tok = _extract_yt_continuation_token(item)
            if tok:
                return tok
    return None


async def collect_youtube_continuation_stream(
    client: Any,
    page_url: str,
    initial_html: str,
    initial_data: Optional[dict[str, Any]],
    *,
    extract_fn: Callable[[str, Any], tuple[list[dict[str, Any]], list[dict[str, Any]]]],
    item_key_fn: Callable[[dict[str, Any]], str],
    initial_seen_keys: Optional[Iterable[str]] = None,
    max_batches: Optional[int] = None,
    delay_seconds: float = 0.45,
    on_batch: Optional[Callable[[list[dict[str, Any]], list[dict[str, Any]]], Any]] = None,
) -> tuple[list[tuple[list[dict[str, Any]], list[dict[str, Any]]]], bool]:
    """Follow YouTube continuation tokens 1 request at a time with gentle pacing."""
    if not initial_html or not initial_data:
        return [], True
    api_m = _YT_API_KEY_RE.search(initial_html)
    if not api_m:
        return [], True
    api_key = api_m.group(1)
    ver_m = _YT_CLIENT_VER_RE.search(initial_html)
    client_ver = ver_m.group(1) if ver_m else "2.20240101.00.00"

    token = _extract_yt_continuation_token(initial_data)
    if not token:
        return [], True

    batches: list[tuple[list[dict[str, Any]], list[dict[str, Any]]]] = []
    seen_items: set[str] = set(initial_seen_keys or ())
    seen_tokens: set[str] = set()
    complete = True
    fetched = 0
    endpoint = f"https://www.youtube.com/youtubei/v1/browse?key={api_key}"
    headers = {"Content-Type": "application/json", "Origin": "https://www.youtube.com", "Referer": page_url}

    while token and token not in seen_tokens and (max_batches is None or max_batches <= 0 or fetched < max_batches):
        seen_tokens.add(token)
        fetched += 1
        payload = {
            "context": {"client": {"clientName": "WEB", "clientVersion": client_ver}},
            "continuation": token,
        }
        try:
            resp = await client.post(endpoint, json=payload, headers=headers)
            status = getattr(resp, "status_code", 0)
            if status in (429, 503):
                await asyncio.sleep(3.0)
                resp = await client.post(endpoint, json=payload, headers=headers)
                status = getattr(resp, "status_code", 0)
            if status != 200:
                complete = False
                break
            data = resp.json()
        except Exception:
            complete = False
            break

        if not isinstance(data, dict):
            break

        can, raw = extract_fn(page_url, data)
        new_can, new_raw = [], []
        for idx, c in enumerate(can):
            r = raw[idx] if idx < len(raw) else {}
            ikey = item_key_fn(c)
            if not ikey or ikey in seen_items:
                continue
            seen_items.add(ikey)
            new_can.append(c)
            new_raw.append(r)

        if new_can:
            batches.append((new_can, new_raw))
            if on_batch is not None:
                res_cb = on_batch(new_can, new_raw)
                if asyncio.iscoroutine(res_cb):
                    await res_cb

        next_token = _extract_yt_continuation_token(data)
        if not next_token or next_token in seen_tokens or not new_can:
            break
        token = next_token
        if delay_seconds > 0:
            await asyncio.sleep(delay_seconds)

    return batches, complete
