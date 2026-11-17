"""Pure image-byte and MIME integrity checks for /api/proxy-image.

Kept dependency-free (no imports from server.py/main.py) so callers and unit tests
can validate upstream image bytes before writing immutable disk caches.
"""
from __future__ import annotations

MIN_IMAGE_BYTES = 16

_NON_IMAGE_CONTENT_TYPES = (
    "text/html",
    "application/xhtml+xml",
    "application/json",
    "text/json",
    "text/plain",
    "text/javascript",
    "application/javascript",
)

_AVIF_BRANDS = (b"avif", b"avis")
_HEIC_BRANDS = (b"heic", b"heix", b"hevc", b"hevx", b"mif1", b"msf1")


def sniff_image_mime(raw_bytes: bytes, header_content_type: str = "") -> str | None:
    """Detect real image MIME type from magic bytes; reject HTML/JSON/script challenges."""
    if not raw_bytes or len(raw_bytes) < MIN_IMAGE_BYTES:
        return None

    head = raw_bytes[:512]
    stripped = head.lstrip()
    lowered = stripped.lower()

    # Reject structured error/challenge pages even when upstream spoofs an image header.
    if lowered.startswith((b"<!doctype", b"<html", b"<head", b"<body", b"<script", b"{", b"[")):
        return None
    if b"<script" in lowered or b"<html" in lowered[:256]:
        return None

    if raw_bytes.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if raw_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if raw_bytes.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    if len(raw_bytes) >= 12 and raw_bytes[:4] == b"RIFF" and raw_bytes[8:12] == b"WEBP":
        return "image/webp"
    if raw_bytes.startswith(b"BM"):
        return "image/bmp"
    if raw_bytes.startswith((b"\x00\x00\x01\x00", b"\x00\x00\x02\x00")):
        return "image/x-icon"
    if len(raw_bytes) >= 12 and raw_bytes[4:8] == b"ftyp":
        brand = raw_bytes[8:12].lower()
        if brand in _AVIF_BRANDS:
            return "image/avif"
        if brand in _HEIC_BRANDS:
            return "image/heic"

    # SVG must be text XML/SVG containing <svg and zero embedded <script>.
    if lowered.startswith((b"<svg", b"<?xml")) and b"<svg" in lowered:
        full_lower = raw_bytes[:16384].lower()
        if b"<script" in full_lower:
            return None
        return "image/svg+xml"

    # Reject unambiguous non-image headers when magic bytes did not match.
    ct = (header_content_type or "").split(";", 1)[0].strip().lower()
    if ct in _NON_IMAGE_CONTENT_TYPES or any(marker in lowered for marker in (b"hotlink", b"access denied", b"forbidden")):
        return None

    return None


def is_valid_image_response(
    status_code: int,
    header_content_type: str,
    raw_bytes: bytes,
) -> tuple[bool, str | None]:
    """Confirm HTTP 2xx + non-HTML header + valid image magic bytes."""
    if not (200 <= int(status_code) < 300):
        return False, None
    ct = (header_content_type or "").split(";", 1)[0].strip().lower()
    if ct in _NON_IMAGE_CONTENT_TYPES:
        return False, None
    mime = sniff_image_mime(raw_bytes, ct)
    if not mime:
        return False, None
    return True, mime
