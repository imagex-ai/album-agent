"""Read-only, on-demand comparison of complete local album contents."""
from collections import defaultdict
import hashlib
import json
import os
from pathlib import Path
import threading
from urllib.parse import parse_qs, urlsplit
import uuid


class DuplicateAlbumScanner:
    def __init__(self, albums_dir):
        self.base = Path(albums_dir).resolve()
        self.jobs = {}
        self.lock = threading.RLock()

    @staticmethod
    def _signature(path):
        stat = path.stat()
        return stat.st_size, stat.st_mtime_ns, stat.st_ino, stat.st_dev

    def _local_path(self, url):
        if not isinstance(url, str):
            return None
        if url.startswith('/api/proxy-image?'):
            url = parse_qs(urlsplit(url).query).get('url', [''])[0]
        if not url.startswith('local://albums/'):
            return None
        path = (self.base / url[len('local://albums/'):].replace('\\', '/')).resolve()
        try:
            path.relative_to(self.base)
        except ValueError:
            return None
        return path if path.is_file() else None

    def start(self):
        scan_id = uuid.uuid4().hex
        job = {'status':'running', 'loaded':0, 'total':0, 'skipped':0, 'groups':[], 'albums':{}, 'cancel':threading.Event()}
        with self.lock:
            for key in list(self.jobs):
                if self.jobs[key]['status'] != 'running':
                    del self.jobs[key]
            self.jobs[scan_id] = job
        threading.Thread(target=self._scan, args=(job,), daemon=True).start()
        return scan_id

    def snapshot(self, scan_id):
        with self.lock:
            job = self.jobs.get(scan_id)
            return {key: job[key] for key in ('status','loaded','total','skipped','groups')} if job else None

    def cancel(self, scan_id):
        with self.lock:
            job = self.jobs.get(scan_id)
            if not job:
                return False
            job['cancel'].set()
            return True

    def _scan(self, job):
        try:
            files = sorted(self.base.glob('*.json'))
            job['total'] = len(files)
            groups = defaultdict(list)
            for metadata_path in files:
                if job['cancel'].is_set():
                    job['status'] = 'cancelled'
                    return
                try:
                    before = self._signature(metadata_path)
                    data = json.loads(metadata_path.read_text(encoding='utf-8'))
                    images = data.get('images')
                    if not isinstance(images, list) or not images:
                        raise ValueError('Empty album')
                    paths = []
                    for image in images:
                        if not isinstance(image, dict):
                            raise ValueError('Invalid image')
                        path = self._local_path(image.get('original_url') or image.get('thumbnail_url'))
                        if not path:
                            raise ValueError('Not an available local file')
                        paths.append(path)
                    fingerprints, signatures = [], []
                    for path in paths:
                        signature = self._signature(path)
                        digest = hashlib.sha256()
                        with path.open('rb') as stream:
                            while chunk := stream.read(1024 * 1024):
                                if job['cancel'].is_set():
                                    job['status'] = 'cancelled'
                                    return
                                digest.update(chunk)
                        if self._signature(path) != signature:
                            raise ValueError('File changed')
                        fingerprints.append(digest.hexdigest())
                        signatures.append((path, signature))
                    if self._signature(metadata_path) != before:
                        raise ValueError('Album changed')
                    album_id = metadata_path.stem
                    groups[tuple(sorted(fingerprints))].append(album_id)
                    job['albums'][album_id] = (metadata_path, before, signatures)
                except (OSError, ValueError, TypeError, AttributeError):
                    job['skipped'] += 1
                job['loaded'] += 1
            job['groups'] = [{'id':hashlib.sha256(json.dumps(key).encode()).hexdigest(), 'albumIds':ids}
                             for key, ids in groups.items() if len(ids) > 1]
            job['status'] = 'cancelled' if job['cancel'].is_set() else 'completed'
        except Exception:
            job['status'] = 'failed'

    def validate(self, scan_id, album_id):
        with self.lock:
            job = self.jobs.get(scan_id)
            if not job or job['status'] != 'completed':
                return False
            group = next((group for group in job['groups'] if album_id in group['albumIds']), None)
            if not group:
                return False
            def unchanged(identifier):
                try:
                    metadata, before, files = job['albums'][identifier]
                    return self._signature(metadata) == before and all(self._signature(path) == signature for path, signature in files)
                except (KeyError, OSError):
                    return False
            return unchanged(album_id) and any(other != album_id and unchanged(other) for other in group['albumIds'])
