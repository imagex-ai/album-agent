"""Selected cleanup removes exact references and preserves recovery data on failure."""
import json
import logging
import os
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import pytest
from fastapi import HTTPException
from pydantic import BaseModel
from src.core.models import Album, AlbumImage
from src.core.media_classification import update_album_media_metadata
from src.observability.debugger import AgentDebugger
from tests.test_local_data_safety import trash, load_unit, run_sync_route


@pytest.fixture
def deletion(trash):
    images = [AlbumImage(position=index, thumbnail_url=f'https://cdn.test/{name}',
                         original_url=f'https://cdn.test/{name}', candidate_id=candidate)
              for index, (name, candidate) in enumerate([('logo.svg', 'logo'), ('photo.jpg', 'photo'), ('icon.png', None)])]
    album = Album(album_id='album', title='Fixture', original_title='Fixture',
                  source_page='https://example.test/gallery', images=images)
    path = Path(trash.albums_dir) / 'album.json'
    path.write_text(album.model_dump_json(), encoding='utf-8')
    namespace = dict(globals(), ALBUMS_DIR=trash.albums_dir,
                     _completed_albums={'album': album}, _active_jobs={},
                     _load_albums_from_disk=lambda: None,
                     _mark_album_summaries_dirty=lambda: None,
                     sanitize_album_images=update_album_media_metadata,
                     ensure_album_cover=lambda album: False,
                     is_auto_cloud_sync_enabled=lambda: False,
                     trash_service=trash, logger=logging.getLogger('cleanup-test'))
    load_unit('src/server/server.py', 'DeleteImageRef', namespace)
    request = load_unit('src/server/server.py', 'DeleteImagesRequest', namespace)
    load_unit('src/server/server.py', '_save_album_to_disk', namespace)
    route = load_unit('src/server/server.py', 'delete_album_images', namespace)
    return route, request, namespace, path


def test_candidate_reference_targets_selected_image_even_if_positional_id_is_stale(deletion):
    route, request, namespace, path = deletion
    response = run_sync_route(route('album', request(image_ids=['real-img-album-0'], image_refs=[{'candidate_id': 'photo'}])))
    assert response['deleted_count'] == 1
    assert [image.candidate_id for image in namespace['_completed_albums']['album'].images] == ['logo', None]
    assert len(namespace['trash_service'].list_all_items()) == 1


def test_stale_index_and_signature_refuses_to_remove_a_different_photo(deletion):
    route, request, namespace, path = deletion
    original = path.read_bytes()
    ref = {'index': 1, 'original_url': 'https://cdn.test/logo.svg', 'thumbnail_url': 'https://cdn.test/logo.svg'}
    with pytest.raises(HTTPException) as error:
        run_sync_route(route('album', request(image_ids=['real-img-album-1'], image_refs=[ref])))
    assert error.value.status_code == 409
    assert path.read_bytes() == original
    assert namespace['trash_service'].list_all_items() == []


def test_repeated_removal_uses_updated_indexes_and_preserves_photo(deletion):
    route, request, namespace, path = deletion
    response = run_sync_route(route('album', request(image_ids=['real-img-album-0'], image_refs=[{'candidate_id': 'logo'}])))
    assert len(response['album']['images']) == 2
    icon = response['album']['images'][1]
    ref = {'index': 1, 'original_url': icon['original_url'], 'thumbnail_url': icon['thumbnail_url']}
    response = run_sync_route(route('album', request(image_ids=['real-img-album-1'], image_refs=[ref])))
    assert [image['candidate_id'] for image in response['album']['images']] == ['photo']
    assert len(namespace['trash_service'].list_all_items()) == 2
    assert len(json.loads(path.read_text())['images']) == 1


def test_identical_sources_with_no_ids_can_remove_one_occurrence_only(deletion):
    route, request, namespace, path = deletion
    album = namespace['_completed_albums']['album']
    for image in album.images:
        image.id = None
        image.candidate_id = None
        image.original_url = 'https://cdn.test/logo.svg'
        image.thumbnail_url = image.original_url
    ref = {'index': 1, 'original_url': 'https://cdn.test/logo.svg', 'thumbnail_url': 'https://cdn.test/logo.svg'}
    response = run_sync_route(route('album', request(image_ids=['real-img-album-1'], image_refs=[ref])))
    assert response['deleted_count'] == 1
    assert len(response['album']['images']) == 2


def test_ambiguous_candidate_ids_are_not_removed(deletion):
    route, request, namespace, path = deletion
    namespace['_completed_albums']['album'].images[1].candidate_id = 'logo'
    with pytest.raises(HTTPException) as error:
        run_sync_route(route('album', request(image_ids=['real-img-album-0'], image_refs=[{'candidate_id': 'logo'}])))
    assert error.value.status_code == 409
    assert len(namespace['_completed_albums']['album'].images) == 3


def test_reused_candidate_id_with_changed_source_is_not_removed(deletion):
    route, request, namespace, path = deletion
    ref = {'candidate_id': 'logo', 'original_url': 'https://cdn.test/old.svg',
           'thumbnail_url': 'https://cdn.test/old.svg'}
    with pytest.raises(HTTPException) as error:
        run_sync_route(route('album', request(image_ids=['real-img-album-0'], image_refs=[ref])))
    assert error.value.status_code == 409
    assert len(namespace['_completed_albums']['album'].images) == 3


def test_failed_trash_save_leaves_album_unchanged(deletion, monkeypatch):
    route, request, namespace, path = deletion
    original = path.read_bytes()
    monkeypatch.setattr(namespace['trash_service'], '_save_meta', lambda data: False)
    with pytest.raises(HTTPException) as error:
        run_sync_route(route('album', request(image_ids=['real-img-album-0'], image_refs=[{'candidate_id': 'logo'}])))
    assert error.value.status_code == 500
    assert path.read_bytes() == original
    assert len(namespace['_completed_albums']['album'].images) == 3


def test_failed_album_write_preserves_file_memory_and_recovery_copy(deletion, monkeypatch):
    route, request, namespace, path = deletion
    original = path.read_bytes()
    real_replace = os.replace
    def fail_album_replace(src, dst):
        if Path(dst) == path:
            raise OSError('simulated album write failure')
        return real_replace(src, dst)
    monkeypatch.setattr(os, 'replace', fail_album_replace)
    with pytest.raises(HTTPException) as error:
        run_sync_route(route('album', request(image_ids=['real-img-album-0'], image_refs=[{'candidate_id': 'logo'}])))
    assert error.value.status_code == 500
    assert path.read_bytes() == original
    assert len(namespace['_completed_albums']['album'].images) == 3
    assert len(namespace['trash_service'].list_all_items()) == 1


def test_existing_recovery_copy_is_not_overwritten(trash):
    first = {'id': 'same', 'candidate_id': 'same', 'position': 0, 'original_url': 'https://cdn.test/first.svg'}
    second = dict(first, original_url='https://cdn.test/second.svg')
    a = trash.move_photos_to_trash('album', 'Fixture', [first])[0]
    b = trash.move_photos_to_trash('album', 'Fixture', [second])[0]
    assert a['id'] != b['id']
    assert len(trash.list_all_items()) == 2
