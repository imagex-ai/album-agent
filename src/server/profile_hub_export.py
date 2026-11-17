"""Strict Profile Hub ZIP export, preserving original bytes and memberships."""
import json
import os
import tempfile
import zipfile
from urllib.parse import urlsplit

import httpx
from src.core.network_profiles import resolve_anti_hotlink_headers


def _media_extension(header, content_type):
    if header.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if header.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if header.startswith((b"GIF87a", b"GIF89a")):
        return ".gif"
    if header.startswith(b"RIFF") and header[8:12] == b"WEBP":
        return ".webp"
    if header.startswith(b"RIFF") and header[8:12] == b"AVI ":
        return ".avi"
    if header.startswith(b"\x1a\x45\xdf\xa3"):
        return ".webm" if "webm" in content_type else ".mkv"
    if header[4:8] == b"ftyp":
        if header[8:12] in (b"avif", b"avis") or content_type == "image/avif":
            return ".avif"
        return ".mov" if content_type == "video/quicktime" else ".mp4"
    if header.startswith((b"II*\x00", b"MM\x00*")):
        return ".tiff"
    if header.startswith(b"BM"):
        return ".bmp"
    raise ValueError("A selected item did not contain recognized media bytes")


async def create_profile_zip(albums, videos=(), *, transport=None):
    """Write every unique selected original once; fail instead of returning a partial ZIP."""
    members = {}
    for album in albums:
        for image in album.images:
            url = (getattr(image, "original_url", None) or "").strip()
            if not url or urlsplit(url).scheme not in ("http", "https"):
                raise ValueError("Selected media has no downloadable HTTP URL")
            entry = members.setdefault(url, {"albums": [], "image": image, "referer": getattr(album, "source_page", "") or ""})
            entry["albums"].append({"title": album.title, "source_url": getattr(album, "source_page", "") or ""})
    for video in videos:
        url = (video.get("stream_url") or "").strip()
        if not url or urlsplit(url).scheme not in ("http", "https"):
            raise ValueError("A selected video has no downloadable stream")
        entry = members.setdefault(url, {"albums": [], "image": None, "referer": video.get("source_url", "")})
        entry.setdefault("videos", []).append({"title": video.get("title", ""), "source_url": video.get("source_url", ""), "collections": video.get("collections", [])})
    if not members:
        raise ValueError("No media selected")

    handle = tempfile.NamedTemporaryFile(prefix="profile_hub_", suffix=".zip", delete=False)
    path = handle.name
    handle.close()
    try:
        manifest = []
        async with httpx.AsyncClient(follow_redirects=True, timeout=45, transport=transport) as client:
            with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED, allowZip64=True) as archive:
                for index, (url, entry) in enumerate(members.items(), 1):
                    headers = resolve_anti_hotlink_headers(url, referer=entry["referer"])
                    async with client.stream("GET", url, headers=headers) as response:
                        response.raise_for_status()
                        content_type = response.headers.get("content-type", "").split(";")[0].lower()
                        if (content_type.startswith("text/") or content_type in ("application/vnd.apple.mpegurl", "application/x-mpegurl", "application/json", "application/xml", "application/problem+json") or urlsplit(str(response.url)).path.lower().endswith(".m3u8")):
                            raise ValueError("A selected item is not a downloadable media file")
                        stream = response.aiter_bytes()
                        prefix = b""
                        async for chunk in stream:
                            prefix += chunk
                            if len(prefix) >= 32:
                                break
                        if not prefix:
                            raise ValueError("A selected media file is empty")
                        ext = _media_extension(prefix[:32], content_type)
                        filename = f"media/{index:05d}{ext}"
                        with archive.open(filename, "w", force_zip64=True) as destination:
                            destination.write(prefix)
                            async for chunk in stream:
                                destination.write(chunk)
                        manifest.append({"file": filename, "source_url": url, "albums": entry["albums"], "videos": entry.get("videos", [])})
                archive.writestr("manifest.json", json.dumps({"items": manifest}, ensure_ascii=False, indent=2))
        return path
    except BaseException:
        try:
            os.remove(path)
        except OSError:
            pass
        raise
