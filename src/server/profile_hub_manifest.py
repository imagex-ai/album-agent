"""Comprehensive and robust structural parsing for Profile Hub profiles and performers.

Uses native Selectolax/Lexbor extraction and supports pre-extracted worker pool
batches as well as direct HTML strings, Lexbor trees, and BeautifulSoup trees.
"""
from datetime import datetime, timezone
from urllib.parse import urljoin, urlsplit, urlunsplit
from bs4 import BeautifulSoup
from selectolax.lexbor import LexborHTMLParser

if __package__:
    from .profile_hub_workers import (
        extract_eporner_albums_lexbor,
        extract_eporner_playlists_lexbor,
        extract_eporner_root_lexbor,
        extract_eporner_videos_lexbor,
        extract_generic_profile_lexbor,
        extract_pornhub_albums_lexbor,
        extract_pornhub_gifs_lexbor,
        extract_pornhub_playlists_lexbor,
        extract_pornhub_root_lexbor,
        extract_pornhub_videos_lexbor,
        extract_youtube_albums_lexbor,
        extract_youtube_playlists_lexbor,
        extract_youtube_root_lexbor,
        extract_youtube_videos_lexbor,
        extract_xhamster_albums_lexbor,
        extract_xhamster_max_video_page,
        extract_xhamster_root_lexbor,
        extract_xhamster_shorts_lexbor,
        extract_xhamster_videos_lexbor,
        get_worker_pool,
        http_url as _http_url,
        image_url as _lexbor_image_url,
        is_pornhub_host,
        is_pornhub_profile_url,
        is_xhamster_host,
        is_xhamster_profile_url,
        is_youtube_channel_url,
        is_youtube_host,
        normalize_pornhub_profile_base_url,
        normalize_xhamster_profile_base_url,
        worker_execute,
    )
else:
    from src.server.profile_hub_workers import (
        extract_eporner_albums_lexbor,
        extract_eporner_playlists_lexbor,
        extract_eporner_root_lexbor,
        extract_eporner_videos_lexbor,
        extract_generic_profile_lexbor,
        extract_pornhub_albums_lexbor,
        extract_pornhub_gifs_lexbor,
        extract_pornhub_playlists_lexbor,
        extract_pornhub_root_lexbor,
        extract_pornhub_videos_lexbor,
        extract_youtube_albums_lexbor,
        extract_youtube_playlists_lexbor,
        extract_youtube_root_lexbor,
        extract_youtube_videos_lexbor,
        extract_xhamster_albums_lexbor,
        extract_xhamster_max_video_page,
        extract_xhamster_root_lexbor,
        extract_xhamster_shorts_lexbor,
        extract_xhamster_videos_lexbor,
        get_worker_pool,
        http_url as _http_url,
        image_url as _lexbor_image_url,
        is_pornhub_host,
        is_pornhub_profile_url,
        is_xhamster_host,
        is_xhamster_profile_url,
        is_youtube_channel_url,
        is_youtube_host,
        normalize_pornhub_profile_base_url,
        normalize_xhamster_profile_base_url,
        worker_execute,
    )


def _section(items):
    return {"status": "partial", "items": items, "loaded_count": len(items)}


def _image_url(base, img):
    """Prefer lazy-loaded source URLs and preserve the exact CDN filename."""
    attrs = img.attributes if hasattr(img, "attributes") else img
    return _lexbor_image_url(base, attrs)


def _to_lexbor_or_str(node):
    if isinstance(node, (str, LexborHTMLParser, dict, tuple)):
        return node
    if isinstance(node, BeautifulSoup):
        return LexborHTMLParser(str(node))
    return str(node)


