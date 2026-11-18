"""Save a timeline video without importing application startup or personal storage."""
from __future__ import annotations

import hashlib
import json
import sqlite3
import time
import asyncio
import re
from pathlib import Path
from urllib.parse import quote, urljoin, urlsplit, urlunsplit

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator

from .profile_hub_execution import ExecutionError, https_url
from .profile_directory_manifest import recognize_profile_input
from .profile_hub_providers import resolve_provider
from .profile_directory_transport import directory_pool
from src.core.network_profiles import codec_compatibility_rank


def select_playable_format(info):
    """Select a self-contained progressive MP4 with explicitly known audio/video."""
    formats = info.get('formats') if isinstance(info, dict) else None
    candidates = []
    for fmt in formats or []:
        if not isinstance(fmt, dict) or fmt.get('ext') != 'mp4' or fmt.get('has_drm'):
            continue
        if any(not isinstance(fmt.get(key), str) or fmt[key].lower() in ('', 'none', 'unknown') for key in ('acodec', 'vcodec')):
            continue
        if fmt.get('manifest_url') or fmt.get('protocol') not in (None, 'http', 'https'):
            continue
        try:
            stream = https_url(fmt.get('url'))
        except (ValueError, TypeError):
            continue
        if '.m3u8' in urlsplit(stream).path.lower():
            continue
        candidates.append(fmt)
    if not candidates:
        raise ExecutionError('video_stream_unresolved')
    def rank(fmt):
        height = fmt.get('height') if isinstance(fmt.get('height'), (float, int)) else 0
        bitrate = fmt.get('tbr') if isinstance(fmt.get('tbr'), (float, int)) else 0
        return height or 0, codec_compatibility_rank(fmt), bitrate or 0
    best = max(candidates, key=rank)
    return {'stream_url': best['url'], 'width': best.get('width'), 'height': best.get('height'),
            'duration_seconds': info.get('duration'), 'thumbnail_url': info.get('thumbnail')}


async def resolve_progressive_video(video_id, page_url, get_headers, load_cookies):
    """Resolve with existing source headers/cookies, never download media."""
    import yt_dlp
    headers = get_headers(page_url, page_url)
    cookies = headers.get('Cookie') or headers.get('cookie')
    headers = {key: value for key, value in headers.items()
               if key.lower() not in ('cookie', 'sec-fetch-dest', 'sec-fetch-mode')}
    headers['Accept'] = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    options = {'quiet': True, 'no_warnings': True, 'skip_download': True, 'socket_timeout': 6.0,
               'retries': 3, 'extractor_retries': 3, 'http_headers': headers}
    def extract():
        with yt_dlp.YoutubeDL(options) as ydl:
            if cookies:
                load_cookies(ydl.cookiejar, cookies, page_url)
            return ydl.extract_info(page_url, download=False)
    info = await asyncio.to_thread(extract)
    try:
        return select_playable_format(info)
    except ExecutionError:
        pass
    # Some providers expose audio and video through an HLS master only.
    masters = dict.fromkeys(fmt.get('manifest_url') for fmt in info.get('formats', [])
                            if isinstance(fmt, dict) and fmt.get('manifest_url') and not fmt.get('has_drm'))
    for candidate in masters:
        try:
            final, text = await fetch_hls_master(candidate)
            if hls_master_has_audio_video(text, final):
                return {'stream_url': final, 'duration_seconds': info.get('duration'), 'thumbnail_url': info.get('thumbnail')}
        except Exception:
            continue
    raise ExecutionError('video_stream_unresolved')


