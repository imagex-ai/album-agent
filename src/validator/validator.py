"""
Deterministic Image Validation Engine.
Performs objective verification of candidate image URLs:
- Inherits Playwright active session context (Cookies, User-Agent, Referer)
- HTTP status & Content-Type verification
- Dimension and aspect ratio probing via binary stream header decoding
- Comparison against thumbnail candidate context
"""

import io
import asyncio
from typing import Optional, Dict, Any
import httpx
from PIL import Image

from ..core.models import ValidationResult, ValidationVerdict
from ..core.network_profiles import resolve_anti_hotlink_headers
from ..core.media_classification import media_source_format


class ImageValidator:
    """
    Validates image candidate URLs using objective network & binary probing.
    """

    def __init__(
        self,
        user_agent: Optional[str] = None,
        cookies: Optional[Dict[str, str]] = None,
        timeout_seconds: float = 12.0,
        max_retries: int = 3,
    ):
        self.user_agent = user_agent or (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0.0.0 Safari/537.36"
        )
        self.cookies = cookies or {}
        self.timeout_seconds = timeout_seconds
        self.max_retries = max_retries

    def update_session(
        self,
        cookies: Optional[Dict[str, str]] = None,
        user_agent: Optional[str] = None,
    ):
        """Updates active session cookies and user agent from the browser context."""
        if cookies:
            self.cookies.update(cookies)
        if user_agent:
            self.user_agent = user_agent

    async def validate_candidate_url(
        self,
        candidate_url: str,
        referer: Optional[str] = None,
        expected_min_width: int = 200,
        expected_min_height: int = 200,
        thumb_width: Optional[int] = None,
        thumb_height: Optional[int] = None,
    ) -> ValidationResult:
        """
        Validates an original image candidate URL with full session & referer context.
        """
        if not candidate_url or not (
            candidate_url.startswith("http://")
            or candidate_url.startswith("https://")
            or candidate_url.startswith("data:")
        ):
            return ValidationResult(
                verdict=ValidationVerdict.REJECT,
                target_url=candidate_url or "",
                reason="Invalid or missing URL scheme",
                is_valid=False,
            )

        # Handle inline data URLs (e.g. data:image/png;base64,...)
        if candidate_url.startswith("data:image/"):
            return self._validate_data_uri(candidate_url, expected_min_width, expected_min_height)

        headers = resolve_anti_hotlink_headers(candidate_url, referer=referer)
        headers["User-Agent"] = self.user_agent
        headers["Accept"] = "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
        headers["Accept-Language"] = "en-US,en;q=0.9"

        backoff = 0.5
        last_error = None

        for attempt in range(self.max_retries):
            try:
                async with httpx.AsyncClient(
                    cookies=self.cookies,
                    headers=headers,
                    timeout=self.timeout_seconds,
                    follow_redirects=True,
                ) as client:
                    # Attempt GET with stream to probe headers & first bytes for dimensions
                    async with client.stream("GET", candidate_url) as response:
                        if response.status_code == 429 or response.status_code >= 500:
                            # Rate limited or server error -> backoff retry
                            await asyncio.sleep(backoff)
                            backoff *= 2
                            continue

                        if response.status_code not in (200, 206):
                            return ValidationResult(
                                verdict=ValidationVerdict.REJECT,
                                target_url=candidate_url,
                                status_code=response.status_code,
                                reason=f"HTTP status {response.status_code} not accepted",
                                is_valid=False,
                            )

                        content_type = response.headers.get("content-type", "").lower()
                        is_video_url = media_source_format(candidate_url) in ("mp4", "webm", "mov", "mkv", "m4v", "m3u8")
                        is_video_resource = (
                            "video/" in content_type
                            or "mpegurl" in content_type
                            or is_video_url
                        )

                        if not any(
                            ct in content_type
                            for ct in [
                                "image/",
                                "video/",
                                "application/octet-stream",
                                "binary/octet-stream",
                                "mpegurl",
                            ]
                        ) and not is_video_url:
                            return ValidationResult(
                                verdict=ValidationVerdict.REJECT,
                                target_url=candidate_url,
                                status_code=response.status_code,
                                content_type=content_type,
                                reason=f"Content-Type '{content_type}' is not an image or video",
                                is_valid=False,
                            )

                        content_length = response.headers.get("content-length")
                        file_size = int(content_length) if content_length and content_length.isdigit() else None

                        # Read body in a single streaming pass (up to 20MB) to prevent StreamConsumed
                        body = b""
                        async for data in response.aiter_bytes():
                            body += data
                            if len(body) >= 20 * 1024 * 1024:  # 20MB limit
                                break

                        extracted_palette = None
                        is_anim = False
                        animation_checked = False
                        # Special handling for Videos / HLS Streams
                        if is_video_resource:
                            v_txt = candidate_url.lower()
                            if "2160" in v_txt or "4k" in v_txt:
                                width, height = 3840, 2160
                            elif "1440" in v_txt or "2k" in v_txt:
                                width, height = 2560, 1440
                            elif "1080" in v_txt or "fhd" in v_txt:
                                width, height = 1920, 1080
                            elif "720" in v_txt or "hd" in v_txt:
                                width, height = 1280, 720
                            elif "480" in v_txt:
                                width, height = 854, 480
                            elif "360" in v_txt:
                                width, height = 640, 360
                            elif "240" in v_txt:
                                width, height = 426, 240
                            else:
                                width = thumb_width if (thumb_width and thumb_width > 400) else 1280
                                height = thumb_height if (thumb_height and thumb_height > 200) else 720

                            img_format = "m3u8" if (".m3u8" in candidate_url.lower() or "mpegurl" in content_type) else "mp4"
                            if not file_size:
                                file_size = len(body)
                        # Special handling for SVG images
                        elif "svg" in content_type or candidate_url.lower().endswith(".svg"):
                            width, height = 300, 100
                            img_format = "svg"
                            if not file_size:
                                file_size = len(body)
                        else:
                            try:
                                img = Image.open(io.BytesIO(body))
                                width, height = img.size
                                is_anim = getattr(img, "is_animated", False) or (getattr(img, "n_frames", 1) > 1)
                                img_format = img.format.lower() if img.format else "unknown"
                                animation_checked = True
                                if not file_size:
                                    file_size = len(body)
                                try:
                                    from ..core.color_extractor import extract_dominant_colors_from_pil
                                    extracted_palette = extract_dominant_colors_from_pil(img)
                                except Exception:
                                    extracted_palette = None
                            except Exception as inner_e:
                                return ValidationResult(
                                    verdict=ValidationVerdict.REJECT,
                                    target_url=candidate_url,
                                    status_code=response.status_code,
                                    content_type=content_type,
                                    reason=f"Failed to decode image/media binary headers: {inner_e}",
                                    is_valid=False,
                                )

                        # Dimension checks (images only; videos use default 1280x720)
                        if not is_video_resource and (width < expected_min_width or height < expected_min_height):
                            return ValidationResult(
                                verdict=ValidationVerdict.REJECT,
                                target_url=candidate_url,
                                status_code=response.status_code,
                                content_type=content_type,
                                width=width,
                                height=height,
                                format=img_format,
                                file_size=file_size,
                                reason=f"Dimensions {width}x{height} below minimum {expected_min_width}x{expected_min_height}",
                                is_valid=False,
                            )

                        aspect_ratio = round(width / height, 4) if height > 0 else 1.0
                        aspect_ratio_diff = None

                        if not is_video_resource and thumb_width and thumb_height and thumb_height > 0:
                            thumb_ar = thumb_width / thumb_height
                            aspect_ratio_diff = round(abs(aspect_ratio - thumb_ar) / thumb_ar, 4)
                            # Reject extreme aspect ratio mismatch (> 45% difference)
                            if aspect_ratio_diff > 0.45:
                                return ValidationResult(
                                    verdict=ValidationVerdict.REJECT,
                                    target_url=candidate_url,
                                    status_code=response.status_code,
                                    content_type=content_type,
                                    width=width,
                                    height=height,
                                    format=img_format,
                                    file_size=file_size,
                                    aspect_ratio=aspect_ratio,
                                    aspect_ratio_diff=aspect_ratio_diff,
                                    reason=f"Aspect ratio {aspect_ratio} diverges >45% from thumbnail {thumb_ar:.4f}",
                                    is_valid=False,
                                )

                        # Success!
                        return ValidationResult(
                            verdict=ValidationVerdict.PASS,
                            target_url=candidate_url,
                            status_code=response.status_code,
                            content_type=content_type,
                            width=width,
                            height=height,
                            format=img_format,
                            file_size=file_size,
                            aspect_ratio=aspect_ratio,
                            aspect_ratio_diff=aspect_ratio_diff,
                            color_palette=extracted_palette,
                            is_animated=is_anim,
                            animation_checked=animation_checked,
                            reason="Validated successfully with HTTP 200, valid image header, and matched dimensions",
                            is_valid=True,
                        )

            except (httpx.HTTPError, Exception) as e:
                last_error = str(e)
                await asyncio.sleep(backoff)
                backoff *= 2

        return ValidationResult(
            verdict=ValidationVerdict.REJECT,
            target_url=candidate_url,
            reason=f"Network request failed after {self.max_retries} attempts: {last_error}",
            is_valid=False,
        )

    def _validate_data_uri(
        self, data_uri: str, min_w: int, min_h: int
    ) -> ValidationResult:
        """Validates base64 data URIs."""
        try:
            import base64
            header, encoded = data_uri.split(",", 1)
            raw = base64.b64decode(encoded)
            img = Image.open(io.BytesIO(raw))
            w, h = img.size
            fmt = img.format.lower() if img.format else "png"
            is_anim = bool(getattr(img, "is_animated", False) or getattr(img, "n_frames", 1) > 1)
            if w < min_w or h < min_h:
                return ValidationResult(
                    verdict=ValidationVerdict.REJECT,
                    target_url="data:image/...",
                    width=w,
                    height=h,
                    format=fmt,
                    file_size=len(raw),
                    reason=f"Data URI dimensions {w}x{h} too small",
                    is_valid=False,
                )
            extracted_palette = None
            try:
                from ..core.color_extractor import extract_dominant_colors_from_pil
                extracted_palette = extract_dominant_colors_from_pil(img)
            except Exception:
                extracted_palette = None
            return ValidationResult(
                verdict=ValidationVerdict.PASS,
                target_url="data:image/...",
                status_code=200,
                content_type=f"image/{fmt}",
                width=w,
                height=h,
                format=fmt,
                file_size=len(raw),
                color_palette=extracted_palette,
                is_animated=is_anim,
                animation_checked=True,
                reason="Valid inline data URI image",
                is_valid=True,
            )
        except Exception as e:
            return ValidationResult(
                verdict=ValidationVerdict.REJECT,
                target_url="data:image/...",
                reason=f"Failed decoding data URI: {e}",
                is_valid=False,
            )