def assemble_eporner_profile(
    source_url: str,
    root_info: dict,
    video_batches: list,
    albums_pair: tuple,
    playlist_batches: list,
    first_playlist_videos=None,
    gifs_pair=None,
    search_gifs_pair=None,
) -> dict:
    """Merge extracted worker DTO batches, deduplicate in order, and compute profile manifest."""
    canonical_videos = []
    raw_video_items = []
    seen_video_urls = set()

    for v_can, v_raw in [root_info["videos"]] + (video_batches or []):
        for card, raw in zip(v_can, v_raw):
            v_url = card["originalUrl"]
            if v_url in seen_video_urls:
                continue
            seen_video_urls.add(v_url)
            if not card["id"]:
                card = {**card, "id": f"v-vid_{len(canonical_videos)+1}"}
            else:
                card = dict(card)
            canonical_videos.append(card)
            raw_video_items.append(dict(raw))

    canonical_albums = []
    raw_album_items = []
    seen_album_urls = set()

    if albums_pair:
        for card, raw in zip(albums_pair[0], albums_pair[1]):
            alb_url = card["url"]
            if alb_url in seen_album_urls:
                continue
            seen_album_urls.add(alb_url)
            if not card["id"]:
                card = {**card, "id": f"alb-alb_{len(canonical_albums)+1}"}
            else:
                card = dict(card)
            canonical_albums.append(card)
            raw_album_items.append({
                **raw,
                "provenance": {"page_url": source_url, "evidence": "performer photos", "ownership": "unverified"},
            })

    canonical_playlists = []
    raw_playlist_items = []
    seen_pl_urls = set()
    avatar = root_info.get("avatar")

    for p_can, p_raw in playlist_batches or []:
        for card, raw in zip(p_can, p_raw):
            pl_url = card["url"]
            if pl_url in seen_pl_urls:
                continue
            seen_pl_urls.add(pl_url)
            card = dict(card)
            raw = dict(raw)
            if not card["id"]:
                card["id"] = f"pl-pl_{len(canonical_playlists)+1}"
            if not card.get("thumbnailUrl") and avatar:
                card["thumbnailUrl"] = avatar
                raw["cover_url"] = avatar
            raw["provenance"] = {"page_url": source_url, "evidence": "search-playlists", "ownership": "unverified"}
            canonical_playlists.append(card)
            raw_playlist_items.append(raw)

    canonical_gifs = []
    raw_gif_items = []
    seen_gif_urls = set()

    if gifs_pair and isinstance(gifs_pair, tuple) and len(gifs_pair) == 2:
        for card, raw in zip(gifs_pair[0], gifs_pair[1]):
            g_url = card.get("url") or card.get("originalUrl")
            if not g_url or g_url in seen_gif_urls:
                continue
            seen_gif_urls.add(g_url)
            canonical_gifs.append(dict(card))
            raw_gif_items.append(dict(raw))

    canonical_search_gifs = []
    raw_search_gif_items = []
    seen_search_gif_urls = set()
    search_gifs_total_reported = None

    if search_gifs_pair and isinstance(search_gifs_pair, tuple) and len(search_gifs_pair) >= 2:
        for card, raw in zip(search_gifs_pair[0], search_gifs_pair[1]):
            g_url = card.get("url") or card.get("originalUrl")
            if not g_url or g_url in seen_search_gif_urls or g_url in seen_gif_urls:
                continue
            seen_search_gif_urls.add(g_url)
            canonical_search_gifs.append(dict(card))
            raw_search_gif_items.append(dict(raw))
        if len(search_gifs_pair) >= 3 and isinstance(search_gifs_pair[2], int):
            search_gifs_total_reported = search_gifs_pair[2]

    if canonical_gifs and not any(a.get("id") == "alb-gifs" for a in canonical_albums):
        is_xh = is_xhamster_host(source_url)
        base_gif_url = (
            f"{normalize_xhamster_profile_base_url(source_url)}/shorts"
            if is_xh
            else (
                f"{normalize_pornhub_profile_base_url(source_url)}/gifs"
                if is_pornhub_host(source_url)
                else f"{source_url.rstrip('/')}/gifs"
            )
        )
        gif_thumb = (
            next((g.get("thumbnailUrl") for g in canonical_gifs if g.get("thumbnailUrl")), "")
            or (root_info.get("avatar") or "")
        )
        p_name = root_info.get("name") or "Perfil"
        prefix = "Shorts / Moments" if is_xh else "GIFs"
        album_title = f"{prefix} — Perfil Oficial ({p_name})" if canonical_search_gifs else f"{prefix} — {p_name}"
        latest_date = (
            canonical_videos[0].get("uploadedAt")
            if (canonical_videos and canonical_videos[0].get("uploadedAt"))
            else datetime.now(timezone.utc).strftime("%Y-%m-%d")
        )
        gif_album_card = {
            "id": "alb-gifs",
            "title": album_title,
            "photoCount": len(canonical_gifs),
            "loadedCount": len(canonical_gifs),
            "paginationComplete": True,
            "isComplete": True,
            "updatedAt": latest_date,
            "thumbnailUrl": gif_thumb,
            "category": "Shorts" if is_xh else "GIFs",
            "url": base_gif_url,
            "metadataStatus": "fetched",
        }
        canonical_albums.append(gif_album_card)
        raw_album_items.append({
            "key": base_gif_url,
            "source_url": base_gif_url,
            "title": gif_album_card["title"],
            "cover_url": gif_thumb,
            "provenance": {"page_url": source_url, "evidence": "performer shorts" if is_xh else "performer gifs", "ownership": "unverified"},
        })

    if canonical_search_gifs and not any(a.get("id") == "alb-gifs-search" for a in canonical_albums):
        from urllib.parse import quote_plus
        p_name = root_info.get("name") or "Comunidade"
        search_gif_url = f"https://www.pornhub.com/gifs/search?search={quote_plus(p_name.strip().lower())}"
        search_thumb = (
            next((g.get("thumbnailUrl") for g in canonical_search_gifs if g.get("thumbnailUrl")), "")
            or (root_info.get("avatar") or "")
        )
        total_ph = search_gifs_total_reported or len(canonical_search_gifs)
        search_album_card = {
            "id": "alb-gifs-search",
            "title": f"GIFs — Busca Global ({p_name})",
            "photoCount": total_ph,
            "loadedCount": len(canonical_search_gifs),
            "paginationComplete": False,
            "isComplete": False,
            "updatedAt": "",
            "thumbnailUrl": search_thumb,
            "category": "GIFs",
            "url": search_gif_url,
            "metadataStatus": "fetched",
        }
        canonical_albums.append(search_album_card)
        raw_album_items.append({
            "key": search_gif_url,
            "source_url": search_gif_url,
            "title": search_album_card["title"],
            "cover_url": search_thumb,
            "provenance": {"page_url": source_url, "evidence": "global search gifs", "ownership": "unverified"},
        })

    playlist_videos_map = {}
    if canonical_playlists and first_playlist_videos is not None:
        first_pl = canonical_playlists[0]
        playlist_videos_map[first_pl["id"]] = first_playlist_videos

    canonical_highlights = []
    raw_highlights = []

    if canonical_videos:
        sub1 = " • ".join([x for x in (canonical_videos[0].get('duration'), canonical_videos[0].get('resolution'), canonical_videos[0].get('views')) if x])
        canonical_highlights.append({
            "id": "hl-v1",
            "title": canonical_videos[0]["title"],
            "subtitle": sub1 or canonical_videos[0].get('duration', ''),
            "tag": "video",
            "countLabel": canonical_videos[0]["duration"],
            "thumbnailUrl": canonical_videos[0]["thumbnailUrl"],
            "type": "video",
            "duration": canonical_videos[0]["duration"],
            "isHero": True,
        })
        raw_highlights.append({
            "kind": "video",
            "media_key": canonical_videos[0]["originalUrl"],
            "source_url": canonical_videos[0]["originalUrl"],
            "title": canonical_videos[0]["title"],
            "cover_url": canonical_videos[0]["thumbnailUrl"],
            "evidence": "top performer video",
        })

    if len(canonical_videos) > 1:
        sub2 = " • ".join([x for x in (canonical_videos[1].get('duration'), canonical_videos[1].get('resolution'), canonical_videos[1].get('views')) if x])
        canonical_highlights.append({
            "id": "hl-v2",
            "title": canonical_videos[1]["title"],
            "subtitle": sub2 or canonical_videos[1].get('duration', ''),
            "tag": "video",
            "countLabel": canonical_videos[1]["duration"],
            "thumbnailUrl": canonical_videos[1]["thumbnailUrl"],
            "type": "video",
            "duration": canonical_videos[1]["duration"],
        })
        raw_highlights.append({
            "kind": "video",
            "media_key": canonical_videos[1]["originalUrl"],
            "source_url": canonical_videos[1]["originalUrl"],
            "title": canonical_videos[1]["title"],
            "cover_url": canonical_videos[1]["thumbnailUrl"],
            "evidence": "popular performer video",
        })

    if canonical_albums:
        canonical_highlights.append({
            "id": "hl-a1",
            "title": canonical_albums[0]["title"],
            "subtitle": str(canonical_albums[0]["photoCount"]) if canonical_albums[0]["photoCount"] is not None else "",
            "tag": "album",
            "countLabel": str(canonical_albums[0]["photoCount"]) if canonical_albums[0]["photoCount"] is not None else "",
            "thumbnailUrl": canonical_albums[0]["thumbnailUrl"],
            "type": "album",
        })
        raw_highlights.append({
            "kind": "album",
            "collection_key": canonical_albums[0]["url"],
            "evidence": "featured performer album",
        })

    if len(canonical_albums) > 1:
        canonical_highlights.append({
            "id": "hl-a2",
            "title": canonical_albums[1]["title"],
            "subtitle": str(canonical_albums[1]["photoCount"]) if canonical_albums[1]["photoCount"] is not None else "",
            "tag": "album",
            "countLabel": str(canonical_albums[1]["photoCount"]) if canonical_albums[1]["photoCount"] is not None else "",
            "thumbnailUrl": canonical_albums[1]["thumbnailUrl"],
            "type": "album",
        })
        raw_highlights.append({
            "kind": "album",
            "collection_key": canonical_albums[1]["url"],
            "evidence": "featured performer album",
        })

    name = root_info["name"]
    tagline = root_info["tagline"]
    total_videos_reported = root_info.get("total_videos_reported")
    total_photos_reported = root_info.get("total_photos_reported")
    total_gifs_reported = root_info.get("total_gifs_reported")
    cover_backdrop = (
        root_info.get("banner")
        or (canonical_albums[0]["thumbnailUrl"] if canonical_albums else None)
        or (canonical_videos[0]["thumbnailUrl"] if canonical_videos else avatar)
        or ""
    )

    stats = {
        "videos": max(total_videos_reported or 0, len(canonical_videos)),
        "playlists": len(canonical_playlists),
        "albums": max(total_photos_reported or 0, len(canonical_albums)),
    }
    for stat_key in ("subscribers", "followers", "likes", "posts", "views"):
        stat_val = root_info.get(stat_key)
        if stat_val is not None and (not isinstance(stat_val, str) or stat_val.strip()):
            stats[stat_key] = stat_val.strip() if isinstance(stat_val, str) else stat_val
    if total_gifs_reported is not None or canonical_gifs:
        stats["gifs"] = max(total_gifs_reported or 0, len(canonical_gifs))

    profile_hero_data = {
        "id": source_url,
        "name": name,
        "handle": root_info.get("handle") or f"@{name.lower().replace(' ', '')}",
        "tagline": tagline,
        "avatarUrl": avatar or "",
        "coverUrl": cover_backdrop,
        "verified": bool(root_info.get("verified", False)),
        "following": False,
        "stats": stats,
        "destinationFolder": f"{name} (ImageX)",
        "availableFolders": [],
        "bio_details": root_info["structured_bio"],
        "social_links": root_info["social_links"],
    }

    return {
        "profile_key": source_url,
        "source_url": source_url,
        "name": name,
        "description": tagline,
        "cover_url": avatar,
        "profile_data": profile_hero_data,
        "canonical_highlights": canonical_highlights,
        "canonical_playlists": canonical_playlists,
        "canonical_albums": canonical_albums,
        "canonical_videos": canonical_videos,
        "canonical_gifs": canonical_gifs,
        "canonical_search_gifs": canonical_search_gifs,
        "playlist_videos_map": playlist_videos_map,
        "playlists": _section(raw_playlist_items),
        "albums": _section(raw_album_items),
        "highlights": _section(raw_highlights),
        "videos": _section(raw_video_items),
        "gifs": _section(raw_gif_items),
        "search_gifs": _section(raw_search_gif_items),
    }


