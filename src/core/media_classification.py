"""Shared media identity: container format, animation evidence and display category."""
from urllib.parse import parse_qs, urlparse
import io
import hashlib
from pathlib import Path
from PIL import Image

VIDEO_FORMATS = {"mp4", "webm", "mov", "mkv", "m4v", "m3u8", "avi"}
IMAGE_FORMATS = {"jpeg", "jpg", "png", "apng", "webp", "avif", "gif", "bmp"}


def unwrap_media_source(url):
    current = url or ""
    for _ in range(5):
        parsed = urlparse(current)
        if parsed.path in ("/api/proxy-image", "/api/proxy-video-stream"):
            source = parse_qs(parsed.query).get("url", [""])[0]
            if not source or source == current:
                return ""
            current = source
            continue
        return current
    return ""


def media_source_format(url):
    """Read a real source suffix, including signed URLs and our proxy wrappers."""
    current = unwrap_media_source(url)
    if current.startswith("data:image/"):
        return current.split(";", 1)[0].split(",", 1)[0].split("/", 1)[-1].lower()
    filename = urlparse(current).path.rsplit("/", 1)[-1]
    suffix = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    return suffix if suffix in VIDEO_FORMATS | IMAGE_FORMATS else ""


def normalize_media_item(item):
    """Keep verified binary facts authoritative; never infer animation from size/name."""
    checked = bool(getattr(item, "animation_checked", False))
    stored_format = (getattr(item, "format", None) or "").lower()
    source_format = media_source_format(getattr(item, "original_url", None) or getattr(item, "thumbnail_url", None))
    actual_format = stored_format if checked else (source_format or stored_format)
    video_source = getattr(item, "video_stream_url", None)
    verified_image = checked and actual_format in IMAGE_FORMATS
    is_video = not verified_image and (
        actual_format in VIDEO_FORMATS
        or bool(video_source)
        or (getattr(item, "media_type", "image") == "video" and not (checked and actual_format in IMAGE_FORMATS))
    )
    animated = bool(getattr(item, "is_animated", False))
    if not checked and not is_video:
        animated = animated or getattr(item, "media_type", None) == "gif" or actual_format == "gif"
    item.format = actual_format or getattr(item, "format", None)
    item.is_animated = animated
    item.media_type = "video" if is_video else "gif" if animated else "image"
    if verified_image:
        item.video_stream_url = None
    if is_video and not video_source:
        item.video_stream_url = getattr(item, "original_url", None)
    return item


def media_category(item):
    """Animation category includes loop videos; playback still uses media_type=video."""
    if getattr(item, "is_animated", False):
        return "gif"
    if getattr(item, "animation_checked", False) and (getattr(item, "format", None) or "").lower() in IMAGE_FORMATS:
        return "photo"
    if getattr(item, "media_type", None) == "video" or media_source_format(getattr(item, "original_url", None)) in VIDEO_FORMATS:
        return "video"
    if not getattr(item, "animation_checked", False) and (
        getattr(item, "media_type", None) == "gif"
        or (getattr(item, "format", None) or "").lower() == "gif"
        or media_source_format(getattr(item, "original_url", None)) == "gif"
    ):
        return "gif"
    return "photo"


def update_album_media_metadata(album):
    """Recompute generated flags/tags, including when the last image is removed."""
    gif_count = sum(media_category(image) == "gif" for image in album.images)
    photo_count = sum(media_category(image) == "photo" for image in album.images)
    if not isinstance(album.metadata, dict):
        album.metadata = {}
    album.metadata.update(has_gifs=bool(gif_count), gif_count=gif_count)
    album.tags = [tag for tag in (album.tags or []) if str(tag).lower() not in ("gif", "animado")]
    if gif_count and photo_count == 0:
        album.tags.extend(["gif", "animado"])
    return album


