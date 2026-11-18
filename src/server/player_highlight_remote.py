"""Temporary, bounded original audio/media for on-demand library analysis.

Resolution is injected by the runtime. Records come from the library or the
validated watch-source endpoint; foreign post IDs never become library IDs.
"""
import asyncio
from contextlib import contextmanager
import os
from pathlib import Path
import tempfile
import subprocess
from urllib.parse import urlsplit

import httpx

from .profile_hub_execution import https_url
from .profile_hub_execution_runtime import PublicHTTPSHttpxTransport
from .profile_directory_transport import MAX_REDIRECTS
from .profile_hub_export import _media_extension
from .player_highlight_hls import materialize_hls, MAX_HLS_MANIFEST_BYTES
from src.core.network_profiles import split_mux_audio_url

REMOTE_AUDIO_DECODE_TIMEOUT_SECONDS = 25  # Bound a single local audio-only decode.


def decode_remote_audio(source, destination, max_bytes):
    from .smart_shorts_detector import get_ffmpeg_path
    executable = get_ffmpeg_path()
    if not executable:
        raise ValueError('Audio decoder unavailable')
    # A downloaded media file can contain nested references. Decode with local
    # protocols only, then give the unchanged detector our own PCM container.
    command = [executable, '-y', '-loglevel', 'error', '-protocol_whitelist', 'file,pipe',
        '-threads', '1', '-i', os.fspath(source), '-map', '0:a:0', '-vn', '-sn',
        '-ac', '1', '-ar', '2000', '-c:a', 'pcm_s16le', '-fs', str(max_bytes), os.fspath(destination)]
    result = subprocess.run(command, capture_output=True, timeout=REMOTE_AUDIO_DECODE_TIMEOUT_SECONDS,
        creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if (result.returncode != 0 or not destination.is_file()
            or not 0 < destination.stat().st_size < max_bytes):
        raise ValueError('Complete original audio could not be decoded within budget')
    return destination


class RemoteAnalysisMedia:
    def __init__(self, resolve, headers, *, max_bytes, timeout_seconds, transport_factory=PublicHTTPSHttpxTransport,
                 prepare_audio=decode_remote_audio):
        self.resolve, self.headers = resolve, headers
        self.max_bytes, self.timeout_seconds = max_bytes, timeout_seconds
        self.transport_factory = transport_factory
        self.prepare_audio = prepare_audio

    async def download(self, video, path):
        page = https_url(video.get('source_url') or '')
        async with asyncio.timeout(self.timeout_seconds):
            stream, metadata = await self.resolve(page)
            if not stream:
                raise ValueError('Original stream unavailable')
            resolved_page = metadata.get('webpage_url') if isinstance(metadata, dict) else None
            if not resolved_page:
                raise ValueError('Resolved source identity unavailable')
            def identity(url):
                parts = urlsplit(https_url(url))
                return (parts.hostname.removeprefix('www.'), parts.path.rstrip('/'), parts.query)
            if identity(resolved_page) != identity(page):
                raise ValueError('Resolved source identity changed')
            video_url, audio_url = split_mux_audio_url(stream)
            if not audio_url:
                # Analysis discards image detail. Prefer the smallest declared
                # progressive A/V representation, without changing playback's
                # quality or selecting a different declared audio language.
                language = metadata.get('language')
                candidates = [item for item in metadata.get('formats', [])
                    if item.get('url') and item.get('ext') in ('mp4', 'webm')
                    and item.get('acodec') not in (None, 'none')
                    and item.get('vcodec') not in (None, 'none')
                    and not item.get('manifest_url') and not item.get('_is_dash_mux')
                    and '.m3u8' not in item['url'].lower()
                    and (not language or item.get('language') in (None, language))]
                if not candidates:
                    # Some extractors omit audio codecs even for complete A/V
                    # streams. Only consider alternatives when the selected
                    # original has the same unknown audio metadata; the local
                    # decoder still has to verify a complete audio track.
                    selected = next((item for item in metadata.get('formats', [])
                        if item.get('url') == video_url), None)
                    if selected and selected.get('acodec') is None:
                        candidates = [item for item in metadata.get('formats', [])
                            if item.get('url') and item.get('ext') in ('mp4', 'webm')
                            and item.get('acodec') is None
                            and item.get('vcodec') != 'none'
                            and item.get('vcodec') == selected.get('vcodec')
                            and not item.get('manifest_url') and not item.get('_is_dash_mux')
                            and '.m3u8' not in item['url'].lower()
                            and (not language or item.get('language') in (None, language))]
                if candidates:
                    video_url = min(candidates, key=lambda item: (
                        item.get('tbr') or float('inf'), item.get('height') or float('inf')
                    ))['url']
            # Analyze the complete original audio track when DASH provides one.
            # This avoids downloading the video track merely to discard it.
            target = https_url(audio_url or video_url)
            async with httpx.AsyncClient(transport=self.transport_factory(), timeout=15, follow_redirects=False) as client:
                for _ in range(MAX_REDIRECTS + 1):
                    async with client.stream('GET', target, headers=self.headers(target, page)) as response:
                        if response.status_code in (301, 302, 303, 307, 308):
                            # A signed asset redirect can be a replacement clip.
                            # Re-resolve at the source on a later visit instead of
                            # publishing analysis for unverified substitute bytes.
                            raise ValueError('Original asset redirected; identity not verified')
                        # A range/partial body is not full-timeline evidence.
                        if response.status_code != 200:
                            raise ValueError('Original media incomplete')
                        kind = response.headers.get('content-type', '').split(';')[0].lower()
                        if 'mpegurl' in kind or urlsplit(target).path.lower().endswith('.m3u8'):
                            body = bytearray()
                            async for chunk in response.aiter_bytes():
                                body.extend(chunk)
                                if len(body) > min(MAX_HLS_MANIFEST_BYTES, self.max_bytes):
                                    raise ValueError('HLS manifest byte budget exceeded')
                            return await materialize_hls(client, target, body.decode('utf-8-sig'),
                                Path(path).parent, lambda url:self.headers(url, page), self.max_bytes-len(body))
                        if kind.startswith('text/') or 'mpegurl' in kind or kind in ('application/json', 'application/dash+xml'):
                            raise ValueError('Source requires an adaptive-media analyzer')
                        length = response.headers.get('content-length')
                        if length and int(length) > self.max_bytes:
                            raise ValueError('Remote analysis byte budget exceeded')
                        count = 0
                        prefix = bytearray()
                        with Path(path).open('wb') as output:
                            async for chunk in response.aiter_bytes():
                                count += len(chunk)
                                if count > self.max_bytes:
                                    raise ValueError('Remote analysis byte budget exceeded')
                                prefix.extend(chunk[:max(0, 32-len(prefix))])
                                output.write(chunk)
                        if not count or (length and count != int(length)):
                            raise ValueError('Original media incomplete')
                        # Do not hand a disguised manifest/HTML document to
                        # FFmpeg, which could otherwise follow its nested URLs.
                        wav = prefix[:4] == b'RIFF' and prefix[8:12] == b'WAVE'
                        if not wav and _media_extension(bytes(prefix), kind) not in ('.mp4', '.mov', '.webm', '.mkv', '.avi'):
                            raise ValueError('Original audio/video bytes not recognized')
                        return path
                raise ValueError('Remote analysis redirect limit exceeded')

    @contextmanager
    def __call__(self, video):
        # OS temporary storage, never the personal library. Cleanup also runs on
        # timeout, byte-limit rejection, detector failure and cancellation.
        with tempfile.TemporaryDirectory(prefix='imagex-player-analysis-') as directory:
            path = Path(directory) / 'original.media'
            path = Path(asyncio.run(self.download(video, path)))
            audio = self.prepare_audio(path, Path(directory)/'original-audio.wav', self.max_bytes)
            yield os.fspath(audio)
