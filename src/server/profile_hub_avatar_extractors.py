"""Canonical image/CSS/structured HTML avatar extractors & anti-logo guards.

Single source of truth for turning HTML nodes, srcset, inline CSS background-image,
JSON-LD, embedded JS state, and OpenGraph tags into validated HTTPS avatar URLs,
while blocking sitewide brand logos, placeholders, video thumbnails, and unsafe URLs.
"""
from __future__ import annotations

import json
import re
from typing import Any
from urllib.parse import urljoin, urlsplit, urlunsplit

from selectolax.lexbor import LexborHTMLParser

from .profile_hub_execution import https_url

_BG_URL_RE = re.compile(r"""url\(\s*(?P<quote>['"]?)(?P<url>[^'")]+)(?P=quote)\s*\)""", re.IGNORECASE)
_IMAGE_ATTR_PRIORITY = (
    "data-src",
    "data-lazy-src",
    "data-original",
    "data-thumb",
    "data-avatar",
    "data-image",
    "src",
)
_SPACER_RE = re.compile(
    r"(?:^|[/_-])(?:1x1|spacer|blank|pixel|transparent)\.(?:gif|png|jpg|webp)(?:$|\?)",
    re.IGNORECASE,
)
_GENERIC_ASSET_MARKERS = (
    "oglogo",
    "site-logo",
    "sitelogo",
    "brand-logo",
    "favicon",
    "apple-touch-icon",
    "default-avatar",
    "default_avatar",
    "/users/default/",
    "/default/pornhub/",
    "noavatar",
    "no-avatar",
    "avatar-placeholder",
    "placeholder.",
    "missing-avatar",
    "missing_avatar",
    "youtube_logo",
    "yt_1200",
    "/thumbs/",
    "/thumb/",
    "thumbs.",
    "/sprite",
)
_CHALLENGE_MARKERS = (
    "just a moment...",
    "checking your browser",
    "cf-browser-verification",
    "cf_chl",
    "ddos-guard",
    "px-captcha",
    "attention required!",
    "enable javascript and cookies to continue",
)
_JSONLD_PROFILE_TYPES = {
    "person",
    "profilepage",
    "organization",
    "performinggroup",
    "channel",
    "creator",
    "broadcastchannel",
}
_JS_AVATAR_KEYS = (
    "avatarUrl",
    "avatar_url",
    "profileImage",
    "profile_image",
    "channelAvatar",
    "logoUrl",
    "thumbURL",
    "thumbUrl",
)


def _normalize_candidate_image_url(base_url: str, raw: str | None) -> str | None:
    if not isinstance(raw, str):
        return None
    text = raw.strip()
    if not text:
        return None
    low = text.lower()
    if low.startswith(("data:", "blob:", "javascript:", "about:", "mailto:", "tel:")):
        return None
    if _SPACER_RE.search(text):
        return None

    joined = urljoin(base_url, text)
    parsed = urlsplit(joined)
    # Remove URL fragment before canonical HTTPS/SSRF validation.
    clean = urlunsplit((parsed.scheme, parsed.netloc, parsed.path, parsed.query, ""))
    try:
        return https_url(clean)
    except ValueError:
        return None


def _pick_best_srcset_candidate(srcset_value: str) -> list[str]:
    candidates: list[tuple[float, int, str]] = []
    for idx, part in enumerate(srcset_value.split(",")):
        item = part.strip()
        if not item:
            continue
        tokens = item.split()
        raw_url = tokens[0]
        score = 0.0
        if len(tokens) > 1:
            desc = tokens[1].lower()
            try:
                if desc.endswith(("x", "w")):
                    score = float(desc[:-1])
            except ValueError:
                score = 0.0
        candidates.append((score, idx, raw_url))
    # Sort highest resolution/descriptor first, preserving last fallback order on tie.
    candidates.sort(key=lambda entry: (entry[0], entry[1]), reverse=True)
    return [entry[2] for entry in candidates]


def extract_image_url(
    base_url: str,
    attrs: dict[str, Any] | None = None,
    *,
    style: str | None = None,
    srcset: str | None = None,
) -> str | None:
    """Resolve the best validated HTTPS image URL from attributes, srcset, or CSS style."""
    attr_map = attrs or {}
    raw_candidates: list[str] = []

    for key in _IMAGE_ATTR_PRIORITY:
        val = attr_map.get(key)
        if isinstance(val, str) and val.strip():
            raw_candidates.append(val)

    for s_val in (srcset, attr_map.get("data-srcset"), attr_map.get("srcset")):
        if isinstance(s_val, str) and s_val.strip():
            raw_candidates.extend(_pick_best_srcset_candidate(s_val))

    for css_val in (style, attr_map.get("style")):
        if isinstance(css_val, str) and "url(" in css_val.lower():
            for match in _BG_URL_RE.finditer(css_val):
                raw_candidates.append(match.group("url"))

    for candidate in raw_candidates:
        resolved = _normalize_candidate_image_url(base_url, candidate)
        if resolved:
            return resolved
    return None


