"""Bridge to the existing video workers, gallery persistence and task queue.

Runtime bindings are supplied by server.py; importing this module never imports
that server, starts a browser, initializes cloud storage or opens a personal file.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin, urlsplit
import httpcore
import httpx

from src.core.models import Album, AlbumImage
from .profile_directory_transport import directory_pool
from .profile_hub_export import _media_extension
from .profile_hub_execution import ExecutionError, folder_name, https_url, stable_id
from .profile_hub_execution_source import ExecutionSources
from .profile_hub_selection import filter_profile_album_subset


class PublicHTTPSHttpxTransport(httpx.AsyncBaseTransport):
    """Reuse the directory's DNS-pinned public HTTPS pool for media validation."""
    def __init__(self):
        self.pool = directory_pool()

    async def handle_async_request(self, request):
        https_url(str(request.url))
        response = await self.pool.handle_async_request(httpcore.Request(
            method=request.method, url=httpcore.URL(scheme=request.url.raw_scheme, host=request.url.raw_host,
                port=request.url.port, target=request.url.raw_path), headers=request.headers.raw,
            content=request.stream, extensions=request.extensions))

        class Stream(httpx.AsyncByteStream):
            async def __aiter__(self):
                async for chunk in response.aiter_stream():
                    yield chunk
            async def aclose(self):
                await response.aclose()
        return httpx.Response(response.status, headers=response.headers, stream=Stream(), extensions=response.extensions)

    async def aclose(self):
        await self.pool.aclose()


class EmptyRegistrationLookup:
    """Never migrate a different profile's saved video by title or URL."""
    def list_videos(self):
        return []


@asynccontextmanager
async def asset_lock(directory: Path, key: str):
    directory.mkdir(parents=True, exist_ok=True)
    handle = (directory / f'{key}.lock').open('a+b')
    if handle.tell() == 0:
        handle.write(b'0'); handle.flush()
    handle.seek(0)
    locked = False
    try:
        try:
            if os.name == 'nt':
                import msvcrt
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            locked = True
        except OSError as exc:
            raise ExecutionError('artifact_is_already_running') from exc
        yield
    finally:
        if locked:
            handle.seek(0)
            if os.name == 'nt':
                import msvcrt
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        handle.close()


async def verify_selected_original(url: str, kind: str):
    """Bounded original-media probe, pinned public DNS on every redirect."""
    current = https_url(url)
    async with asyncio.timeout(25):
        async with directory_pool() as pool:
            for _ in range(4):
                async with pool.stream('GET', current, headers={'Range': 'bytes=0-65535', 'Accept-Encoding': 'identity', 'User-Agent': 'Mozilla/5.0'},
                    extensions={'timeout': {'connect': 10, 'read': 10, 'write': 10, 'pool': 5}}) as response:
                    headers = {key.decode('ascii').lower(): value.decode('latin-1') for key, value in response.headers}
                    if response.status in (301, 302, 303, 307, 308):
                        current = https_url(urljoin(current, headers.get('location', '')))
                        continue
                    if response.status not in (200, 206):
                        raise ExecutionError('selected_original_unavailable')
                    prefix = bytearray()
                    async for chunk in response.aiter_stream():
                        prefix.extend(chunk[:65536 - len(prefix)])
                        if len(prefix) >= 32:
                            break
                    try:
                        extension = _media_extension(bytes(prefix[:32]), headers.get('content-type', '').split(';')[0].lower())
                    except ValueError as exc:
                        raise ExecutionError('selected_original_not_media') from exc
                    if kind == 'photo' and extension in ('.mp4', '.mov', '.webm', '.mkv', '.avi'):
                        raise ExecutionError('selected_original_type_changed')
                    return
    raise ExecutionError('selected_original_unavailable')


