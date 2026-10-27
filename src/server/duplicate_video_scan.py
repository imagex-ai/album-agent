"""Read-only, explicitly requested comparison of local video files."""
from collections import defaultdict
import hashlib
import json
import os
from pathlib import Path
import threading
import uuid
from .video_similarity import ffmpeg_path, probe_duration, frame_hash, fingerprints_close


class DuplicateVideoScanner:
    def __init__(self, video_service, supported_extensions=None):
        self.service = video_service
        self.supported_extensions = supported_extensions or {'.mp4', '.mkv', '.webm', '.mov', '.avi', '.m4v'}
        self.jobs = {}
        self.lock = threading.RLock()

    def start(self, mode='exact'):
        scan_id = uuid.uuid4().hex
        job = {"status": "running", "loaded": 0, "total": 0, "skipped": 0,
               "groups": [], "files": {}, "cancel": threading.Event(), "mode": mode}
        with self.lock:
            # Keep at most the most recent completed results in memory.
            for key in list(self.jobs):
                if self.jobs[key]["status"] != "running":
                    del self.jobs[key]
            self.jobs[scan_id] = job
        threading.Thread(target=self._scan, args=(job,), daemon=True).start()
        return scan_id

    def snapshot(self, scan_id):
        with self.lock:
            job = self.jobs.get(scan_id)
            if not job:
                return None
            return {key: job[key] for key in ("status", "loaded", "total", "skipped", "groups")}

    def cancel(self, scan_id):
        with self.lock:
            job = self.jobs.get(scan_id)
            if not job:
                return False
            job["cancel"].set()
            return True

    @staticmethod
    def _signature(path):
        stat = os.stat(path)
        return (stat.st_size, stat.st_mtime_ns, stat.st_ino, stat.st_dev)

    def _scan(self, job):
        try:
            base = Path(self.service.base_dir).resolve()
            # Read metadata locally; the regular loader may trigger cloud maintenance.
            try:
                with open(self.service.metadata_file, encoding="utf-8") as source:
                    meta = json.load(source)
                if not isinstance(meta, dict):
                    raise ValueError("Invalid video metadata")
            except FileNotFoundError:
                meta = {}
            sizes = defaultdict(list)
            seen_ids = set()
            for root, _, names in os.walk(base):
                for name in names:
                    if job["cancel"].is_set():
                        job["status"] = "cancelled"
                        return
                    if Path(name).suffix.lower() not in self.supported_extensions:
                        continue
                    path = (Path(root) / name).resolve()
                    try:
                        path.relative_to(base)
                        if not path.is_file():
                            continue
                        rel = path.relative_to(base).as_posix()
                        video_id = self.service._find_video_id(rel, meta)
                        if video_id in seen_ids:
                            job["skipped"] += 1
                            continue
                        seen_ids.add(video_id)
                        signature = self._signature(path)
                        if signature[0] > 0:
                            sizes[signature[0]].append((video_id, path, signature))
                    except (OSError, ValueError):
                        job["skipped"] += 1
            candidates = [item for group in sizes.values() if len(group) > 1 for item in group]
            job["skipped"] += sum(1 for key, entry in meta.items() if key not in seen_ids and isinstance(entry, dict))
            if job['mode'] == 'similar':
                self._scan_similar(job, [item for group in sizes.values() for item in group], meta)
                return
            job["total"] = len(candidates)
            hashes = defaultdict(list)
            for video_id, path, signature in candidates:
                if job["cancel"].is_set():
                    job["status"] = "cancelled"
                    return
                try:
                    digest = hashlib.sha256()
                    with open(path, 'rb') as source:
                        while chunk := source.read(1024 * 1024):
                            if job["cancel"].is_set():
                                job["status"] = "cancelled"
                                return
                            digest.update(chunk)
                    if self._signature(path) != signature:
                        job["skipped"] += 1
                    else:
                        hashes[(signature[0], digest.hexdigest())].append(video_id)
                        job["files"][video_id] = (path, signature)
                except OSError:
                    job["skipped"] += 1
                job["loaded"] += 1
            job["groups"] = [{"id": digest, "videoIds": ids} for (_, digest), ids in hashes.items() if len(ids) > 1]
            job["status"] = "cancelled" if job["cancel"].is_set() else "completed"
        except Exception:
            job["status"] = "failed"

    def _scan_similar(self, job, files, meta):
        exe = ffmpeg_path()
        if not exe:
            job['status'] = 'failed'
            return
        job['total'] = len(files) * 2
        durations = []
        for video_id, path, signature in files:
            if job['cancel'].is_set():
                job['status'] = 'cancelled'
                return
            entry = meta.get(video_id) or {}
            try:
                duration = float(entry.get('duration_seconds') or entry.get('duration') or 0)
            except (ValueError, TypeError, AttributeError):
                duration = 0
            if not 1 <= duration <= 24 * 3600:
                duration = probe_duration(exe, path, job['cancel']) or 0
            if 1 <= duration <= 24 * 3600:
                durations.append((duration, video_id, path, signature))
            else:
                job['skipped'] += 1
            job['loaded'] += 1
        durations.sort(key=lambda item: item[0])
        eligible = set()
        for index, (duration, video_id, _, _) in enumerate(durations):
            for other_duration, other_id, _, _ in durations[index + 1:]:
                if other_duration - duration > max(2.0, other_duration * .025):
                    break
                eligible.update((video_id, other_id))
        fingerprints = []
        for duration, video_id, path, signature in durations:
            if job['cancel'].is_set():
                job['status'] = 'cancelled'
                return
            if video_id in eligible:
                frames = [frame_hash(exe, path, duration * fraction, job['cancel']) for fraction in (.2, .5, .8)]
                try:
                    unchanged = self._signature(path) == signature
                except OSError:
                    unchanged = False
                if all(frame is not None for frame in frames) and unchanged:
                    fingerprints.append((duration, video_id, frames))
                    job['files'][video_id] = (path, signature)
                else:
                    job['skipped'] += 1
            job['loaded'] += 1
        # Files with unknown duration were already counted in the first phase.
        job['loaded'] = job['total']
        groups = []
        for index, (duration, video_id, frames) in enumerate(fingerprints):
            if job['cancel'].is_set():
                job['status'] = 'cancelled'
                return
            for other_duration, other_id, other_frames in fingerprints[index + 1:]:
                if other_duration - duration > max(2.0, other_duration * .025):
                    break
                if fingerprints_close(frames, other_frames):
                    group_id = hashlib.sha256(json.dumps(sorted([video_id, other_id])).encode()).hexdigest()
                    groups.append({'id': group_id, 'videoIds': [video_id, other_id], 'reason': 'similar'})
        job['groups'] = groups
        job['status'] = 'cancelled' if job['cancel'].is_set() else 'completed'

    def validate(self, scan_id, video_id, current_path):
        """Require the target and another matched file to still be the scanned files."""
        with self.lock:
            job = self.jobs.get(scan_id)
            if not job or job["status"] != "completed":
                return False
            group = next((g for g in job["groups"] if video_id in g["videoIds"]), None)
            if not group:
                return False
            try:
                target_path, target_signature = job["files"][video_id]
                if not current_path or Path(current_path).resolve() != target_path:
                    return False
                if self._signature(target_path) != target_signature:
                    return False
                return any(other != video_id and self._signature(job["files"][other][0]) == job["files"][other][1]
                           for other in group["videoIds"])
            except (OSError, KeyError):
                return False