def is_generic_site_asset(url: str, page_url: str = "") -> bool:
    """Return True for sitewide logos, default placeholders, or unrelated video thumbnails."""
    if not isinstance(url, str) or not url.strip():
        return True
    low = url.lower()
    if any(marker in low for marker in _GENERIC_ASSET_MARKERS):
        return True
    parsed = urlsplit(low)
    path = parsed.path or ""
    if path.endswith(("/logo.png", "/logo.svg", "/logo.jpg", "/default.png", "/default.jpg")):
        return True
    return False


def looks_like_challenge_page(html: str, title: str = "") -> bool:
    """Detect anti-bot/Cloudflare HTML challenges so errors aren't negative-cached."""
    head = (html[:8192] if html else "").lower()
    t_low = (title or "").lower()
    combined = f"{t_low}\n{head}"
    return any(marker in combined for marker in _CHALLENGE_MARKERS)


def _node_picture_image(node: Any, base_url: str) -> str | None:
    if node is None:
        return None
    if node.tag == "picture":
        for source in node.css("source"):
            resolved = extract_image_url(base_url, source.attributes)
            if resolved:
                return resolved
        img = node.css_first("img")
        if img is not None:
            return extract_image_url(base_url, img.attributes)
        return None
    resolved = extract_image_url(base_url, node.attributes)
    if resolved:
        return resolved
    if node.tag != "img":
        for nested in node.css("picture, img"):
            cand = _node_picture_image(nested, base_url)
            if cand:
                return cand
    return None


def _extract_node_image(node: Any, page_url: str) -> str | None:
    if node.tag == "link":
        return _normalize_candidate_image_url(page_url, node.attributes.get("href"))
    if node.tag == "meta":
        return _normalize_candidate_image_url(page_url, node.attributes.get("content"))
    return _node_picture_image(node, page_url)


def _extract_jsonld_avatar(tree: LexborHTMLParser, page_url: str) -> str | None:
    def walk_image(val: Any) -> str | None:
        if isinstance(val, str):
            resolved = _normalize_candidate_image_url(page_url, val)
            if resolved and not is_generic_site_asset(resolved, page_url):
                return resolved
        elif isinstance(val, dict):
            for key in ("url", "contentUrl", "@id"):
                cand = walk_image(val.get(key))
                if cand:
                    return cand
        elif isinstance(val, list):
            for item in val:
                cand = walk_image(item)
                if cand:
                    return cand
        return None

    def walk_entity(obj: Any) -> str | None:
        if isinstance(obj, list):
            for item in obj:
                cand = walk_entity(item)
                if cand:
                    return cand
            return None
        if not isinstance(obj, dict):
            return None

        raw_type = obj.get("@type")
        types = raw_type if isinstance(raw_type, list) else ([raw_type] if raw_type else [])
        norm_types = {str(t).strip().lower() for t in types}

        if norm_types & _JSONLD_PROFILE_TYPES:
            for field in ("image", "logo", "thumbnailUrl"):
                cand = walk_image(obj.get(field))
                if cand:
                    return cand

        for nested_key in ("mainEntity", "author", "creator", "publisher", "@graph"):
            if nested_key in obj:
                cand = walk_entity(obj[nested_key])
                if cand:
                    return cand
        return None

    for script in tree.css('script[type*="ld+json"]'):
        raw = (script.text() or "").strip()
        if not raw:
            continue
        try:
            payload = json.loads(raw)
        except Exception:
            continue
        cand = walk_entity(payload)
        if cand:
            return cand
    return None


def _extract_embedded_js_avatar(html: str, page_url: str) -> str | None:
    # 1) Explicit JS state image fields (window.initials, creator state, YouTube, etc.)
    for key in _JS_AVATAR_KEYS:
        pattern = re.compile(rf'"{re.escape(key)}"\s*:\s*"([^"]+)"')
        for match in pattern.finditer(html):
            raw_val = match.group(1).replace("\\/", "/")
            resolved = _normalize_candidate_image_url(page_url, raw_val)
            if resolved and not is_generic_site_asset(resolved, page_url):
                return resolved

    # 2) YouTube channel header avatar structures (c4TabbedHeaderRenderer / channelMetadataRenderer)
    yt_patterns = (
        r'"channelMetadataRenderer"\s*:\s*\{.*?"avatar"\s*:\s*\{\s*"thumbnails"\s*:\s*\[\s*\{\s*"url"\s*:\s*"([^"]+)"',
        r'"c4TabbedHeaderRenderer"\s*:\s*\{.*?"avatar"\s*:\s*\{\s*"thumbnails"\s*:\s*\[.*?"url"\s*:\s*"([^"]+)"',
        r'"pageHeaderViewModel"\s*:\s*\{.*?"avatar"\s*:\s*\{.*?"sources"\s*:\s*\[\s*\{\s*"url"\s*:\s*"([^"]+)"',
    )
    for pat in yt_patterns:
        m = re.search(pat, html, re.DOTALL)
        if m:
            raw_val = m.group(1).replace("\\/", "/").replace("\\u0026", "&")
            resolved = _normalize_candidate_image_url(page_url, raw_val)
            if resolved and not is_generic_site_asset(resolved, page_url):
                return resolved
    return None