def hls_master_has_audio_video(text, base_url):
    """Require a video variant bound to a declared external audio group."""
    if not text.lstrip('\ufeff\r\n ').startswith('#EXTM3U'):
        return False
    path = urlsplit(base_url).path.lower()
    # The gallery player identifies HLS by URL; an unrecognizable master would be
    # attached as a direct video and cannot be reported as a usable save.
    if path.endswith(('.ts', '.mp4', '.webm')) or not any(marker in base_url.lower() for marker in ('.m3u8', '/hls/', '/hls_variant/', '/hls_playlist/')):
        return False
    groups = set()
    lines = text.splitlines()
    for line in lines:
        if not line.startswith('#EXT-X-MEDIA:') or not re.search(r'(?:[:,])TYPE=AUDIO(?:,|$)', line):
            continue
        group = re.search(r'(?:[:,])GROUP-ID="([^"]+)"', line)
        uri = re.search(r'(?:[:,])URI="([^"]+)"', line)
        if group and uri:
            try:
                https_url(urljoin(base_url, uri.group(1)))
                groups.add(group.group(1))
            except ValueError:
                pass
    found = False
    for index, line in enumerate(lines):
        if not line.startswith('#EXT-X-STREAM-INF:') or not re.search(r'(?:[:,])RESOLUTION=\d+x\d+', line):
            continue
        audio = re.search(r'(?:[:,])AUDIO="([^"]+)"', line)
        if not audio or audio.group(1) not in groups:
            return False
        target = next((entry.strip() for entry in lines[index + 1:] if entry.strip()), '')
        if target.startswith('#'):
            return False
        try:
            https_url(urljoin(base_url, target)) if target else None
            if not target:
                return False
            found = True
        except ValueError:
            return False
    return found


async def fetch_hls_master(url):
    """Read a bounded manifest through the existing DNS-pinned HTTPS transport."""
    current = https_url(url)
    async with asyncio.timeout(20):
        async with directory_pool() as pool:
            for _ in range(4):
                async with pool.stream('GET', current, headers={'Accept-Encoding': 'identity'},
                                       extensions={'timeout': {'connect': 10, 'read': 10, 'write': 10, 'pool': 5}}) as response:
                    headers = {key.decode('ascii').lower(): value.decode('latin-1') for key, value in response.headers}
                    if response.status in (301, 302, 303, 307, 308):
                        current = https_url(urljoin(current, headers.get('location', '')))
                        continue
                    if response.status != 200:
                        raise ValueError('manifest_unavailable')
                    body = bytearray()
                    async for chunk in response.aiter_stream():
                        body.extend(chunk)
                        if len(body) > 512 * 1024:
                            raise ValueError('manifest_too_large')
                    return current, body.decode('utf-8-sig')
    raise ValueError('manifest_redirect_limit')


def identity_url(value: str) -> str:
    parts = urlsplit(https_url(value))
    host = parts.hostname.lower().rstrip('.')
    if host.startswith('www.'):
        host = host[4:]
    return urlunsplit(('https', host, parts.path.rstrip('/') or '/', parts.query, ''))


def video_identity(value: str) -> tuple[str, str] | None:
    """Resolve the provider's registered, case-sensitive media identity."""
    https_url(value)
    provider = resolve_provider(value)
    identity = provider.video_identity(value)
    return (provider.provider_id, identity) if identity else None


class TimelineVideoInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    profile_url: str
    profile_name: str = Field(min_length=1, max_length=1000)
    video_url: str
    video_id: str = Field(min_length=1, max_length=512)
    title: str = Field(default='', max_length=1000)
    thumbnail_url: str | None = None

    @field_validator('profile_url', 'video_url', 'thumbnail_url')
    @classmethod
    def valid_url(cls, value):
        return https_url(value) if value is not None else None


class TimelineStatusInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    urls: list[str] = Field(max_length=500)


