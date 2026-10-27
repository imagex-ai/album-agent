"""GIF/category regressions with generated media and no library/server startup."""
import base64
import io
import re
from types import SimpleNamespace

from PIL import Image
import pytest

from src.core.models import Album, AlbumImage
from src.core.media_classification import (
    apply_image_animation, filter_album_media, image_header_facts, media_category,
    media_source_format, normalize_media_item, update_album_media_metadata,
    verify_media_animation,
)
from src.observability.debugger import AgentDebugger
from src.validator.validator import ImageValidator
from tests.test_local_data_safety import load_unit, run_sync_route


def media(url="https://cdn.test/photo.webp", **fields):
    return AlbumImage(position=1, original_url=url, thumbnail_url=url, **fields)


def album(images):
    return Album(album_id="fixture", title="Fixture", original_title="Fixture", source_page="https://example.test/gallery", images=images)


def binary(fmt, animated):
    buffer = io.BytesIO()
    frames = [Image.new("RGB", (200, 200), color) for color in ("red", "blue")]
    options = {"save_all": True, "append_images": frames[1:], "duration": 100, "loop": 0} if animated else {}
    frames[0].save(buffer, format=fmt, **options)
    return buffer.getvalue()


@pytest.mark.parametrize("fmt,animated", [("GIF", True), ("GIF", False), ("WEBP", True), ("WEBP", False), ("PNG", True), ("PNG", False), ("JPEG", False)])
def test_binary_validation_keeps_actual_format_separate_from_animation(fmt, animated):
    data = binary(fmt, animated)
    uri = f"data:image/{fmt.lower()};base64,{base64.b64encode(data).decode()}"
    result = ImageValidator()._validate_data_uri(uri, 100, 100)
    assert result.is_valid
    assert result.format == fmt.lower()
    assert result.animation_checked is True
    assert result.is_animated is animated
    item = media(format=result.format, is_animated=result.is_animated, animation_checked=True)
    normalize_media_item(item)
    assert media_category(item) == ("gif" if animated else "photo")


@pytest.mark.parametrize("size,url", [(1500000, "https://cdn.test/photo.webp"), (5000, "https://cdn.test/animals/photo.webp")])
def test_webp_size_or_name_does_not_prove_animation(size, url):
    item = media(url, format="webp", file_size=size)
    normalize_media_item(item)
    assert item.media_type == "image" and not item.is_animated


def test_verified_static_binary_overrides_old_gif_flags():
    item = media(format="gif", media_type="gif", is_animated=True)
    with Image.open(io.BytesIO(binary("WEBP", False))) as image:
        apply_image_animation(item, image)
    assert item.format == "webp" and item.media_type == "image"
    assert item.animation_checked and not item.is_animated


def test_verified_image_bytes_override_misleading_video_url_and_old_stream():
    item = media("https://cdn.test/image.mp4", format="webp", animation_checked=True,
                 media_type="video", video_stream_url="https://cdn.test/image.mp4")
    normalize_media_item(item)
    assert item.media_type == "image" and item.video_stream_url is None
    assert media_category(item) == "photo"


@pytest.mark.parametrize("url,expected", [
    ("https://cdn.test/clip.gif?token=abc", "gif"),
    ("/api/proxy-image?url=https%3A%2F%2Fcdn.test%2Fclip.webp%3Ftoken%3Dabc&w=360", "webp"),
    ("https://cdn.test/clip.mp4?token=abc", "mp4"),
    ("https://cdn.test/image?format=webp", ""),
])
def test_real_suffix_is_query_and_proxy_aware(url, expected):
    assert media_source_format(url) == expected


def test_legacy_loop_keeps_video_transport_and_format():
    item = media("https://cdn.test/clip.mp4?token=x", media_type="gif", format="gif", is_animated=True)
    normalize_media_item(item)
    assert item.media_type == "video" and item.format == "mp4"
    assert item.video_stream_url == item.original_url
    assert media_category(item) == "gif"


def test_summary_and_generated_tags_clear_after_last_animation_removed():
    value = album([media("https://cdn.test/a.gif", media_type="gif")])
    normalize_media_item(value.images[0])
    update_album_media_metadata(value)
    assert value.metadata["gif_count"] == 1 and "gif" in value.tags
    value.images = [media("https://cdn.test/photo.jpg", format="jpeg")]
    update_album_media_metadata(value)
    assert value.metadata["has_gifs"] is False and value.metadata["gif_count"] == 0
    assert "gif" not in value.tags and "animado" not in value.tags
    value.images = []
    value.metadata.update(has_gifs=True, gif_count=5)
    update_album_media_metadata(value)
    assert not value.metadata["has_gifs"] and value.metadata["gif_count"] == 0


def test_summary_uses_items_instead_of_stale_metadata():
    value = album([media("https://cdn.test/a.gif", media_type="gif")])
    value.metadata.update(has_gifs=False, gif_count=0)
    assert AgentDebugger.get_ui_summary(value)["gif_count"] == 1


@pytest.mark.parametrize("media_filter,expected", [("all", 4), ("images", 1), ("gifs", 2), ("videos", 1)])
def test_final_extraction_filter_is_exclusive_and_keeps_loop_animation(media_filter, expected):
    value = album([
        media("https://cdn.test/photo.webp", format="webp", animation_checked=True),
        media("https://cdn.test/a.webp", format="webp", animation_checked=True, is_animated=True),
        media("https://cdn.test/loop.mp4", format="mp4", media_type="video", is_animated=True),
        media("https://cdn.test/full.mp4", format="mp4", media_type="video"),
    ])
    filter_album_media(value, media_filter)
    assert len(value.images) == expected
    if media_filter == "gifs":
        assert {image.format for image in value.images} == {"webp", "mp4"}