def parse_profile_page(
    source_url,
    html,
    extra_video_soups=None,
    photos_html=None,
    playlists_html=None,
    first_playlist_videos=None,
    gifs_html=None,
    search_gifs_html=None,
):
    """Parses profile root page with platform-specific auto-detection."""
    if isinstance(html, dict) and "videos" in html and "structured_bio" in html:
        root_info = html
        is_youtube = root_info.get("platform") == "youtube"
        is_pornhub = root_info.get("platform") == "pornhub"
        is_xhamster = root_info.get("platform") == "xhamster"
        is_eporner = not is_youtube and not is_pornhub and not is_xhamster
        root_tree = None
    else:
        converted = _to_lexbor_or_str(html)
        root_tree = converted if isinstance(converted, LexborHTMLParser) else LexborHTMLParser(converted)
        netloc = urlsplit(source_url).netloc.lower()
        is_youtube = is_youtube_channel_url(source_url) or (
            is_youtube_host(source_url) and "ytInitialData" in (html if isinstance(html, str) else "")
        )
        is_pornhub = not is_youtube and (
            is_pornhub_profile_url(source_url)
            or is_pornhub_host(source_url)
            or (root_tree.css_first("li.videoBox, .pornstarName, #getAvatar") is not None)
        )
        is_xhamster = not is_youtube and not is_pornhub and (
            is_xhamster_profile_url(source_url)
            or is_xhamster_host(source_url)
            or (root_tree.css_first(".landing-info, .channel-header, .video-thumb, [data-video-id]") is not None and "xhamster" in (html if isinstance(html, str) else ""))
        )
        is_eporner = not is_youtube and not is_pornhub and not is_xhamster and (
            "eporner" in netloc
            or root_tree.css_first("div[class*=psbio]") is not None
            or root_tree.css_first("div.pornstar-video-results-layout") is not None
        )
        root_info = None

    if is_youtube:
        if root_info is None:
            root_info = extract_youtube_root_lexbor(source_url, html if isinstance(html, str) else root_tree)

        video_batches = []
        for item in extra_video_soups or []:
            if isinstance(item, tuple) and len(item) == 2:
                video_batches.append(item)
            else:
                video_batches.append(extract_youtube_videos_lexbor(source_url, _to_lexbor_or_str(item)))

        if photos_html is not None:
            if isinstance(photos_html, tuple) and len(photos_html) == 2:
                albums_pair = photos_html
            else:
                albums_pair = extract_youtube_albums_lexbor(source_url, _to_lexbor_or_str(photos_html))
        else:
            albums_pair = extract_youtube_albums_lexbor(source_url, html if isinstance(html, str) else root_tree)

        playlist_batches = []
        pl_items = playlists_html if isinstance(playlists_html, list) else ([playlists_html] if playlists_html else [])
        avatar = root_info.get("avatar") or ""
        for ph in pl_items:
            if not ph:
                continue
            if isinstance(ph, tuple) and len(ph) >= 2:
                playlist_batches.append((ph[0], ph[1]))
            else:
                c_pl, r_pl, _ = extract_youtube_playlists_lexbor(
                    source_url, root_info.get("name", ""), _to_lexbor_or_str(ph), avatar
                )
                playlist_batches.append((c_pl, r_pl))

        return assemble_eporner_profile(
            source_url,
            root_info,
            video_batches,
            albums_pair,
            playlist_batches,
            first_playlist_videos=first_playlist_videos,
        )

    if is_pornhub:
        if root_info is None:
            root_info = extract_pornhub_root_lexbor(source_url, html if isinstance(html, str) else root_tree)

        video_batches = []
        for item in extra_video_soups or []:
            if isinstance(item, tuple) and len(item) == 2:
                video_batches.append(item)
            else:
                video_batches.append(extract_pornhub_videos_lexbor(source_url, _to_lexbor_or_str(item)))

        if photos_html is not None:
            if isinstance(photos_html, tuple) and len(photos_html) == 2:
                albums_pair = photos_html
            else:
                albums_pair = extract_pornhub_albums_lexbor(source_url, _to_lexbor_or_str(photos_html))
        else:
            albums_pair = ([], [])

        playlist_batches = []
        pl_items = playlists_html if isinstance(playlists_html, list) else ([playlists_html] if playlists_html else [])
        avatar = root_info.get("avatar") or ""
        for ph in pl_items:
            if not ph:
                continue
            if isinstance(ph, tuple) and len(ph) >= 2:
                playlist_batches.append((ph[0], ph[1]))
            else:
                c_pl, r_pl = extract_pornhub_playlists_lexbor(source_url, _to_lexbor_or_str(ph), avatar)
                playlist_batches.append((c_pl, r_pl))

        gifs_pair = None
        if gifs_html is not None:
            if isinstance(gifs_html, tuple) and len(gifs_html) >= 2:
                gifs_pair = gifs_html
            else:
                gifs_pair = extract_pornhub_gifs_lexbor(source_url, _to_lexbor_or_str(gifs_html))

        search_gifs_pair = None
        if search_gifs_html is not None:
            if isinstance(search_gifs_html, tuple) and len(search_gifs_html) >= 2:
                search_gifs_pair = search_gifs_html
            else:
                search_gifs_pair = extract_pornhub_gifs_lexbor(source_url, _to_lexbor_or_str(search_gifs_html))

        return assemble_eporner_profile(
            source_url,
            root_info,
            video_batches,
            albums_pair,
            playlist_batches,
            first_playlist_videos=first_playlist_videos,
            gifs_pair=gifs_pair,
            search_gifs_pair=search_gifs_pair,
        )

    if is_xhamster:
        if root_info is None:
            root_info = extract_xhamster_root_lexbor(source_url, html if isinstance(html, str) else root_tree)

        video_batches = []
        for item in extra_video_soups or []:
            if isinstance(item, tuple) and len(item) == 2:
                video_batches.append(item)
            else:
                video_batches.append(extract_xhamster_videos_lexbor(source_url, _to_lexbor_or_str(item)))

        if photos_html is not None:
            if isinstance(photos_html, tuple) and len(photos_html) == 2:
                albums_pair = photos_html
            else:
                albums_pair = extract_xhamster_albums_lexbor(source_url, _to_lexbor_or_str(photos_html))
        else:
            albums_pair = root_info.get("albums") or ([], [])

        playlist_batches = []
        pl_items = playlists_html if isinstance(playlists_html, list) else ([playlists_html] if playlists_html else [])
        for ph in pl_items:
            if not ph:
                continue
            if isinstance(ph, tuple) and len(ph) >= 2:
                playlist_batches.append((ph[0], ph[1]))
            elif isinstance(ph, list):
                playlist_batches.append((ph, []))

        gifs_pair = None
        if gifs_html is not None:
            if isinstance(gifs_html, tuple) and len(gifs_html) == 2:
                gifs_pair = gifs_html
            elif isinstance(gifs_html, list):
                gifs_pair = (gifs_html, [])
            else:
                shorts_res = extract_xhamster_shorts_lexbor(source_url, _to_lexbor_or_str(gifs_html))
                if isinstance(shorts_res, tuple) and len(shorts_res) == 2:
                    gifs_pair = shorts_res
                else:
                    gifs_pair = (shorts_res, [])

        return assemble_eporner_profile(
            source_url,
            root_info,
            video_batches,
            albums_pair,
            playlist_batches,
            first_playlist_videos=first_playlist_videos,
            gifs_pair=gifs_pair,
        )

    if is_eporner:
        if root_info is None:
            root_info = extract_eporner_root_lexbor(source_url, root_tree)

        video_batches = []
        for item in extra_video_soups or []:
            if isinstance(item, tuple) and len(item) == 2:
                video_batches.append(item)
            else:
                video_batches.append(extract_eporner_videos_lexbor(source_url, _to_lexbor_or_str(item)))

        if photos_html is not None:
            if isinstance(photos_html, tuple) and len(photos_html) == 2:
                albums_pair = photos_html
            else:
                albums_pair = extract_eporner_albums_lexbor(source_url, _to_lexbor_or_str(photos_html))
        else:
            albums_pair = extract_eporner_albums_lexbor(source_url, root_tree) if root_tree is not None else ([], [])

        playlist_batches = []
        pl_items = playlists_html if isinstance(playlists_html, list) else ([playlists_html] if playlists_html else [])
        avatar = root_info.get("avatar") or ""
        for ph in pl_items:
            if not ph:
                continue
            if isinstance(ph, tuple) and len(ph) >= 2:
                playlist_batches.append((ph[0], ph[1]))
            else:
                c_pl, r_pl, _ = extract_eporner_playlists_lexbor(source_url, "", _to_lexbor_or_str(ph), avatar)
                playlist_batches.append((c_pl, r_pl))

        return assemble_eporner_profile(
            source_url,
            root_info,
            video_batches,
            albums_pair,
            playlist_batches,
            first_playlist_videos=first_playlist_videos,
        )

    return extract_generic_profile_lexbor(source_url, root_tree)
