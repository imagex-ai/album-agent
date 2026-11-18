"""Bounded HTTPS listing transport with DNS validation and pinned connections."""
from __future__ import annotations

import asyncio
import ipaddress
import socket
import ssl
import time
import zlib
from urllib.parse import urljoin

import certifi
import httpcore

from .profile_directory_manifest import DirectoryAdapter

MAX_HTML_BYTES = 4 * 1024 * 1024
MAX_REDIRECTS = 6
REQUEST_TIMEOUT = 25
DNS_TIMEOUT = 5
MAX_CHALLENGE_ATTEMPTS = 3
_FAILED_IP_TTL_SECONDS = 120.0
_RETRYABLE_FETCH_CODES = frozenset({
    "directory_timeout",
    "directory_connection_failed",
    "directory_upstream_error",
    "directory_dns_unavailable",
})
_failed_ips: dict[tuple[str, int], float] = {}
_inflight_source_reads: dict[tuple[int, str, str], "_SharedRead"] = {}


def clear_source_html_cache() -> None:
    """Drop in-flight shared source reads and failed-IP demotion entries (for tests)."""
    _inflight_source_reads.clear()
    _failed_ips.clear()


def _default_public_ssl_context() -> ssl.SSLContext:
    # Prefer the maintained certifi root bundle (needed on Windows where older
    # Schannel stores miss intermediate chains such as ISRG Root X1), while
    # keeping system trust roots loaded and full certificate verification on.
    context = ssl.create_default_context(cafile=certifi.where())
    context.load_default_certs()
    return context


def _mark_ip_failed(address: str, port: int) -> None:
    now = time.monotonic()
    for key, exp in list(_failed_ips.items()):
        if exp <= now:
            _failed_ips.pop(key, None)
    _failed_ips[(address, port)] = now + _FAILED_IP_TTL_SECONDS


def _clear_ip_failed(address: str, port: int) -> None:
    _failed_ips.pop((address, port), None)


def _order_addresses_healthy_first(addresses: list[str], port: int) -> list[str]:
    now = time.monotonic()
    healthy: list[str] = []
    demoted: list[str] = []
    for addr in addresses:
        exp = _failed_ips.get((addr, port))
        if exp and exp > now:
            demoted.append(addr)
        else:
            if exp is not None:
                _failed_ips.pop((addr, port), None)
            healthy.append(addr)
    return healthy + demoted


class DirectoryFetchError(Exception):
    def __init__(self, code: str, *, status: int = 502, retry_after: str | None = None):
        super().__init__(code)
        self.code = code
        self.status = status
        self.retry_after = retry_after


async def resolve_public_addresses(host: str, port: int) -> list[str]:
    try:
        records = await asyncio.wait_for(
            asyncio.get_running_loop().getaddrinfo(host, port, type=socket.SOCK_STREAM),
            timeout=DNS_TIMEOUT,
        )
    except (OSError, asyncio.TimeoutError) as exc:
        raise DirectoryFetchError("directory_dns_unavailable", status=503) from exc
    addresses = list(dict.fromkeys(record[4][0] for record in records))
    if not addresses:
        raise DirectoryFetchError("directory_dns_unavailable", status=503)
    for raw in addresses:
        try:
            address = ipaddress.ip_address(raw)
        except ValueError as exc:
            raise DirectoryFetchError("unsafe_directory_address", status=400) from exc
        mapped = getattr(address, "ipv4_mapped", None)
        effective = mapped or address
        if (not effective.is_global or effective.is_multicast or effective.is_reserved
                or getattr(address, "sixtofour", None) or getattr(address, "teredo", None)):
            raise DirectoryFetchError("unsafe_directory_address", status=400)
    return _order_addresses_healthy_first(addresses, port)


class _TrackingAsyncStream(httpcore.AsyncNetworkStream):
    """Demote an IP if post-TCP TLS handshake stalls or fails on it."""

    def __init__(self, inner: httpcore.AsyncNetworkStream, address: str, port: int):
        self._inner = inner
        self._address = address
        self._port = port

    async def start_tls(self, ssl_context, server_hostname=None, timeout=None):
        try:
            tls_stream = await self._inner.start_tls(
                ssl_context, server_hostname=server_hostname, timeout=timeout
            )
            _clear_ip_failed(self._address, self._port)
            return tls_stream
        except (
            httpcore.ConnectError,
            httpcore.ConnectTimeout,
            httpcore.TimeoutException,
            ssl.SSLError,
            TimeoutError,
            OSError,
        ):
            _mark_ip_failed(self._address, self._port)
            raise

    async def read(self, max_bytes, timeout=None):
        return await self._inner.read(max_bytes, timeout=timeout)

    async def write(self, buffer, timeout=None):
        return await self._inner.write(buffer, timeout=timeout)

    async def aclose(self):
        return await self._inner.aclose()

    def get_extra_info(self, info):
        return self._inner.get_extra_info(info)

    def __getattr__(self, name):
        return getattr(self._inner, name)