def apply_image_animation(item, image):
    """Call only with decoded original bytes, never a generated thumbnail."""
    item.format = (image.format or "").lower() or item.format
    item.is_animated = bool(getattr(image, "is_animated", False) or getattr(image, "n_frames", 1) > 1)
    item.animation_checked = True
    return normalize_media_item(item)


def image_header_facts(data, complete=False):
    """Use container flags for short scout probes; never file-size/name heuristics."""
    if data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        chunk = data[12:16]
        if chunk == b"VP8X" and len(data) >= 21:
            return {"format": "webp", "is_animated": bool(data[20] & 2), "animation_checked": True}
        if chunk in (b"VP8 ", b"VP8L"):
            return {"format": "webp", "is_animated": False, "animation_checked": True}
    try:
        with Image.open(io.BytesIO(data)) as image:
            animated = bool(getattr(image, "is_animated", False) or getattr(image, "n_frames", 1) > 1)
            if image.format == "GIF" and not animated and not complete:
                return {}  # One frame in a partial stream does not prove a static GIF.
            return {"format": (image.format or "").lower(),
                    "is_animated": animated,
                    "animation_checked": True}
    except Exception:
        return {}


async def verify_media_animation(item, client, referer=None, local_root=None, cache_dir=None):
    """Bounded binary probe for new extractions or an explicit album sync, never boot."""
    if getattr(item, "animation_checked", False):
        return False
    source = unwrap_media_source(getattr(item, "original_url", None) or getattr(item, "thumbnail_url", None))
    source_format = media_source_format(source)
    if source_format in VIDEO_FORMATS or getattr(item, "video_stream_url", None):
        normalize_media_item(item)
        return False
    if source_format in ("jpg", "jpeg", "bmp") and not getattr(item, "is_animated", False):
        return False

    def apply_facts(data, complete=False):
        facts = image_header_facts(data, complete=complete)
        if not facts.get("animation_checked"):
            return False
        item.format = facts["format"]
        item.is_animated = facts["is_animated"]
        item.animation_checked = True
        normalize_media_item(item)
        return True

    try:
        if source.startswith("local://albums/") and local_root:
            root = Path(local_root).resolve()
            path = (root / source[len("local://albums/"):]).resolve()
            if path.is_relative_to(root) and path.is_file():
                with Image.open(path) as image:
                    apply_image_animation(item, image)
                return True
            return False
        if cache_dir:
            cached = Path(cache_dir) / f"{hashlib.sha256(source.encode('utf-8')).hexdigest()}.bin"
            if cached.is_file():
                with cached.open("rb") as cached_file:
                    cached_data = cached_file.read(512 * 1024)
                    if apply_facts(cached_data, complete=cached.stat().st_size == len(cached_data)):
                        return True
        if source.startswith("data:image/"):
            import base64
            return apply_facts(base64.b64decode(source.split(",", 1)[1]), complete=True)
        if not source.startswith(("http://", "https://")):
            return False
        from .network_profiles import resolve_anti_hotlink_headers
        async with client.stream("GET", source, headers=resolve_anti_hotlink_headers(source, referer=referer)) as response:
            if response.status_code not in (200, 206):
                return False
            data = bytearray()
            async for chunk in response.aiter_bytes():
                data.extend(chunk[:max(0, 512 * 1024 - len(data))])
                if apply_facts(bytes(data)):
                    return True
                if len(data) >= 512 * 1024:
                    return False
            return apply_facts(bytes(data), complete=True)
    except Exception:
        # Keep existing evidence on unavailable/corrupt sources; never invent a result.
        return False
    return False


def filter_album_media(album, media_filter):
    for item in album.images:
        normalize_media_item(item)
    category = {"images": "photo", "gifs": "gif", "videos": "video"}.get(media_filter)
    if category:
        album.images = [item for item in album.images if media_category(item) == category]
        if not any(album.cover_image_url in (item.original_url, item.thumbnail_url) for item in album.images):
            album.cover_image_url = (album.images[0].poster_url or album.images[0].thumbnail_url or album.images[0].original_url) if album.images else None
    return update_album_media_metadata(album)
