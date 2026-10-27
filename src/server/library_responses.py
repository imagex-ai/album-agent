"""Bounded serialized response cache; encoding runs in FastAPI's sync worker.

The original album objects remain untouched. Full-list clients stay compatible;
the app can request complete records in cursor pages without one huge parse.
"""
import gzip
import json
import threading
from collections import OrderedDict


def accepts_gzip(value):
    explicit, wildcard = None, False
    for item in value.lower().split(','):
        coding, *parameters = (part.strip() for part in item.split(';'))
        quality = 1.0
        for parameter in parameters:
            if parameter.startswith('q='):
                try:
                    quality = float(parameter[2:])
                except ValueError:
                    quality = 0.0
        if coding == 'gzip':
            explicit = quality > 0
        elif coding == '*':
            wildcard = quality > 0
    return explicit if explicit is not None else wildcard


class LibraryResponseCache:
    def __init__(self, max_bytes=24 * 1024 * 1024):
        self.max_bytes = max_bytes
        self._source = None
        self._entries = OrderedDict()
        self._size = 0
        self._lock = threading.RLock()

    def encode(self, source, key, records, compress=False):
        with self._lock:
            if self._source is not source:
                self._source = source
                self._entries.clear()
                self._size = 0
            cache_key = (key, compress)
            if cache_key in self._entries:
                self._entries.move_to_end(cache_key)
                return self._entries[cache_key]
            body = json.dumps(records, ensure_ascii=False, allow_nan=False, separators=(',', ':')).encode('utf-8')
            if compress:
                body = gzip.compress(body, compresslevel=1, mtime=0)
            if len(body) <= self.max_bytes:
                while self._entries and self._size + len(body) > self.max_bytes:
                    _, expired = self._entries.popitem(last=False)
                    self._size -= len(expired)
                self._entries[cache_key] = body
                self._size += len(body)
            return body


def album_page(records, *, after=None, offset=0, limit=None, limit_images=None):
    if after is not None:
        previous = next((i for i, album in enumerate(records) if (album.get('session_id') or album.get('album_id')) == after), None)
        if previous is None:
            raise KeyError(after)
        offset = previous + 1
    page = records[offset:] if limit is None else records[offset:offset + limit]
    if limit_images is not None:
        page = [{**album, 'images': album.get('images', [])[:limit_images]} for album in page]
    return page