class PublicNetworkBackend(httpcore.AsyncNetworkBackend):
    """Pin the validated IP at connect time; httpcore preserves origin TLS SNI."""
    def __init__(self):
        self.backend = httpcore.AnyIOBackend()

    async def connect_tcp(self, host, port, timeout=None, local_address=None, socket_options=None):
        if port != 443:
            raise DirectoryFetchError("unsafe_directory_port", status=400)
        addresses = await resolve_public_addresses(host, port)
        last_error = None
        for address in addresses:
            try:
                # Connecting to the numeric address prevents a second DNS lookup
                # from changing the destination after validation (DNS rebinding).
                connect_timeout = min(timeout, 2.0) if timeout is not None else 2.0
                stream = await self.backend.connect_tcp(address, port, connect_timeout, local_address, socket_options)
                _clear_ip_failed(address, port)
                return _TrackingAsyncStream(stream, address, port)
            except (httpcore.ConnectError, httpcore.ConnectTimeout, OSError) as exc:
                _mark_ip_failed(address, port)
                last_error = exc
        raise DirectoryFetchError("directory_connection_failed", status=503) from last_error

    async def sleep(self, seconds):
        await asyncio.sleep(seconds)


def directory_pool(*, ssl_context: ssl.SSLContext | None = None):
    # No environment proxy, cookie jar, application browser, cloud or storage.
    if ssl_context is not None and (ssl_context.verify_mode != ssl.CERT_REQUIRED or not ssl_context.check_hostname):
        raise ValueError("unsafe_tls_context")
    return httpcore.AsyncConnectionPool(
        ssl_context=ssl_context if ssl_context is not None else _default_public_ssl_context(),
        network_backend=PublicNetworkBackend(),
        max_connections=2, max_keepalive_connections=0, retries=0,
    )


def solve_js_challenge(html: str) -> dict[str, str]:
    import re
    from .profile_cookie_runtime import calculate_cookie_script
    m = re.search(r"<script[^>]*>(.*?)</script>", html, re.DOTALL)
    if not m or "leastFactor" not in m.group(1):
        return {}
    return calculate_cookie_script(m.group(1))


DEFAULT_TRANSPORT_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9,pt-BR;q=0.8,pt;q=0.7",
}


async def _read_bounded_listing(response) -> str:
    """Bound both wire and decoded bytes, including compressed source HTML."""
    length = response.headers.get('content-length', '')
    if length.isdigit() and int(length) > MAX_HTML_BYTES:
        raise DirectoryFetchError('directory_response_too_large')
    encoding = response.headers.get('content-encoding', 'identity').strip().lower()
    if encoding not in ('identity', '', 'gzip', 'deflate'):
        raise DirectoryFetchError('directory_unsupported_encoding')
    decoder = zlib.decompressobj(zlib.MAX_WBITS | 16) if encoding == 'gzip' else (
        zlib.decompressobj() if encoding == 'deflate' else None)
    wire_bytes = 0
    body = bytearray()
    try:
        async for chunk in response.aiter_raw():
            wire_bytes += len(chunk)
            if wire_bytes > MAX_HTML_BYTES:
                raise DirectoryFetchError('directory_response_too_large')
            remaining = MAX_HTML_BYTES - len(body)
            decoded = decoder.decompress(chunk, remaining + 1) if decoder else chunk
            if len(decoded) > remaining:
                raise DirectoryFetchError('directory_response_too_large')
            body.extend(decoded)
        if decoder and (not decoder.eof or decoder.unused_data):
            raise DirectoryFetchError('directory_unsupported_encoding')
    except zlib.error as exc:
        raise DirectoryFetchError('directory_unsupported_encoding') from exc
    return bytes(body).decode('utf-8', errors='replace')


