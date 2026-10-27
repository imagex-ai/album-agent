"""The scan uses temporary files, not the user's library."""
import importlib.util
import json
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('duplicate_album_scan', ROOT / 'src/server/duplicate_album_scan.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def write_album(base, name, contents):
    directory = base / name
    directory.mkdir()
    images = []
    for index, content in enumerate(contents):
        filename = f'{index}.jpg'
        (directory / filename).write_bytes(content)
        images.append({'original_url': f'/api/proxy-image?url=local://albums/{name}/{filename}'})
    (base / f'{name}.json').write_text(json.dumps({'album_id':name,'images':images}))


def wait(scanner, scan_id):
    deadline=time.monotonic()+5
    while time.monotonic()<deadline:
        state=scanner.snapshot(scan_id)
        if state['status']!='running':
            return state
        time.sleep(.01)
    raise AssertionError('scan did not complete')


def test_local_album_content_comparison_and_stale_guard(tmp_path):
    write_album(tmp_path,'a',[b'one',b'two'])
    write_album(tmp_path,'b',[b'two',b'one'])
    write_album(tmp_path,'c',[b'two',b'other'])
    (tmp_path/'remote.json').write_text(json.dumps({'images':[{'original_url':'https://example.test/image.jpg'}]}))
    scanner=module.DuplicateAlbumScanner(tmp_path)
    scan_id=scanner.start(); state=wait(scanner,scan_id)
    assert state['status']=='completed'
    assert [set(group['albumIds']) for group in state['groups']] == [{'a','b'}]
    assert state['skipped']==1
    assert scanner.validate(scan_id,'a')
    (tmp_path/'b'/'0.jpg').write_bytes(b'changed')
    assert not scanner.validate(scan_id,'a')


def test_rejects_nonlocal_missing_and_path_escape(tmp_path):
    scanner=module.DuplicateAlbumScanner(tmp_path)
    assert scanner._local_path('local://albums/../outside.jpg') is None
    assert scanner._local_path('https://example.test/file.jpg') is None
    assert scanner._local_path('local://albums/missing.jpg') is None


def test_partial_album_never_matches_complete_album(tmp_path):
    write_album(tmp_path,'a',[b'one',b'two'])
    write_album(tmp_path,'b',[b'one',b'two'])
    (tmp_path/'b'/'1.jpg').unlink()
    scanner=module.DuplicateAlbumScanner(tmp_path)
    state=wait(scanner,scanner.start())
    assert state['groups']==[]
    assert state['skipped']==1