_DEFAULT_AVATAR_SELECTORS = (
    "img.chlogo",
    ".pf-avatar img",
    "div[class*=psbio] img",
    "img[src*='/img/avatars/']",
    "img#getAvatar",
    ".landing-info__logo-image",
    "[class*=profile-avatar] img",
    "[class*=channel-avatar] img",
    "[class*=creator-avatar] img",
    "[class*=user-avatar] img",
    "[class*=model-avatar] img",
    "picture[class*=avatar]",
    "[class*=avatar] picture",
    "img[class*=avatar]",
    "[itemprop='image']",
    "link[rel='image_src']",
)

_DEFAULT_BG_SELECTORS = (
    ".pf-avatar",
    "[class*=profile-avatar]",
    "[class*=channel-avatar]",
    "[class*=creator-avatar]",
    "[class*=user-avatar]",
    "[class*=avatar][style*='background-image']",
)

_DEFAULT_NO_AVATAR_GUARDS = (
    (".pf-avatar .pf-letter", ".pf-avatar img"),
)


def extract_structured_profile_avatar(
    html_or_tree: str | LexborHTMLParser,
    page_url: str,
    *,
    profile_name: str | None = None,
    provider_spec: Any = None,
) -> tuple[str | None, bool]:
    """Extract canonical profile avatar from structured HTML/DOM.

    Returns `(avatar_url, confirmed_empty)`:
    - `(url, False)` when a real non-generic avatar was confirmed.
    - `(None, True)` when valid non-challenge HTML confirmed no avatar exists.
    - `(None, False)` when blocked/challenge/malformed HTML prevented confirmation.
    """
    raw_html = html_or_tree if isinstance(html_or_tree, str) else ""
    tree = html_or_tree if isinstance(html_or_tree, LexborHTMLParser) else LexborHTMLParser(html_or_tree or "")

    title_node = tree.css_first("title")
    title_text = title_node.text(strip=True) if title_node is not None else ""
    if raw_html and looks_like_challenge_page(raw_html, title_text):
        return None, False

    has_document_structure = bool(tree.css_first("body, head, main, meta")) or (len(raw_html.strip()) > 40 and "<" in raw_html)
    if not has_document_structure:
        return None, False

    # 1) Provider-specific confirmed avatarless sentinels (e.g. .pf-avatar .pf-letter on Eporner)
    no_avatar_guards = list(getattr(provider_spec, "confirmed_no_avatar_selectors", ()) or ()) + list(_DEFAULT_NO_AVATAR_GUARDS)
    for entry in no_avatar_guards:
        if isinstance(entry, tuple) and len(entry) == 2:
            empty_sel, img_sel = entry
            if tree.css_first(empty_sel) is not None and tree.css_first(img_sel) is None:
                return None, True
        elif isinstance(entry, str) and tree.css_first(entry) is not None:
            return None, True

    # 2) Provider-specific DOM selectors + CSS background selectors
    if provider_spec is not None:
        for sel in getattr(provider_spec, "avatar_selectors", ()) or ():
            for node in tree.css(sel):
                cand = _extract_node_image(node, page_url)
                if cand and not is_generic_site_asset(cand, page_url):
                    return cand, False
        for sel in getattr(provider_spec, "avatar_bg_selectors", ()) or ():
            for node in tree.css(sel):
                cand = extract_image_url(page_url, node.attributes)
                if cand and not is_generic_site_asset(cand, page_url):
                    return cand, False

    # 3) JSON-LD entity metadata
    jsonld_cand = _extract_jsonld_avatar(tree, page_url)
    if jsonld_cand:
        return jsonld_cand, False

    # 4) Universal semantic DOM & <picture> selectors
    for sel in _DEFAULT_AVATAR_SELECTORS:
        for node in tree.css(sel):
            cand = _extract_node_image(node, page_url)
            if cand and not is_generic_site_asset(cand, page_url):
                return cand, False

    # 5) Universal avatar CSS background-image containers
    for sel in _DEFAULT_BG_SELECTORS:
        for node in tree.css(sel):
            cand = extract_image_url(page_url, node.attributes)
            if cand and not is_generic_site_asset(cand, page_url):
                return cand, False

    # 6) Embedded JS initial state
    if raw_html:
        js_cand = _extract_embedded_js_avatar(raw_html, page_url)
        if js_cand:
            return js_cand, False

    # 7) Scoped OpenGraph / Twitter image fallback ONLY when safe & non-generic
    for meta_sel in ('meta[property="og:image"]', 'meta[name="twitter:image"]', 'meta[property="twitter:image"]'):
        node = tree.css_first(meta_sel)
        if node is not None:
            cand = _normalize_candidate_image_url(page_url, node.attributes.get("content"))
            if cand and not is_generic_site_asset(cand, page_url):
                return cand, False

    return None, True
