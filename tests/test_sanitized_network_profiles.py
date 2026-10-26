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


def test_dynamic_origin_preservation_for_any_domain():
    # Ensures real domains are preserved dynamically instead of being replaced with .example
    custom_url = "https://www.media-portal-host.org/video-AbCdEf12345/sample-clip"
    canon = extract_canonical_target_page(custom_url)
    assert canon == custom_url
    assert ".example" not in canon

    matched, vid_id, embed_url = matches_embed_player_provider(custom_url)
    assert matched is True
    assert vid_id == "AbCdEf12345"
    assert embed_url == "https://www.media-portal-host.org/embed/AbCdEf12345/"

    xhr = get_embed_xhr_url("AbCdEf12345", "hash999", custom_url)
    assert xhr.startswith("https://www.media-portal-host.org/xhr/video/AbCdEf12345")

    viewkey_url = "https://stream-hub-site.net/view_video.php?viewkey=vk987654321"
    canon_vk = extract_canonical_target_page(viewkey_url)
    assert canon_vk == viewkey_url
    assert ".example" not in canon_vk

    matched_d, vid_d, target_d = matches_direct_extractor_provider(viewkey_url)
    assert matched_d is True
    assert vid_d == "vk987654321"
    assert target_d == viewkey_url


@pytest.mark.asyncio
async def test_relaunch_job_in_place_sanitizes_and_queues(monkeypatch, tmp_path):
    from src.server import server

    fake_jid = "save_vid_test_999"
    fake_target = str(tmp_path / "Save Video Save Video Sample Clip.mp4")

    monkeypatch.setitem(
        server._active_jobs,
        fake_jid,
        {
            "session_id": fake_jid,
            "url": "https://www.media-portal-host.org/video-AbCdEf12345/sample-clip",
            "mode": "video_save",
            "engine_type": "video_downloader",
            "status": "error",
            "error": "Previous error",
            "folder": "TestFolder",
            "target_path": fake_target,
            "progress": {
                "current": 0,
                "total": 100,
                "percent": 0,
                "title": "Save Video: Save Video: Sample Clip",
                "status": "Erro anterior",
            },
        },
    )

    called_args = {}

    async def fake_resolve(vid_id, page_url):
        called_args["resolved_from"] = (vid_id, page_url)
        return "https://cdn.media-portal-host.org/streams/1080p.mp4"

    async def fake_download(**kwargs):
        called_args["download_kwargs"] = kwargs

    monkeypatch.setattr(server, "_resolve_best_video_stream", fake_resolve)
    monkeypatch.setattr(server, "_run_video_download_task", fake_download)
    monkeypatch.setattr(server, "_save_jobs_to_disk", lambda *a, **kw: None)

    ok = await server._relaunch_job_in_place(fake_jid)
    assert ok is True
    job = server._active_jobs[fake_jid]
    assert job["status"] == "running"
    assert "error" not in job
    assert job["progress"]["title"] == "Save Video: Sample Clip"
    assert "Save Video" not in job["target_path"]

    ctrl = server._job_controllers.get(fake_jid)
    assert ctrl is not None
    await ctrl.task

    assert called_args["resolved_from"] == (
        "AbCdEf12345",
        "https://www.media-portal-host.org/video-AbCdEf12345/sample-clip",
    )
    assert called_args["download_kwargs"]["vurl"] == "https://cdn.media-portal-host.org/streams/1080p.mp4"
    assert called_args["download_kwargs"]["clean_title"] == "Sample Clip"

    server._active_jobs.pop(fake_jid, None)
    server._job_controllers.pop(fake_jid, None)


@pytest.mark.asyncio
async def test_relaunch_job_resets_stale_99_when_file_missing(monkeypatch, tmp_path):
    from src.server import server

    fake_jid = "save_vid_stale_99"
    missing_target = str(tmp_path / "Missing_File_After_Error.mp4")

    monkeypatch.setitem(
        server._active_jobs,
        fake_jid,
        {
            "session_id": fake_jid,
            "url": "https://www.media-portal-host.org/video-XyZ987654/sample-clip-2",
            "mode": "video_save",
            "engine_type": "video_downloader",
            "status": "error",
            "error": "cannot access local variable 'downloaded_heatmap'",
            "started_at": "2026-10-23 00:00:00 UTC",
            "downloaded_bytes": 633119990,
            "total_bytes": 633119990,
            "folder": "TestFolder",
            "target_path": missing_target,
            "progress": {
                "current": 633119990,
                "total": 633119990,
                "percent": 99,
                "downloaded_bytes": 633119990,
                "total_bytes": 633119990,
                "title": "Save Video: Sample Clip 2",
                "status": "Erro: cannot access local variable 'downloaded_heatmap'",
            },
        },
    )

    async def fake_resolve(vid_id, page_url):
        return "https://cdn.media-portal-host.org/streams/1080p_2.mp4"

    async def fake_download(**kwargs):
        pass

    monkeypatch.setattr(server, "_resolve_best_video_stream", fake_resolve)
    monkeypatch.setattr(server, "_run_video_download_task", fake_download)
    monkeypatch.setattr(server, "_save_jobs_to_disk", lambda *a, **kw: None)

    ok = await server._relaunch_job_in_place(fake_jid, priority=True)
    assert ok is True
    job = server._active_jobs[fake_jid]
    assert job["downloaded_bytes"] == 0
    assert job["total_bytes"] == 0
    assert job["progress"]["percent"] == 0
    assert job["progress"]["downloaded_bytes"] == 0
    assert job["started_at"] != "2026-10-23 00:00:00 UTC"

    ctrl = server._job_controllers.get(fake_jid)
    if ctrl:
        await ctrl.task

    server._active_jobs.pop(fake_jid, None)
    server._job_controllers.pop(fake_jid, None)