@pytest.mark.parametrize("animated", [False, True])
def test_scout_uses_webp_container_flags_even_in_short_header(animated):
    data = binary("WEBP", animated)
    facts = image_header_facts(data[:64])
    assert facts["format"] == "webp"
    assert facts["animation_checked"] is True
    assert facts["is_animated"] is animated


def test_partial_gif_probe_never_claims_one_frame_is_proven_static():
    data = binary("GIF", False)
    assert image_header_facts(data) == {}
    assert image_header_facts(data, complete=True)["is_animated"] is False


def test_sanitizer_recomputes_empty_albums_and_preserves_webp():
    namespace = dict(Album=Album, re=re, get_canonical_media_key=lambda url: url,
                     is_static_preview_upgradeable=lambda url: False,
                     normalize_media_item=normalize_media_item,
                     update_album_media_metadata=update_album_media_metadata)
    sanitize = load_unit("src/server/server.py", "sanitize_album_images", namespace)
    value = album([media(format="webp", file_size=1500000)])
    sanitize(value)
    assert not value.metadata["has_gifs"] and value.images[0].format == "webp"
    value.images = []
    value.tags = ["gif", "animado"]
    value.metadata.update(has_gifs=True, gif_count=3)
    sanitize(value)
    assert value.metadata["gif_count"] == 0 and value.tags == []


def test_gif_mode_keeps_unknown_webp_until_binary_validation():
    from src.core.models import DOMCandidateInfo
    import ast
    from tests.test_local_data_safety import ROOT
    tree = ast.parse((ROOT / "src/browser/tools.py").read_text(encoding="utf-8"))
    cls = next(node for node in tree.body if getattr(node, "name", None) == "BrowserTools")
    node = next(node for node in cls.body if getattr(node, "name", None) == "get_all_media_candidates")
    namespace = {"List": list, "DOMCandidateInfo": DOMCandidateInfo}
    exec(compile(ast.Module(body=[node], type_ignores=[]), "get_all_media_candidates", "exec"), namespace)
    async def images():
        return [DOMCandidateInfo(candidate_id="a", selector="img", src="https://cdn.test/clip.webp")]
    async def videos():
        return []
    candidates = run_sync_route(namespace["get_all_media_candidates"](SimpleNamespace(get_image_candidates=images, get_video_candidates=videos), "gifs"))
    assert len(candidates) == 1


def test_preview_upgrade_invalidates_binary_evidence_before_final_filter():
    namespace = dict(Album=Album, re=re, get_canonical_media_key=lambda url: url,
                     is_static_preview_upgradeable=lambda url: False,
                     normalize_media_item=normalize_media_item,
                     update_album_media_metadata=update_album_media_metadata)
    sanitize = load_unit("src/server/server.py", "sanitize_album_images", namespace)
    value = album([media("https://cdn.test/123-still_296x1000.gif", format="gif", animation_checked=True)])
    sanitize(value)
    assert value.images[0].original_url == "https://cdn.test/123-still.gif"
    assert value.images[0].animation_checked is False
    # Facts from the replacement file must survive another save-time sanitization.
    with Image.open(io.BytesIO(binary("GIF", False))) as image:
        apply_image_animation(value.images[0], image)
    filter_album_media(value, "images")
    sanitize(value)
    assert len(value.images) == 1 and media_category(value.images[0]) == "photo"
    assert value.images[0].animation_checked is True


def test_thumbnail_hint_does_not_replace_verified_full_original():
    namespace = dict(Album=Album, re=re, get_canonical_media_key=lambda url: url,
                     is_static_preview_upgradeable=lambda url: False,
                     normalize_media_item=normalize_media_item,
                     update_album_media_metadata=update_album_media_metadata)
    sanitize = load_unit("src/server/server.py", "sanitize_album_images", namespace)
    value = album([media("https://cdn.test/123-full.webp", format="webp", animation_checked=True)])
    value.images[0].thumbnail_url = "https://cdn.test/123-full_296x1000.gif"
    sanitize(value)
    assert value.images[0].format == "webp" and value.images[0].animation_checked
    assert media_category(value.images[0]) == "photo"


def test_explicit_local_album_sync_corrects_legacy_animation_flag(tmp_path):
    path = tmp_path / "album"
    path.mkdir()
    (path / "photo.webp").write_bytes(binary("WEBP", False))
    item = media("/api/proxy-image?url=local://albums/album/photo.webp", format="gif", is_animated=True, media_type="gif")
    assert run_sync_route(verify_media_animation(item, None, local_root=tmp_path))
    assert item.animation_checked and not item.is_animated and item.format == "webp"


def test_unavailable_media_does_not_invent_binary_facts(tmp_path):
    item = media("local://albums/missing.webp", format="webp", is_animated=True)
    assert run_sync_route(verify_media_animation(item, None, local_root=tmp_path)) is False
    assert item.is_animated and not item.animation_checked


def test_binary_http_validation_preserves_animated_webp(monkeypatch):
    data = binary("WEBP", True)
    class Response:
        status_code = 200
        headers = {"content-type": "image/webp", "content-length": str(len(data))}
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def aiter_bytes(self): yield data
    class Client:
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        def stream(self, *args, **kwargs): return Response()
    import src.validator.validator as validator_module
    monkeypatch.setattr(validator_module.httpx, "AsyncClient", lambda **kwargs: Client())
    result = run_sync_route(ImageValidator().validate_candidate_url("https://cdn.test/image", expected_min_width=100, expected_min_height=100))
    assert result.format == "webp" and result.is_animated and result.animation_checked