class ProfileHubExecutionPort:
    def __init__(self, bindings: dict, state_dir: Path, *, sources=None, probe=verify_selected_original):
        self.b, self.state_dir = bindings, Path(state_dir)
        self.sources = sources or ExecutionSources()
        self.probe = probe

    def validate(self, request):
        for profile in request.profiles:
            adapter = self.sources.for_profile(profile.profile_url)
            if profile.video_folder and self.b['sanitize_folder_name'](profile.video_folder) != profile.video_folder:
                raise ExecutionError('invalid_video_destination')
            for item in profile.items:
                adapter.validate_item(item.model_dump())
                if item.collection_url:
                    adapter.validate_item({'kind': 'album', 'url': item.collection_url})

    def _unit(self, operation, kind, source_url, payload):
        media = sorted(image['original_url'] for image in payload['album']['images']) if kind == 'gallery' else source_url
        key = stable_id(operation['profile_url'], kind, operation['destination'], operation['mode'], media)
        return {'id': key, 'profile_key': operation['profile_key'], 'profile_url': operation['profile_url'],
            'profile_name': operation['profile_name'], 'kind': kind, 'destination': operation['destination'],
            'mode': operation['mode'], 'source_url': source_url, 'title': payload.get('title', ''), 'payload': payload}

    async def prepare(self, operation):
        adapter = self.sources.for_profile(operation['profile_url'])
        kind = operation['kind']
        items = operation['items']
        if kind == 'video':
            return [self._unit(operation, 'video', items[0]['url'], items[0])]
        if kind == 'playlist':
            pages = await adapter.pages('playlist', items[0]['url'])
            seen = set(); units = []
            for page in pages:
                for item in page['records']:
                    url = item['originalUrl']
                    if url in seen:
                        continue
                    adapter.validate_item({'kind': 'video', 'url': url})
                    seen.add(url)
                    units.append(self._unit(operation, 'video', url, {'id': item['id'], 'url': url,
                        'title': item.get('title', ''), 'thumbnail_url': item.get('thumbnailUrl'), 'duration': item.get('duration')}))
            return units
        if kind == 'album':
            pages = await adapter.pages('album', items[0]['url'])
            images = {}; first = None
            for page in pages:
                album = await self.b['_profile_hub_resolve_gallery_page'](page['url'], items[0]['title'])
                if album.telemetry.originals_unresolved or len(album.images) != len(page['records']):
                    raise ExecutionError('album_originals_incomplete')
                first = first or album
                for image in album.images:
                    if not image.original_url or image.validation_status != 'PASS':
                        raise ExecutionError('album_originals_incomplete')
                    https_url(image.original_url)
                    images.setdefault(image.original_url, image.model_dump(mode='json'))
            data = first.model_dump(mode='json')
            data['images'] = list(images.values())
            data['source_page'] = items[0]['url']
            data['metadata']['profile_hub_full_album'] = True
        elif items[0].get('collection_url'):
            source = await self.b['_profile_hub_resolve_gallery_page'](items[0]['collection_url'], items[0]['title'])
            selected = []
            for item in items:
                matches = [image for image in source.images if item['url'] in (image.original_url, image.thumbnail_url)]
                if len(matches) != 1 or not matches[0].original_url or matches[0].validation_status != 'PASS':
                    raise ExecutionError('selected_original_no_longer_matches')
                selected.append(matches[0].original_url)
            subset = filter_profile_album_subset(source, list(dict.fromkeys(selected)))
            subset.metadata.pop('original_total_count', None)  # Resolved records need not prove a collection total.
            data = subset.model_dump(mode='json')
        else:
            originals = {item['url']: item for item in items}
            data = Album(album_id='pending', title=operation['profile_name'] or items[0]['title'] or 'Profile Hub',
                original_title=operation['profile_name'] or 'Profile Hub', source_page=items[0].get('collection_url') or operation['profile_url'],
                images=[AlbumImage(id=item['id'], position=index, thumbnail_url=item.get('thumbnail_url') or url,
                    original_url=url, title=item['title'], source_page=item.get('collection_url') or operation['profile_url'],
                    media_type='gif' if kind == 'gif' else 'image', is_animated=kind == 'gif', validation_status='UNVERIFIED')
                    for index, (url, item) in enumerate(originals.items(), 1)]).model_dump(mode='json')
        for index, image in enumerate(data['images'], 1):
            image['position'] = index
        data['metadata']['profile_hub_selection_refs'] = [{'id': item['id'], 'kind': item['kind'], 'url': item['url']} for item in items]
        return [self._unit(operation, 'gallery', items[0].get('collection_url') or items[0]['url'], {'title': items[0]['title'], 'album': data})]

    def _read_metadata(self):
        path = Path(self.b['video_service'].metadata_file)
        return json.loads(path.read_text(encoding='utf-8')) if path.exists() else {}

    def _claim(self, unit, target=None):
        path = self.state_dir / 'claims' / f'{unit["id"]}.json'
        expected = {key: unit[key] for key in ('id', 'profile_url', 'kind', 'destination', 'mode')}
        if path.exists():
            if json.loads(path.read_text(encoding='utf-8')) != expected:
                raise ExecutionError('artifact_identity_conflict')
        else:
            if target and Path(target).exists():
                raise ExecutionError('unowned_target_exists')
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open('x', encoding='utf-8') as handle:
                json.dump(expected, handle, ensure_ascii=False); handle.flush(); os.fsync(handle.fileno())

    def _video_result(self, unit, artifact_id, target):
        entry = self._read_metadata().get(artifact_id)
        if not entry:
            return None
        mode = 'stream_url' if unit['mode'] == 'web_stream' else 'local'
        if entry.get('folder') != unit['destination'] or entry.get('source_url') != unit['source_url'] or entry.get('storage_location') != mode:
            raise ExecutionError('saved_artifact_destination_changed')
        if mode == 'local' and (not target.exists() or target.stat().st_size < 100000):
            return None
        if mode == 'stream_url' and not entry.get('custom_stream_url'):
            return None
        return {'artifact_id': artifact_id, 'saved_count': 1, 'mode': unit['mode'], 'destination': unit['destination']}

    async def run(self, unit, job_id):
        controller = self.b['_job_controllers'].get(job_id)
        if controller and hasattr(controller, 'wait_if_paused'):
            await controller.wait_if_paused()
        async with asset_lock(self.state_dir / 'locks', unit['id']):
            return await self._run_locked(unit, job_id)

    def queue(self, unit, job_id, task):
        payload = unit['payload']
        self.b['_active_jobs'][job_id] = {'session_id': job_id, 'url': unit['source_url'], 'source_url': unit['source_url'],
            'source_id': payload.get('id'), 'thumbnail_url': payload.get('thumbnail_url'),
            'title': payload.get('title') or unit['profile_name'], 'clean_title': payload.get('title') or unit['profile_name'],
            'folder': unit['destination'], 'status': 'queued', 'mode': 'video_save' if unit['kind'] == 'video' else 'profile_hub_gallery',
            'engine_type': 'video_stream_register' if unit['mode'] == 'web_stream' else 'video_downloader' if unit['kind'] == 'video' else 'profile_hub_gallery',
            'model': 'Profile Hub', 'started_at': datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC'),
            'profile_hub_profile_url': unit['profile_url'], 'profile_hub_unit_id': unit['id'], 'profile_hub_batch_id': unit['execution_id'],
            'stream_only': unit['mode'] == 'web_stream', 'downloaded_bytes': 0, 'total_bytes': 0, 'throughput_mbps': 0.0,
            'progress': {'current': 0, 'total': 1, 'percent': 0, 'status': 'Profile Hub: queued'}}
        self.b['_job_controllers'][job_id] = self.b['TaskJobController'](task)
        self.b['_save_jobs_to_disk']()

    def complete(self, job_id, status, result, error):
        job = self.b['_active_jobs'].get(job_id)
        if job is not None:
            job.update(status='completed' if status == 'succeeded' else 'cancelled' if status == 'interrupted' else 'error', result=result, error=error)
            if status == 'succeeded':
                job['progress'].update(current=1, total=1, percent=100, status='Profile Hub: saved')
        self.b['_job_controllers'].pop(job_id, None)
        self.b['_save_jobs_to_disk']()

    async def _run_locked(self, unit, job_id):
        b = self.b; service = b['video_service']; jobs = b['_active_jobs']
        folder = unit['destination']; payload = unit['payload']
        target = None
        if unit['kind'] == 'video':
            if b['sanitize_folder_name'](folder) != folder_name(folder):
                raise ExecutionError('invalid_video_destination')
            base = Path(service.base_dir).resolve()
            destination = (base / folder).resolve()
            if destination.parent != base or destination != base / folder:
                raise ExecutionError('unsafe_video_destination')
            target = destination / f'ph_{unit["id"][:32]}.mp4'
            if target.resolve() != target:
                raise ExecutionError('unsafe_video_target')
            artifact_id = hashlib.md5(unit['id'].encode()).hexdigest()[:12] if unit['mode'] == 'web_stream' else service._get_video_id(target.relative_to(base).as_posix())
            result = self._video_result(unit, artifact_id, target)
        else:
            artifact_id = 'ph_' + unit['id'][:32]
            path = Path(b['ALBUMS_DIR']) / f'{artifact_id}.json'
            result = None
            if path.exists():
                saved = json.loads(path.read_text(encoding='utf-8'))
                if saved.get('metadata', {}).get('profile_hub_unit_id') != unit['id'] or saved.get('folder') != folder:
                    raise ExecutionError('saved_artifact_destination_changed')
                if {image.get('original_url') for image in saved['images']} == {image['original_url'] for image in payload['album']['images']}:
                    result = {'artifact_id': artifact_id, 'saved_count': len(saved['images']), 'mode': 'gallery', 'destination': folder}
        if result:
            return result
        self._claim(unit, target if unit['mode'] == 'download' else None)
        jobs[job_id]['target_path'] = str(target) if target else None
        try:
            if unit['kind'] == 'video':
                target.parent.mkdir(parents=True, exist_ok=True)
                if unit['mode'] == 'web_stream':
                    async with b['_video_stream_register_semaphore']:
                        metadata = await b['_resolve_best_video_stream_with_meta'](payload['id'], unit['source_url'])
                        stream = metadata.get('stream_url')
                        if not stream or stream == unit['source_url']:
                            raise ExecutionError('video_stream_unresolved')
                        https_url(stream)
                        await b['_run_video_stream_register_task'](job_id=job_id, vurl=stream, clean_title=payload['title'], folder_name=folder,
                            source_url=unit['source_url'], source_id=payload['id'], thumbnail_url=payload.get('thumbnail_url'),
                            duration_hint=payload.get('duration'), registration_lookup=EmptyRegistrationLookup(), identity_seed=unit['id'], resolved_metadata=metadata)
                else:
                    async with b['_video_download_semaphore']:
                        await b['_run_video_download_task'](job_id=job_id, vurl=unit['source_url'], clean_title=payload['title'], folder_name=folder,
                            target_path=str(target), headers=b['_get_video_download_headers'](unit['source_url'], unit['source_url']),
                            source_url=unit['source_url'], source_id=payload['id'], thumbnail_url=payload.get('thumbnail_url'), registration_lookup=EmptyRegistrationLookup())
                if jobs[job_id]['status'] != 'completed':
                    raise ExecutionError('video_save_failed')
                result = self._video_result(unit, artifact_id, target)
                if not result:
                    raise ExecutionError('persistence_not_verified')
                if payload.get('title') and self._read_metadata()[artifact_id].get('title') != payload['title']:
                    service._update_single_metadata(vid_id=artifact_id, title=payload['title'])
            else:
                album = Album(**payload['album'])
                for image in album.images:
                    if image.validation_status != 'PASS':
                        await self.probe(image.original_url, 'gif' if image.media_type == 'gif' else 'photo')
                        image.validation_status = 'PASS'
                urls = {image.original_url for image in album.images}
                transport = PublicHTTPSHttpxTransport()
                try:
                    album = await b['_finalize_extracted_media'](album, transport=transport)
                finally:
                    await transport.aclose()
                if not urls or {image.original_url for image in album.images} != urls:
                    raise ExecutionError('gallery_media_changed_during_validation')
                album.album_id = artifact_id; album.folder = folder
                album.metadata.update(folder=folder, profile_hub_unit_id=unit['id'], profile_hub_profile_url=unit['profile_url'])
                controller = b['_job_controllers'].get(job_id)
                if controller and hasattr(controller, 'wait_if_paused'):
                    await controller.wait_if_paused()
                b['_ensure_album_folder_exists'](folder)
                jobs[job_id]['status'] = 'running'
                if not b['_save_album_to_disk'](artifact_id, album):
                    raise ExecutionError('gallery_persistence_failed')
                path = Path(b['ALBUMS_DIR']) / f'{artifact_id}.json'
                saved = json.loads(path.read_text(encoding='utf-8'))
                if saved.get('folder') != folder or {image.get('original_url') for image in saved['images']} != urls:
                    raise ExecutionError('persistence_not_verified')
                b['_completed_albums'][artifact_id] = album
                result = {'artifact_id': artifact_id, 'saved_count': len(album.images), 'mode': 'gallery', 'destination': folder}
            jobs[job_id].update(status='completed', result=result)
            jobs[job_id]['progress'].update(current=1, total=1, percent=100, status='Profile Hub: saved')
            return result
        except BaseException as exc:
            jobs[job_id].update(status='cancelled' if isinstance(exc, asyncio.CancelledError) else 'error', error=str(exc))
            raise
        finally:
            b['_job_controllers'].pop(job_id, None)
            b['_save_jobs_to_disk']()

    def progress(self, job_id):
        data = self.b['_active_jobs'].get(job_id, {}).get('progress', {})
        return {key: data[key] for key in ('current', 'total', 'percent', 'status', 'downloaded_bytes', 'total_bytes') if key in data}
