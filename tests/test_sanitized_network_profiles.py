import pytest
import re
from src.core.network_profiles import (
    _b64d,
    get_canonical_performer_routes,
    get_preseeded_domain_cookies,
    get_preseeded_session_cookies,
    get_domain_specific_cookies,
    get_domain_specific_headers,
    resolve_anti_hotlink_headers,
    extract_canonical_target_page,
    get_cookie_domains_for_url,
    is_fast_track_supported,
    get_fast_track_endpoint,
    matches_embed_player_provider,
    get_embed_poster_url,
    get_embed_xhr_url,
    matches_direct_extractor_provider,
    is_tls_impersonation_required,
    matches_video_id_in_cdn,
    is_static_preview_upgradeable,
    matches_enrichment_provider,
    get_enrichment_api_url,
    get_video_host_indicators,
    suggest_smart_folder_name,
    _DEDICATED_PROVIDER_A,
    _DEDICATED_PROVIDER_B,
    _FAST_TRACK_GALLERY,
)
from src.server.server import _normalize_title_for_comparison
import src.server.resilient_downloader as resilient_downloader


def test_b64d_basic():
    assert _b64d("aGVsbG8=") == "hello"


def test_canonical_performer_routes():
    routes = get_canonical_performer_routes()
    assert len(routes) == 9
    assert any("{slug}" in r for r in routes)


def test_preseeded_cookies_decoding():
    cookies = get_preseeded_domain_cookies()
    assert len(cookies) > 0
    cookie_names = [c["name"] for c in cookies]
    assert "cookie_consent" in cookie_names
    assert "age_verified" in cookie_names
    assert "over18" in cookie_names


def test_preseeded_session_cookies():
    session_cookies = get_preseeded_session_cookies()
    assert "cookie_consent" in session_cookies
    assert "age_verified" in session_cookies
    assert "over18" in session_cookies
    assert session_cookies["over18"] == "1"


def test_domain_specific_cookies():
    host_b = _b64d(_DEDICATED_PROVIDER_B["host_match"])
    b_cookies = get_domain_specific_cookies(host_b)
    assert isinstance(b_cookies, list)

    host_a = _b64d(_DEDICATED_PROVIDER_A["host_match"])
    a_cookies = get_domain_specific_cookies(host_a)
    assert isinstance(a_cookies, list)


def test_domain_specific_headers():
    host_b = _b64d(_DEDICATED_PROVIDER_B["host_match"])
    hdrs = get_domain_specific_headers(f"https://{host_b}/media-123", host_b)
    assert "Cookie" in hdrs
    assert "age_verified=1" in hdrs["Cookie"]


def test_anti_hotlink_cdn_mapping():
    # Universal anti-hotlink resolution: synthesizes same-origin apex domain navigation
    cdn_url = "https://cdn.example.org/videos/202005/17/408432121/720P_4000K_408432121.mp4"
    h = resolve_anti_hotlink_headers(cdn_url)
    assert "example.org" in h["Referer"]
    assert "example.org" in h["Origin"]
    assert h.get("Sec-Fetch-Site") == "same-origin"


def test_anti_hotlink_source_page_fallback():
    cdn_url = "https://cdn.example.org/images/photo_01.jpg"
    src_page = "https://example.org/galleries/album-123"
    h = resolve_anti_hotlink_headers(cdn_url, referer=None, source_page=src_page)
    assert h["Referer"] == src_page
    assert h["Origin"] == "https://example.org"


def test_anti_hotlink_url_dynamic_derivation():
    generic_url = "https://media.mysite.com/video/stream.mp4"
    h = resolve_anti_hotlink_headers(generic_url)
    assert h["Referer"] in ("https://media.mysite.com/", "https://mysite.com/")


def test_extract_canonical_target_page():
    host_a = _b64d(_DEDICATED_PROVIDER_A["host_match"])
    u_a = f"https://{host_a}/view?v=vid12345"
    canon_a = extract_canonical_target_page(u_a)
    assert canon_a == f"https://{host_a}/view?v=vid12345"

    host_b = _b64d(_DEDICATED_PROVIDER_B["host_match"])
    u_b = f"https://{host_b}/video-abc12345/"
    canon_b = extract_canonical_target_page(u_b)
    assert canon_b == f"https://{host_b}/video-abc12345/"


def test_fast_track_support():
    host_c = _b64d(_FAST_TRACK_GALLERY["host_match"])
    assert is_fast_track_supported(host_c, f"https://{host_c}/galleries/12345/")
    assert not is_fast_track_supported("example.com", "https://example.com/galleries/12345/")
    endpoint = get_fast_track_endpoint()
    assert endpoint.startswith("https://")
    assert "related_json.php" in endpoint


def test_embed_player_sniffer():
    host_b = _b64d(_DEDICATED_PROVIDER_B["host_match"])
    u_b = f"https://{host_b}/video-klItEjoRqxj"
    matched, vid_id, embed_url = matches_embed_player_provider(u_b)
    assert matched is True
    assert vid_id == "klItEjoRqxj"
    assert embed_url == f"https://{host_b}/embed/klItEjoRqxj/"

    poster = get_embed_poster_url("12345")
    assert "12345" in poster


def test_direct_extractor_provider():
    host_a = _b64d(_DEDICATED_PROVIDER_A["host_match"])
    u_a = f"https://{host_a}/view?v=abc12345"
    matched, vid_id, target = matches_direct_extractor_provider(u_a)
    assert matched is True
    assert vid_id == "abc12345"
    assert "v=abc12345" in target


def test_tls_impersonation_required():
    host_a = _b64d(_DEDICATED_PROVIDER_A["host_match"])
    cdn_u = f"https://{host_a}/videos/123.mp4"
    assert is_tls_impersonation_required(cdn_u)
    assert not is_tls_impersonation_required("https://example.com/video.mp4")


def test_matches_video_id_in_cdn():
    stream_u = "https://cdn.example.org/videos/202005/17/408254721/720P_4000K_408254721.mp4"
    assert matches_video_id_in_cdn(stream_u) == "408254721"
    assert matches_video_id_in_cdn("https://example.com/video.mp4") is None


def test_suggest_smart_folder_name():
    url = "https://example.com/artist/abigail-morris-sample"
    folder = suggest_smart_folder_name(url, "Abigail Morris Videos")
    assert folder == "Abigail Morris"

    url2 = "https://example.com/actor/john-doe-1234"
    folder2 = suggest_smart_folder_name(url2)
    assert folder2 == "John Doe"

    folder3 = suggest_smart_folder_name("", "Summer Vacation Videos HD")
    assert folder3 == "Summer Vacation"


def test_normalize_title_for_comparison():
    t1 = "Awesome Movie - MyTube.com"
    norm1 = _normalize_title_for_comparison(t1)
    assert norm1 == "awesomemovie"

    t2 = "Matrix - Reloaded"
    norm2 = _normalize_title_for_comparison(t2)
    assert norm2 == "matrixreloaded"

    t3 = "Concert Live - Tokyo"
    norm3 = _normalize_title_for_comparison(t3)
    assert norm3 == "concertlivetokyo"


def test_resilient_downloader_import():
    assert hasattr(resilient_downloader, "download_video_resilient")
    assert hasattr(resilient_downloader, "logger")