class TimelineVideoSaver:
    def __init__(self, service, resolve, sanitize_folder, folder_db):
        self.service, self.resolve, self.sanitize_folder = service, resolve, sanitize_folder
        self.folder_db = Path(folder_db)

    def validate(self, item):
        provider = resolve_provider(item.profile_url)
        target = resolve_provider(item.video_url)
        if provider.provider_id == 'generic' or provider.provider_id != target.provider_id or not target.video_identity(item.video_url):
            raise ExecutionError('unsupported_execution_source')
        if provider.allows_profile_path(urlsplit(item.profile_url).path):
            return
        try:
            adapter, kind = recognize_profile_input(item.profile_url)
        except ValueError:
            adapter, kind = None, None
        if adapter and adapter.adapter_id == provider.provider_id and kind == 'profile':
            return
        raise ExecutionError('unsupported_execution_source')

    def read_metadata(self):
        path = Path(self.service.metadata_file)
        if not path.exists():
            return {}
        try:
            value = json.loads(path.read_text(encoding='utf-8'))
            if not isinstance(value, dict):
                raise ValueError('invalid metadata')
            return value
        except (OSError, ValueError) as exc:
            raise ExecutionError('video_metadata_unavailable') from exc

    def reserve_folder(self, profile_key, profile_name, current):
        self.folder_db.parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(self.folder_db, timeout=10) as db:
            db.execute('CREATE TABLE IF NOT EXISTS folders (profile TEXT PRIMARY KEY, folder TEXT NOT NULL UNIQUE COLLATE NOCASE)')
            columns = {row[1] for row in db.execute('PRAGMA table_info(folders)')}
            if 'directory_identity' not in columns:
                db.execute('ALTER TABLE folders ADD COLUMN directory_identity TEXT')
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT folder, directory_identity FROM folders WHERE profile = ?', (profile_key,)).fetchone()
            from_metadata = next((v.get('folder') for v in current.values()
                                  if v.get('timeline_profile_identity') == profile_key and v.get('folder')), None)
            folder = row[0] if row else from_metadata
            if row and row[1]:
                base = Path(self.service.base_dir)
                original = base / folder
                if not original.is_dir() or self.directory_identity(original) != row[1]:
                    renamed = next((p for p in base.iterdir() if p.is_dir() and not p.is_symlink()
                                    and self.directory_identity(p) == row[1]), None)
                    if renamed:
                        folder = renamed.name
                    elif original.exists():
                        raise ExecutionError('profile_folder_conflict')
            if not folder:
                name = self.sanitize_folder(profile_name, default='')
                if not name:
                    raise ExecutionError('invalid_profile_name')
                used = {str(v.get('folder') or '').casefold() for v in current.values()}
                used.update(p.name.casefold() for p in Path(self.service.base_dir).iterdir() if p.is_dir())
                used.update(r[0].casefold() for r in db.execute('SELECT folder FROM folders'))
                folder = name
                if folder.casefold() in used:
                    suffix = hashlib.sha256(profile_key.encode()).hexdigest()[:10]
                    folder = self.sanitize_folder(f'{name[:100]} - {suffix}', default='')
                    if folder.casefold() in used:
                        raise ExecutionError('profile_folder_conflict')
            if self.sanitize_folder(folder, default='') != folder:
                raise ExecutionError('invalid_video_destination')
            try:
                db.execute('INSERT INTO folders(profile, folder) VALUES (?, ?) ON CONFLICT(profile) DO UPDATE SET folder=excluded.folder',
                           (profile_key, folder))
            except sqlite3.IntegrityError as exc:
                raise ExecutionError('profile_folder_conflict') from exc
            return folder

    @staticmethod
    def directory_identity(path):
        try:
            stat = path.stat()
            return f'{stat.st_dev}:{stat.st_ino}' if stat.st_ino else None
        except OSError:
            return None

    def remember_folder_identity(self, profile_key, target):
        identity = self.directory_identity(target)
        if identity:
            with sqlite3.connect(self.folder_db, timeout=10) as db:
                db.execute('UPDATE folders SET directory_identity = ? WHERE profile = ?', (identity, profile_key))

    @staticmethod
    def existing(metadata, source_key):
        for video_id, entry in metadata.items():
            try:
                if video_identity(entry.get('source_url') or '') == source_key:
                    return {'id': video_id, 'folder': entry.get('folder') or 'Geral', 'already_saved': True}
            except (ValueError, TypeError):
                continue
        return None

    def statuses(self, urls):
        with self.service._meta_lock:
            metadata = self.read_metadata()
        index = {}
        for video_id, entry in metadata.items():
            try:
                key = video_identity(entry.get('source_url') or '')
                if key:
                    index.setdefault(key, {'id': video_id, 'folder': entry.get('folder') or 'Geral'})
            except (ValueError, TypeError):
                pass
        result = []
        for url in urls:
            try:
                result.append(index.get(video_identity(url)))
            except (ValueError, TypeError):
                result.append(None)
        return result

    async def save(self, item):
        self.validate(item)
        source_key, profile_key = video_identity(item.video_url), identity_url(item.profile_url)
        if not source_key:
            raise ExecutionError('unsupported_media_route')
        service = self.service
        with service._meta_lock:
            found = self.existing(self.read_metadata(), source_key)
        if found:
            return found

        metadata = await self.resolve(source_key[1], item.video_url)
        stream = metadata.get('stream_url') if isinstance(metadata, dict) else None
        if not stream or stream == item.video_url:
            raise ExecutionError('video_stream_unresolved')
        https_url(stream)

        with service._meta_lock:
            current = self.read_metadata()
            found = self.existing(current, source_key)
            if found:
                return found
            folder = self.reserve_folder(profile_key, item.profile_name, current)
            base = Path(service.base_dir).resolve()
            target = base / folder
            if target.resolve() != target or target.resolve().parent != base:
                raise ExecutionError('invalid_video_destination')
            target.mkdir(parents=True, exist_ok=True)
            self.remember_folder_identity(profile_key, target)
            video_id = hashlib.sha256((':'.join(source_key)).encode()).hexdigest()[:24]
            if video_id in current:
                raise ExecutionError('video_identity_conflict')
            proxy = f'/api/proxy-video-stream?url={quote(stream, safe="")}&referer={quote(item.video_url, safe="")}'
            now = time.strftime('%Y-%m-%d %H:%M:%S')
            thumbnail = item.thumbnail_url or metadata.get('thumbnail_url')
            try:
                thumbnail = https_url(thumbnail) if thumbnail else None
            except (ValueError, TypeError):
                thumbnail = None
            entry = {'id': video_id, 'title': item.title, 'folder': folder,
                     'rel_path': f'{folder}/remote_{video_id}.mp4', 'storage_location': 'stream_url',
                     'custom_stream_url': proxy, 'source_url': item.video_url, 'source_id': source_key[1],
                     'source_origin': 'web', 'source_thumbnail_url': thumbnail,
                     'timeline_profile_identity': profile_key, 'is_favorite': False, 'file_size_bytes': 0,
                     'created_at': now, 'updated_at': now}
            for field in ('width', 'height', 'duration_seconds'):
                value = metadata.get(field)
                if isinstance(value, (int, float)) and not isinstance(value, bool) and value > 0:
                    entry[field] = value
            current[video_id] = entry
            if not service._save_metadata(current):
                raise ExecutionError('video_persist_failed')
            saved = self.read_metadata().get(video_id)
            if not saved or saved.get('source_url') != item.video_url or saved.get('custom_stream_url') != proxy:
                raise ExecutionError('video_persistence_unverified')
            return {'id': video_id, 'folder': folder, 'already_saved': False}


def timeline_video_router(saver):
    router = APIRouter()

    @router.post('/api/profile-hub/timeline/saved-video-status')
    async def saved_video_status(body: TimelineStatusInput):
        try:
            return {'items': saver.statuses(body.urls)}
        except ExecutionError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc

    @router.post('/api/profile-hub/timeline/save-video')
    async def save_video(item: TimelineVideoInput):
        try:
            return await saver.save(item)
        except ExecutionError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    return router
