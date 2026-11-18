"""User-created example profiles: metadata and remote links only."""
import json
import os
from pathlib import Path
import tempfile
from threading import RLock

PROFILES_FILE = Path('data/local_profile_examples.json')
_lock = RLock()

def load_profiles():
    with _lock:
        if not PROFILES_FILE.exists():
            return []
        value = json.loads(PROFILES_FILE.read_text(encoding='utf-8'))
        if not isinstance(value, list):
            raise ValueError('Invalid local profile storage')
        return value

def _save(profiles):
    PROFILES_FILE.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(dir=PROFILES_FILE.parent, prefix='local_profile_', suffix='.tmp')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as handle:
            json.dump(profiles, handle, ensure_ascii=False, indent=2)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, PROFILES_FILE)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)

def create_example(identifier, snapshot):
    if not isinstance(identifier, str) or not identifier.startswith('demo:'):
        raise ValueError('Invalid example identity')
    if not isinstance(snapshot, dict) or not isinstance(snapshot.get('profile'), dict):
        raise ValueError('Invalid example snapshot')
    with _lock:
        profiles = load_profiles()
        existing = next((item for item in profiles if item['id'] == identifier), None)
        if existing:
            return existing
        entry = {'id': identifier, 'snapshot': snapshot, 'favorited': True}
        profiles.append(entry)
        _save(profiles)
        return entry

def set_example_favorite(identifier, favorited):
    with _lock:
        profiles = load_profiles()
        entry = next((item for item in profiles if item['id'] == identifier), None)
        if entry is None:
            raise ValueError('Local example not found')
        entry['favorited'] = bool(favorited)
        _save(profiles)
        return {'url': identifier, 'favorited': bool(favorited)}

def favorite_examples():
    return [{'url': entry['id'], 'name': entry['snapshot']['profile'].get('name'),
             'avatar_url': entry['snapshot']['profile'].get('avatarUrl'), 'local_example': True}
            for entry in load_profiles() if entry.get('favorited')]
