"""Confirmed Profile Hub execution. No application startup, network or library imports.

The injected port owns extraction/storage. SQLite commits the immutable request,
resolved work and individual outcomes before dispatch/retry. Reading status never
starts work. All tests can use a disposable database and a fake port.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import re
import sqlite3
import time
import uuid
from contextlib import asynccontextmanager, contextmanager
from collections import deque
from pathlib import Path
from typing import Any, Literal, Protocol
from urllib.parse import urlsplit

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class ExecutionError(ValueError):
    def __init__(self, code: str, *, details: dict | None = None):
        super().__init__(code)
        self.details = details


class ProfileExecutionSlots:
    """Bound total work while sharing free slots across waiting source profiles.

    Running work is never preempted. Prefer profiles with fewer active units,
    rotating ties; a single profile can still use all otherwise idle capacity.
    """
    def __init__(self, limit=2):
        self.limit = limit
        self.active = {}
        self.waiting = {}
        self.scheduled = False

    def _schedule(self):
        if not self.scheduled:
            self.scheduled = True
            asyncio.get_running_loop().call_soon(self._dispatch)

    def _dispatch(self):
        self.scheduled = False
        for profile, queue in list(self.waiting.items()):
            self.waiting[profile] = deque(entry for entry in queue if not entry['future'].done())
            if not self.waiting[profile]:
                del self.waiting[profile]
        while self.waiting and sum(self.active.values()) < self.limit:
            profile = min(self.waiting, key=lambda key: self.active.get(key, 0))
            queue = self.waiting.pop(profile)
            entry = queue.popleft()
            if queue:
                self.waiting[profile] = queue
            self.active[profile] = self.active.get(profile, 0) + 1
            entry['granted'] = True
            entry['future'].set_result(None)

    def _release(self, profile):
        self.active[profile] -= 1
        if not self.active[profile]:
            del self.active[profile]
        self._schedule()

    @asynccontextmanager
    async def slot(self, profile):
        entry = {'future': asyncio.get_running_loop().create_future(), 'granted': False}
        self.waiting.setdefault(profile, deque()).append(entry)
        self._schedule()
        try:
            await entry['future']
            yield
        finally:
            if entry['granted']:
                self._release(profile)
            else:
                entry['future'].cancel()
                self._schedule()


def https_url(value: str) -> str:
    if not isinstance(value, str) or not value or len(value) > 4096 or any(ord(c) < 33 for c in value) or '\\' in value:
        raise ValueError('invalid_media_url')
    parsed = urlsplit(value)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.port not in (None, 443) or parsed.fragment:
        raise ValueError('invalid_media_url')
    import ipaddress
    host = parsed.hostname.rstrip('.').lower()
    if host == 'localhost' or host.endswith(('.localhost', '.local', '.internal')):
        raise ValueError('unsafe_media_url')
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        address = None
    if address and not address.is_global:
        raise ValueError('unsafe_media_url')
    return value


def folder_name(value: str | None) -> str | None:
    if value is None:
        return None
    if not value or value != value.strip() or len(value) > 150 or value[-1:] == '.' or re.search(r'[<>:"/\\|?*\x00-\x1f]', value):
        raise ValueError('invalid_destination')
    if value in ('.', '..') or value.split('.')[0].upper() in {'CON', 'PRN', 'AUX', 'NUL', *(f'COM{i}' for i in range(1, 10)), *(f'LPT{i}' for i in range(1, 10))}:
        raise ValueError('invalid_destination')
    return value


class StrictModel(BaseModel):
    model_config = ConfigDict(extra='forbid')


class SelectedMedia(StrictModel):
    id: str = Field(min_length=1, max_length=512)
    kind: Literal['video', 'playlist', 'album', 'photo', 'gif']
    url: str
    title: str = Field(default='', max_length=1000)
    thumbnail_url: str | None = None
    collection_url: str | None = None
    duration: str | None = Field(default=None, max_length=40)

    _url = field_validator('url')(https_url)

    @field_validator('thumbnail_url', 'collection_url')
    @classmethod
    def optional_url(cls, value):
        return https_url(value) if value else None


class ProfileExecutionInput(StrictModel):
    profile_key: str = Field(min_length=1, max_length=1024)
    profile_url: str
    profile_name: str = Field(default='', max_length=1000)
    video_folder: str | None = None
    gallery_folder: str | None = None
    video_mode: Literal['web_stream', 'download'] | None = None
    items: list[SelectedMedia] = Field(min_length=1, max_length=10000)

    _profile_url = field_validator('profile_url')(https_url)
    _video_folder = field_validator('video_folder')(folder_name)

    @field_validator('gallery_folder')
    @classmethod
    def gallery_destination(cls, value):
        # Gallery folders are logical labels, not video filesystem paths.
        if value is not None and (not value.strip() or value != value.strip() or len(value) > 150 or any(ord(c) < 32 for c in value)):
            raise ValueError('invalid_gallery_destination')
        return value

    @model_validator(mode='after')
    def destinations(self):
        video = any(item.kind in ('video', 'playlist') for item in self.items)
        gallery = any(item.kind in ('album', 'photo', 'gif') for item in self.items)
        if video and (not self.video_folder or not self.video_mode):
            raise ValueError('video_destination_required')
        if gallery and not self.gallery_folder:
            raise ValueError('gallery_destination_required')
        keys = [(item.kind, item.id) for item in self.items]
        if len(keys) != len(set(keys)):
            raise ValueError('duplicate_selection')
        return self


class ConfirmExecution(StrictModel):
    request_id: uuid.UUID
    confirmed: Literal[True]
    profiles: list[ProfileExecutionInput] = Field(min_length=1, max_length=1000)

    @model_validator(mode='after')
    def unique_profiles(self):
        if len({profile.profile_key for profile in self.profiles}) != len(self.profiles):
            raise ValueError('duplicate_profile')
        if len({profile.profile_url for profile in self.profiles}) != len(self.profiles):
            raise ValueError('duplicate_profile_origin')
        if sum(len(profile.items) for profile in self.profiles) > 20000:
            raise ValueError('selection_limit')
        return self


class RetryExecution(StrictModel):
    retry_id: uuid.UUID
    operation_ids: list[str] | None = Field(default=None, max_length=20000)


def stable_id(*parts: Any) -> str:
    return hashlib.sha256(json.dumps(parts, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()


class ExecutionPort(Protocol):
    def validate(self, request: ConfirmExecution) -> None: ...
    async def prepare(self, operation: dict) -> list[dict]: ...
    async def run(self, unit: dict, job_id: str) -> dict: ...
    def queue(self, unit: dict, job_id: str, task: asyncio.Task) -> None: ...
    def complete(self, job_id: str, status: str, result: dict | None, error: str | None) -> None: ...
    def progress(self, job_id: str) -> dict: ...


class ExecutionRepository:
    """Per-transaction connections also serialize independent server processes."""
    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.execute('CREATE TABLE IF NOT EXISTS batches (id TEXT PRIMARY KEY, digest TEXT NOT NULL, data TEXT NOT NULL)')

    @contextmanager
    def connect(self):
        connection = sqlite3.connect(self.path, timeout=10)
        try:
            connection.execute('PRAGMA synchronous=FULL')
            with connection:
                yield connection
        finally:
            connection.close()

    def get(self, key):
        with self.connect() as db:
            row = db.execute('SELECT data FROM batches WHERE id=?', (key,)).fetchone()
        return json.loads(row[0]) if row else None

    def create(self, key, digest, batch):
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT digest FROM batches WHERE id=?', (key,)).fetchone()
            if row:
                if row[0] != digest:
                    raise ExecutionError('request_id_conflict')
                return False
            db.execute('INSERT INTO batches VALUES (?, ?, ?)', (key, digest, json.dumps(batch, ensure_ascii=False)))
        return True

    def mutate(self, key, action):
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT data FROM batches WHERE id=?', (key,)).fetchone()
            if not row:
                raise KeyError(key)
            batch = json.loads(row[0])
            action(batch)
            db.execute('UPDATE batches SET data=? WHERE id=?', (json.dumps(batch, ensure_ascii=False), key))
        return batch


def build_operations(request: ConfirmExecution):
    operations = {}
    for profile in request.profiles:
        photos = {}
        for item in profile.items:
            # Individual media use a gallery container per origin/type/collection,
            # preserving every selected reference and never fetching its neighbours.
            group = (item.kind, item.collection_url or '') if item.kind in ('photo', 'gif') else (item.kind, item.id)
            photos.setdefault(group, []).append(item.model_dump())
        for (kind, _), items in photos.items():
            destination = profile.video_folder if kind in ('video', 'playlist') else profile.gallery_folder
            mode = profile.video_mode if kind in ('video', 'playlist') else 'gallery'
            key = stable_id(profile.profile_key, kind, [item['id'] for item in items], destination, mode)
            operations[key] = {'id': key, 'profile_key': profile.profile_key, 'profile_url': profile.profile_url,
                'profile_name': profile.profile_name, 'kind': kind, 'destination': destination, 'mode': mode,
                'items': items, 'status': 'queued', 'resolved': False, 'unit_ids': [], 'error': None, 'error_details': None}
    return operations


def refresh_operations(batch):
    for operation in batch['operations'].values():
        if not operation['resolved']:
            continue
        states = [batch['units'][key]['status'] for key in operation['unit_ids']]
        operation['status'] = ('running' if 'running' in states else 'queued' if 'queued' in states else
            'failed' if any(state in ('failed', 'interrupted') for state in states) else 'succeeded')
        errors = [batch['units'][key]['error'] for key in operation['unit_ids'] if batch['units'][key].get('error')]
        operation['error'] = errors[0] if errors else None


class ExecutionCoordinator:
    LEASE_SECONDS = 300

    def __init__(self, repository: ExecutionRepository, port: ExecutionPort, *, clock=time.time):
        self.repository, self.port, self.clock = repository, port, clock
        self.owner = uuid.uuid4().hex
        self.tasks = {}
        self.wakeups = {}
        self.slots = ProfileExecutionSlots(2)
        self.resolution_semaphore = asyncio.Semaphore(2)

    async def confirm(self, request: ConfirmExecution):
        self.port.validate(request)  # Pure validation, before committing ANY work.
        key = str(request.request_id)
        data = request.model_dump(mode='json')
        now = self.clock()
        batch = {'id': key, 'created_at': now, 'heartbeat': now, 'owner': self.owner,
            'operations': build_operations(request), 'units': {}, 'retry_requests': {}}
        created = self.repository.create(key, stable_id(data), batch)
        if created:
            self._schedule(key)
        return self.snapshot(key)

    def _change(self, key, action):
        def update(batch):
            if batch['owner'] != self.owner:
                raise ExecutionError('execution_lease_lost')
            action(batch)
            batch['heartbeat'] = self.clock()
            refresh_operations(batch)
        return self.repository.mutate(key, update)

    def _schedule(self, key):
        self.wakeups.setdefault(key, asyncio.Event()).set()
        if key not in self.tasks or self.tasks[key].done():
            self.tasks[key] = asyncio.create_task(self._run(key))

    async def _prepare(self, key, operation):
        async with self.resolution_semaphore:
            op_id = operation['id']
            self._change(key, lambda batch: batch['operations'][op_id].update(status='resolving', error=None, error_details=None))
            try:
                prepared = await self.port.prepare(operation)
                if not prepared:
                    raise ExecutionError('empty_collection')
                for unit in prepared:
                    if not re.fullmatch('[0-9a-f]{64}', str(unit.get('id', ''))):
                        raise ExecutionError('invalid_prepared_identity')
                    if any(unit.get(field) != operation[field] for field in ('profile_key', 'profile_url', 'destination', 'mode')):
                        raise ExecutionError('prepared_scope_mismatch')
                    if unit.get('kind') != ('video' if operation['kind'] in ('video', 'playlist') else 'gallery'):
                        raise ExecutionError('prepared_media_type_mismatch')
                def commit(batch):
                    root = batch['operations'][op_id]
                    for unit in prepared:
                        unit_id = unit['id']
                        if unit_id not in batch['units']:
                            batch['units'][unit_id] = {**unit, 'status': 'queued', 'attempts': 0, 'error': None, 'progress': {}, 'result': None, 'job_id': None}
                        if unit_id not in root['unit_ids']:
                            root['unit_ids'].append(unit_id)
                    root['resolved'] = True
                self._change(key, commit)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                message = str(exc) if isinstance(exc, ExecutionError) else 'collection_resolution_failed'
                details = exc.details if isinstance(exc, ExecutionError) else None
                self._change(key, lambda batch: batch['operations'][op_id].update(status='failed', error=message, error_details=details))

    async def _execute(self, key, unit):
        unit_id = unit['id']
        job_id = f'ph_{key.replace("-", "")}_{unit_id[:32]}_{unit["attempts"] + 1}'
        result = None; error = None; status = 'failed'
        try:
            self._change(key, lambda batch: batch['units'][unit_id].update(status='queued', attempts=unit['attempts'] + 1, error=None, job_id=job_id))
            work = {**unit, 'execution_id': key}
            self.port.queue(work, job_id, asyncio.current_task())
            async with self.slots.slot(unit['profile_url']):
                self._change(key, lambda batch: batch['units'][unit_id].update(status='running'))
                result = await self.port.run(work, job_id)
                if not isinstance(result, dict) or not result.get('artifact_id'):
                    raise ExecutionError('persistence_not_verified')
                self._change(key, lambda batch: batch['units'][unit_id].update(status='succeeded', result=result, progress=self.port.progress(job_id)))
                status = 'succeeded'
        except asyncio.CancelledError:
            status = 'interrupted'; error = 'execution_interrupted'
            self._change(key, lambda batch: batch['units'][unit_id].update(status=status, error=error))
        except Exception as exc:
            error = str(exc) if isinstance(exc, ExecutionError) else 'media_execution_failed'
            if error == 'execution_lease_lost':
                return
            status = 'interrupted' if error == 'execution_interrupted' else 'failed'
            self._change(key, lambda batch: batch['units'][unit_id].update(status=status, error=error, progress=self.port.progress(job_id)))
        finally:
            try:
                self.port.complete(job_id, status, result, error)
            except Exception:
                # Queue reporting must not turn a verified persisted artifact into
                # another dispatch or prevent independent units from completing.
                pass

    async def _heartbeat(self, key):
        while True:
            await asyncio.sleep(2)
            def update(batch):
                for unit in batch['units'].values():
                    if unit['status'] == 'running' and unit['job_id']:
                        unit['progress'] = self.port.progress(unit['job_id'])
            self._change(key, update)

    async def _run(self, key):
        heartbeat = asyncio.create_task(self._heartbeat(key))
        finished = False
        preparing = {}; executing = {}
        try:
            while True:
                wake = self.wakeups[key]; wake.clear()
                for table in (preparing, executing):
                    for item_id, task in list(table.items()):
                        if task.done():
                            task.result()
                            del table[item_id]
                batch = self.repository.get(key)
                if batch['owner'] != self.owner:
                    return
                for operation in batch['operations'].values():
                    if not operation['resolved'] and operation['status'] == 'queued' and operation['id'] not in preparing:
                        preparing[operation['id']] = asyncio.create_task(self._prepare(key, operation))
                for unit in batch['units'].values():
                    if unit['status'] == 'queued' and unit['id'] not in executing:
                        executing[unit['id']] = asyncio.create_task(self._execute(key, unit))
                if not preparing and not executing:
                    finished = True
                    break
                waiter = asyncio.create_task(wake.wait())
                try:
                    await asyncio.wait([*preparing.values(), *executing.values(), waiter], return_when=asyncio.FIRST_COMPLETED)
                finally:
                    waiter.cancel()
                    await asyncio.gather(waiter, return_exceptions=True)
        finally:
            if not finished:
                for task in [*preparing.values(), *executing.values()]:
                    task.cancel()
                await asyncio.gather(*preparing.values(), *executing.values(), return_exceptions=True)
                if self.repository.get(key)['owner'] == self.owner:
                    def interrupted(batch):
                        for op in batch['operations'].values():
                            if not op['resolved'] and op['status'] in ('queued', 'resolving'):
                                op.update(status='interrupted', error='execution_interrupted')
                        for unit in batch['units'].values():
                            if unit['status'] in ('queued', 'running'):
                                unit.update(status='interrupted', error='execution_interrupted')
                    self._change(key, interrupted)
            heartbeat.cancel()
            await asyncio.gather(heartbeat, return_exceptions=True)
            if finished:
                self.tasks.pop(key, None)
                latest = self.repository.get(key)
                if latest['owner'] == self.owner and (any(unit['status'] == 'queued' for unit in latest['units'].values())
                        or any(not op['resolved'] and op['status'] == 'queued' for op in latest['operations'].values())):
                    self._schedule(key)

    def _expire(self, key):
        def expire(batch):
            if self.clock() - batch['heartbeat'] <= self.LEASE_SECONDS:
                return
            for operation in batch['operations'].values():
                if not operation['resolved'] and operation['status'] in ('queued', 'resolving'):
                    operation.update(status='interrupted', error='execution_interrupted')
            for unit in batch['units'].values():
                if unit['status'] in ('queued', 'running'):
                    unit.update(status='interrupted', error='execution_interrupted')
            refresh_operations(batch)
        return self.repository.mutate(key, expire)

    async def retry(self, key: str, request: RetryExecution):
        self._expire(key)
        retry_key = str(request.retry_id)
        requested = sorted(set(request.operation_ids or []))
        def reset(batch):
            prior = batch['retry_requests'].get(retry_key)
            if prior is not None:
                if prior != requested:
                    raise ExecutionError('retry_id_conflict')
                return
            failed = {op['id'] for op in batch['operations'].values() if not op['resolved'] and op['status'] in ('failed', 'interrupted')}
            failed.update(unit['id'] for unit in batch['units'].values() if unit['status'] in ('failed', 'interrupted'))
            chosen = set(requested) if requested else failed
            if chosen - failed or not chosen:
                raise ExecutionError('only_failed_operations_can_retry')
            active = any(op['status'] in ('queued', 'resolving', 'running') for op in batch['operations'].values())
            if batch['owner'] != self.owner and active and self.clock() - batch['heartbeat'] <= self.LEASE_SECONDS:
                raise ExecutionError('execution_owned_by_another_worker')
            batch['owner'] = self.owner
            batch['heartbeat'] = self.clock()
            for op_id in chosen:
                if op_id in batch['units']:
                    batch['units'][op_id].update(status='queued', error=None)
                else:
                    batch['operations'][op_id].update(status='queued', error=None, error_details=None)
            batch['retry_requests'][retry_key] = requested
            refresh_operations(batch)
        self.repository.mutate(key, reset)
        self._schedule(key)
        return self.snapshot(key)

    def snapshot(self, key):
        batch = self._expire(key)
        operations = [{k: v for k, v in operation.items() if k != 'items'} | {'items': operation['items']} for operation in batch['operations'].values()]
        units = [{k: v for k, v in unit.items() if k != 'payload'} for unit in batch['units'].values()]
        return {'id': batch['id'], 'created_at': batch['created_at'], 'operations': operations, 'units': units,
            'retry_ids': list(batch['retry_requests'])[-64:],
            'active': any(op['status'] in ('queued', 'resolving', 'running') for op in operations)}


def execution_router(coordinator: ExecutionCoordinator):
    router = APIRouter(prefix='/api/profile-hub/executions', tags=['Profile Hub execution'])
    def failure(exc):
        if isinstance(exc, KeyError):
            return HTTPException(404, detail='execution_not_found')
        return HTTPException(409 if 'conflict' in str(exc) or 'retry' in str(exc) or 'worker' in str(exc) else 400, detail=str(exc))

    @router.post('')
    async def confirm(request: ConfirmExecution):
        try:
            return await coordinator.confirm(request)
        except ExecutionError as exc:
            raise failure(exc) from exc

    @router.get('/{request_id}')
    async def status(request_id: uuid.UUID):
        try:
            return coordinator.snapshot(str(request_id))
        except KeyError as exc:
            raise failure(exc) from exc

    @router.post('/{request_id}/retry')
    async def retry(request_id: uuid.UUID, request: RetryExecution):
        try:
            return await coordinator.retry(str(request_id), request)
        except (KeyError, ExecutionError) as exc:
            raise failure(exc) from exc
    return router