async def _fetch_public_httpx_listing(adapter: DirectoryAdapter, url: str, *, kind: str = 'directory') -> tuple[str, str]:
    """Same public/DNS-pinned owner as execution, with bounded decoded HTML.

    HTTPX handles valid content encodings for these adapters; redirects are
    inspected before issuing a second request, never followed automatically.
    """
    import httpx
    # Import lazily: the execution bridge imports directory_pool from here.
    # This class is import-safe and opens neither storage nor application state.
    from .profile_hub_execution_runtime import PublicHTTPSHttpxTransport
    headers = {**DEFAULT_TRANSPORT_HEADERS, 'Accept-Encoding': 'identity'}
    requested_page = adapter.normalize_url(url, kind=kind)
    seen = set()
    challenges_solved = 0
    try:
        async with asyncio.timeout(REQUEST_TIMEOUT):
            async with httpx.AsyncClient(transport=PublicHTTPSHttpxTransport(),
                    timeout=REQUEST_TIMEOUT, follow_redirects=False, headers=headers) as client:
                for attempt in range(MAX_REDIRECTS + 1):
                    if url in seen:
                        raise DirectoryFetchError('directory_redirect_loop')
                    seen.add(url)
                    async with client.stream('GET', url) as response:
                        if response.status_code in (301, 302, 303, 307, 308):
                            location = response.headers.get('location')
                            if not location:
                                raise DirectoryFetchError('invalid_directory_redirect')
                            target = urljoin(url, location)
                            try:
                                normalized = adapter.normalize_url(target, kind=kind)
                            except ValueError as exc:
                                raise DirectoryFetchError('unsafe_directory_redirect', status=400) from exc
                            if normalized != requested_page:
                                raise DirectoryFetchError('directory_redirect_changed_context', status=400)
                            if attempt >= MAX_REDIRECTS:
                                raise DirectoryFetchError('directory_redirect_limit')
                            url = target
                            continue
                        if response.status_code == 429:
                            retry_after = response.headers.get('retry-after', '')
                            raise DirectoryFetchError('directory_rate_limited', status=429,
                                retry_after=retry_after if retry_after.isdigit() and len(retry_after) <= 6 else None)
                        if response.status_code != 200:
                            raise DirectoryFetchError('directory_upstream_error')
                        content_type = response.headers.get('content-type', '').split(';', 1)[0].strip().lower()
                        if content_type not in ('text/html', 'application/xhtml+xml'):
                            raise DirectoryFetchError('directory_expected_html')
                        html = await _read_bounded_listing(response)
                        if not html:
                            raise DirectoryFetchError('directory_upstream_error')
                        if 'leastFactor' in html:
                            if challenges_solved >= MAX_CHALLENGE_ATTEMPTS or attempt >= MAX_REDIRECTS:
                                raise DirectoryFetchError('directory_upstream_error')
                            solved = await asyncio.to_thread(solve_js_challenge, html)
                            if not solved:
                                raise DirectoryFetchError('directory_upstream_error')
                            for name, value in solved.items():
                                client.cookies.set(name, value)
                            challenges_solved += 1
                            seen.discard(url)
                            continue
                        return adapter.normalize_url(url, kind=kind), html
                raise DirectoryFetchError('directory_redirect_limit')
    except DirectoryFetchError:
        raise
    except (TimeoutError, httpx.TimeoutException, httpcore.TimeoutException) as exc:
        raise DirectoryFetchError('directory_timeout', status=504) from exc
    except (httpx.HTTPError, httpcore.NetworkError, httpcore.ProtocolError, OSError) as exc:
        raise DirectoryFetchError('directory_connection_failed', status=503) from exc


class _SharedRead:
    def __init__(self, task: asyncio.Task):
        self.task = task
        self.readers = 0


def _is_retryable_fetch_error(exc: DirectoryFetchError) -> bool:
    return exc.status in (503, 504) or exc.code in _RETRYABLE_FETCH_CODES


async def _fetch_with_transient_retry(adapter: DirectoryAdapter, url: str, *, kind: str | None = None) -> tuple[str, str]:
    last_error: DirectoryFetchError | None = None
    for attempt in range(2):
        try:
            if kind is None:
                return await _fetch_public_httpx_listing(adapter, url)
            return await _fetch_public_httpx_listing(adapter, url, kind=kind)
        except DirectoryFetchError as exc:
            last_error = exc
            if attempt >= 1 or not _is_retryable_fetch_error(exc):
                raise
            await asyncio.sleep(0.05)
    assert last_error is not None
    raise last_error


async def fetch_source_html_shared(adapter: DirectoryAdapter, url: str, *, kind: str | None = None) -> tuple[str, str]:
    """Coalesce concurrent in-flight reads of the same source URL and retry once on transient errors."""
    loop = asyncio.get_running_loop()
    source_id = getattr(adapter, "site", None) or getattr(adapter, "adapter_id", "") or type(adapter).__name__
    key = (id(loop), str(source_id), f"{kind or 'default'}:{url}")
    shared = _inflight_source_reads.get(key)
    if shared is None or shared.task.done():
        shared = _SharedRead(asyncio.create_task(_fetch_with_transient_retry(adapter, url, kind=kind)))
        _inflight_source_reads[key] = shared
    shared.readers += 1
    try:
        return await asyncio.shield(shared.task)
    finally:
        shared.readers -= 1
        if shared.readers <= 0:
            if not shared.task.done():
                shared.task.cancel()
            if _inflight_source_reads.get(key) is shared:
                _inflight_source_reads.pop(key, None)


