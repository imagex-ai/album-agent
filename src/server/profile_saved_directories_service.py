"""Durable local directory shortcuts; never imports application startup."""
import json
import os
from pathlib import Path
import tempfile
from threading import RLock
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode

DIRECTORIES_FILE = Path("data/saved_profile_directories.json")
_lock = RLock()


def _directory(value):
    if not isinstance(value, dict):
        raise ValueError("Directory is required")
    if not isinstance(value.get("id"), str) or not value["id"]:
        raise ValueError("Directory ID is required")
    if not isinstance(value.get("name"), str) or not value["name"].strip():
        raise ValueError("Directory name is required")
    if not isinstance(value.get("url"), str):
        raise ValueError("Directory URL is required")
    parts = urlsplit(value["url"])
    if parts.scheme not in ("http", "https") or not parts.hostname or parts.username or parts.password:
        raise ValueError("An HTTP directory URL without credentials is required")
    url = urlunsplit((parts.scheme, parts.netloc.lower(), parts.path, urlencode(sorted(parse_qsl(parts.query, keep_blank_values=True), key=lambda pair: pair[0])), ""))
    return {"id": value["id"], "name": value["name"].strip(), "url": url, "pinned": value.get("pinned") is True}


def load_saved_directories():
    with _lock:
        if not DIRECTORIES_FILE.exists():
            return []
        # A damaged file must not be silently treated as an empty collection.
        data = json.loads(DIRECTORIES_FILE.read_text(encoding="utf-8"))
        if not isinstance(data, list):
            raise ValueError("Saved directories file is invalid")
        return data


def get_saved_directories_state():
    with _lock:
        return {"directories": load_saved_directories(), "initialized": DIRECTORIES_FILE.exists()}


def set_saved_directory(item, removed=False):
    entry = _directory(item)
    with _lock:
        current = load_saved_directories()
        if removed:
            result = [value for value in current if value.get("id") != entry["id"]]
        else:
            if any(value.get("id") != entry["id"] and _directory(value)["url"] == entry["url"] for value in current):
                return {"directories": current}
            found = any(value.get("id") == entry["id"] for value in current)
            result = [{**value, **entry} if value.get("id") == entry["id"] else value for value in current] if found else [*current, entry]
        DIRECTORIES_FILE.parent.mkdir(parents=True, exist_ok=True)
        fd, temporary = tempfile.mkstemp(dir=DIRECTORIES_FILE.parent, prefix="saved_dirs_", suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(result, handle, ensure_ascii=False, indent=2)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, DIRECTORIES_FILE)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
        return {"directories": result}