async def fetch_profile_metadata_html(adapter: DirectoryAdapter, requested_url: str) -> tuple[str, str]:
    """Read an installed adapter's profile with the same bounded public transport.

    Redirects must retain the canonical profile identity; no arbitrary-URL fetch.
    This only retrieves HTML, never media or library state.
    """
    url = adapter.normalize_url(requested_url, kind='profile')
    return await _fetch_public_httpx_listing(adapter, url, kind='profile')


async def fetch_directory_html(adapter: DirectoryAdapter, requested_url: str) -> tuple[str, str]:
    url = adapter.normalize_url(requested_url)
    if adapter.adapter_id in ("pornhub", "xhamster"):
        return await _fetch_public_httpx_listing(adapter, url)

    requested_page = url
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,pt-BR;q=0.8,pt;q=0.7",
        "Accept-Encoding": "identity",
    }
    cookies: dict[str, str] = {}
    try:
        # Covers DNS, redirects, streaming, and connection setup as one deadline.
        async with asyncio.timeout(REQUEST_TIMEOUT):
            async with directory_pool() as pool:
                seen = set()
                challenges_solved = 0
                for redirect_count in range(MAX_REDIRECTS + 1):
                    if url in seen:
                        raise DirectoryFetchError("directory_redirect_loop")
                    seen.add(url)
                    req_headers = dict(headers)
                    if cookies:
                        req_headers["Cookie"] = "; ".join(f"{k}={v}" for k, v in cookies.items())
                    async with pool.stream(
                        "GET",
                        url,
                        headers=req_headers,
                        extensions={"timeout": {"connect": 10, "read": 10, "write": 10, "pool": 5}},
                    ) as response:
                        response_headers = {
                            k.decode("ascii").lower(): v.decode("latin-1") for k, v in response.headers
                        }
                        for k, v in response.headers:
                            if k.decode("ascii").lower() == "set-cookie":
                                cookie_str = v.decode("latin-1").split(";", 1)[0]
                                if "=" in cookie_str:
                                    ck, cv = cookie_str.split("=", 1)
                                    cookies[ck.strip()] = cv.strip()

                        if response.status in (301, 302, 303, 307, 308):
                            location = response_headers.get("location")
                            if not location:
                                raise DirectoryFetchError("invalid_directory_redirect")
                            try:
                                raw_target = urljoin(url, location)
                                target = adapter.normalize_url(raw_target)
                            except ValueError as exc:
                                raise DirectoryFetchError("unsafe_directory_redirect", status=400) from exc
                            if target != requested_page:
                                # Only spelling/host/slash canonicalization may redirect.
                                # A redirect to another page/filter would mislabel results.
                                raise DirectoryFetchError("directory_redirect_changed_context", status=400)
                            if redirect_count >= MAX_REDIRECTS:
                                raise DirectoryFetchError("directory_redirect_limit")
                            url = raw_target
                            continue
                        if response.status == 429:
                            retry_after = response_headers.get("retry-after", "")
                            retry_after = (
                                retry_after if retry_after.isdigit() and len(retry_after) <= 6 else None
                            )
                            raise DirectoryFetchError("directory_rate_limited", status=429, retry_after=retry_after)
                        if response.status != 200:
                            raise DirectoryFetchError("directory_upstream_error", status=502)
                        content_type = (
                            response_headers.get("content-type", "").split(";", 1)[0].strip().lower()
                        )
                        if content_type not in ("text/html", "application/xhtml+xml"):
                            raise DirectoryFetchError("directory_expected_html")
                        if response_headers.get("content-encoding", "identity").lower() != "identity":
                            raise DirectoryFetchError("directory_unsupported_encoding")
                        length = response_headers.get("content-length")
                        if length and length.isdigit() and int(length) > MAX_HTML_BYTES:
                            raise DirectoryFetchError("directory_response_too_large")
                        body = bytearray()
                        async for chunk in response.aiter_stream():
                            if len(body) + len(chunk) > MAX_HTML_BYTES:
                                raise DirectoryFetchError("directory_response_too_large")
                            body.extend(chunk)

                        html_str = bytes(body).decode("utf-8", errors="replace")
                        if (
                            "leastFactor" in html_str
                            and challenges_solved < MAX_CHALLENGE_ATTEMPTS
                            and redirect_count < MAX_REDIRECTS
                        ):
                            solved = await asyncio.to_thread(solve_js_challenge, html_str)
                            if solved:
                                cookies.update(solved)
                                challenges_solved += 1
                                seen.discard(url)
                                continue

                        return adapter.normalize_url(url), html_str
                raise DirectoryFetchError("directory_redirect_limit")
    except DirectoryFetchError:
        raise
    except (TimeoutError, httpcore.TimeoutException) as exc:
        raise DirectoryFetchError("directory_timeout", status=504) from exc
    except (httpcore.NetworkError, httpcore.ProtocolError, OSError) as exc:
        raise DirectoryFetchError("directory_connection_failed", status=503) from exc
