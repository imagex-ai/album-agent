"""Extensible source provider registry and safe profile/creator routing.

Centralizes known providers (YouTube, Eporner, Pornhub, xHamster) and a
structural generic provider so new sources work cleanly across Watch View,
Artists, Source Comments, Directory, and Batch Avatar Hydration without
hardcoded per-site branches scattered across modules.
"""
from __future__ import annotations

from dataclasses import dataclass
import re
from urllib.parse import urljoin, urlsplit, urlunsplit
from typing import Callable


from .profile_hub_execution import https_url

_GENERIC_PROFILE_PATH_RE = re.compile(
    r"/(?:profile|user|users|channel|channels|creator|creators|artist|artists|model|models|"
    r"performer|performers|pornstar|pornstars|star|studio|studios|u|c|p)/[^/?#\s]+/?|/@[^/?#\s]+/?",
    re.IGNORECASE,
)
_GENERIC_DENIED_PREFIXES = (
    "/watch",
    "/video",
    "/videos",
    "/search",
    "/tag/",
    "/tags/",
    "/cat/",
    "/category/",
    "/categories/",
    "/login",
    "/signup",
    "/register",
)
_YOUTUBE_HANDLE_RE = re.compile(r"/(?:@[^/?#\s]+|channel/UC[A-Za-z0-9_-]{22}|(?:c|user)/[^/?#\s]+)/?")
_YOUTUBE_CHANNEL_ID_RE = re.compile(r"UC[A-Za-z0-9_-]{22}")


def _extractor_video_id(extractor_name, url):
    try:
        from yt_dlp.extractor import get_info_extractor
        extractor = get_info_extractor(extractor_name)
        return extractor._match_id(url) if extractor.suitable(url) else None
    except (ValueError, AttributeError, KeyError):
        return None


def _pornhub_video_id(url):
    # This provider's existing source matcher also handles its short-video route.
    from .profile_hub_comment_sources import PornhubCommentsSource
    return PornhubCommentsSource.match_watch_identity(url)


@dataclass(frozen=True)
class ProfileProviderSpec:
    provider_id: str
    domains: tuple[str, ...] = ()
    domain_prefixes: tuple[str, ...] = ()
    domain_suffixes: tuple[str, ...] = ()
    profile_path_patterns: tuple[re.Pattern[str], ...] = ()
    avatar_selectors: tuple[str, ...] = ()
    avatar_bg_selectors: tuple[str, ...] = ()
    confirmed_no_avatar_selectors: tuple[tuple[str, str] | str, ...] = ()
    profile_meta_fallback_allowed: bool = False
    max_html_bytes: int = 1536 * 1024
    video_identity_resolver: Callable[[str], str | None] | None = None

    def video_identity(self, url: str) -> str | None:
        return self.video_identity_resolver(url) if self.video_identity_resolver else None

    def matches_host(self, host: str) -> bool:
        h = host.lower().lstrip(".").removeprefix("www.").removeprefix("m.")
        if h in self.domains:
            return True
        if any(h == p or h.startswith(f"{p}.") or h.startswith(p) and "." in h for p in self.domain_prefixes):
            # Guard prefix match to label boundary like xhamster19.com -> label "xhamster..."
            first_label = h.split(".", 1)[0]
            if any(first_label.startswith(p) for p in self.domain_prefixes):
                return True
        if any(h.endswith(s) for s in self.domain_suffixes):
            return True
        return False

    def allows_profile_path(self, path: str) -> bool:
        norm = path or "/"
        if any(norm.lower().startswith(bad) for bad in _GENERIC_DENIED_PREFIXES):
            return False
        if self.profile_path_patterns:
            return any(pat.fullmatch(norm) for pat in self.profile_path_patterns)
        return bool(_GENERIC_PROFILE_PATH_RE.fullmatch(norm))


GENERIC_PROVIDER = ProfileProviderSpec(
    provider_id="generic",
    profile_path_patterns=(_GENERIC_PROFILE_PATH_RE,),
    profile_meta_fallback_allowed=True,
)

_BUILTIN_PROVIDERS: tuple[ProfileProviderSpec, ...] = (
    ProfileProviderSpec(
        provider_id="youtube",
        video_identity_resolver=lambda url: _extractor_video_id('Youtube', url),
        domains=("youtube.com", "youtu.be"),
        domain_suffixes=(".youtube.com",),
        profile_path_patterns=(_YOUTUBE_HANDLE_RE,),
        avatar_selectors=(
            "link[rel='image_src']",
            "meta[property='og:image']",
        ),
        profile_meta_fallback_allowed=True,
        max_html_bytes=2 * 1024 * 1024,
    ),
    ProfileProviderSpec(
        provider_id="eporner",
        video_identity_resolver=lambda url: _extractor_video_id('Eporner', url),
        domains=("eporner.com",),
        profile_path_patterns=(re.compile(r"/(?:profile|pornstar|channel)/[^/?#\s]+/?"),),
        avatar_selectors=(
            "img.chlogo",
            "div[class*=psbio] img",
            ".pf-avatar img",
            "img[src*='/img/avatars/']",
            "div.profile-img img",
        ),
        avatar_bg_selectors=(".pf-avatar",),
        confirmed_no_avatar_selectors=((".pf-avatar .pf-letter", ".pf-avatar img"),),
        profile_meta_fallback_allowed=False,
    ),
    ProfileProviderSpec(
        provider_id="pornhub",
        video_identity_resolver=_pornhub_video_id,
        domains=("pornhub.com", "pornhub.net", "pornhub.org"),
        domain_suffixes=(".pornhub.com", ".pornhub.net", ".pornhub.org"),
        profile_path_patterns=(re.compile(r"/(?:pornstar|model|channels|users)/[^/?#\s]+/?"),),
        avatar_selectors=(
            "img#getAvatar",
            "#avatarPicture img",
            ".thumbImage img",
            ".modelInfo img",
            ".userAvatar img",
            "img[class*=avatar]",
        ),
        confirmed_no_avatar_selectors=("img#getAvatar[src*='/users/default/']",),
        profile_meta_fallback_allowed=False,
        max_html_bytes=2 * 1024 * 1024,
    ),
    ProfileProviderSpec(
        provider_id="xhamster",
        video_identity_resolver=lambda url: _extractor_video_id('XHamster', url),
        domains=("xhamster.com",),
        domain_prefixes=("xhamster",),
        profile_path_patterns=(re.compile(r"/(?:users/(?:profiles/)?|creators/|pornstars/|channels/)[^/?#\s]+/?"),),
        avatar_selectors=(
            ".landing-info__logo-image",
            "[class*=profile-avatar] img",
            "img[class*=avatar]",
        ),
        profile_meta_fallback_allowed=False,
    ),
)

_REGISTRY: dict[str, ProfileProviderSpec] = {spec.provider_id: spec for spec in _BUILTIN_PROVIDERS}


def register_provider(spec: ProfileProviderSpec) -> None:
    """Register or override a creator/source provider specification."""
    _REGISTRY[spec.provider_id] = spec


def unregister_provider(provider_id: str) -> None:
    """Remove a custom provider if registered (built-ins remain restoreable)."""
    _REGISTRY.pop(provider_id, None)


def list_providers() -> tuple[ProfileProviderSpec, ...]:
    return tuple(_REGISTRY.values())


def resolve_provider(url: str | None) -> ProfileProviderSpec:
    """Resolve matching provider spec for a URL, falling back to GENERIC_PROVIDER."""
    if not isinstance(url, str) or not url.strip():
        return GENERIC_PROVIDER
    host = (urlsplit(url).hostname or "").lower().removeprefix("www.").removeprefix("m.")
    if not host:
        return GENERIC_PROVIDER
    # Check custom/non-builtin registrations before defaults so overrides take effect first.
    builtin_ids = {p.provider_id for p in _BUILTIN_PROVIDERS}
    for pid, spec in reversed(list(_REGISTRY.items())):
        if pid not in builtin_ids and spec.matches_host(host):
            return spec
    for spec in _REGISTRY.values():
        if spec.matches_host(host):
            return spec
    return GENERIC_PROVIDER


def canonicalize_profile_url(url: str) -> str | None:
    """Normalize URL to validated fragment-free HTTPS URL, returning None if unsafe/invalid."""
    if not isinstance(url, str):
        return None
    raw = url.strip()
    if not raw:
        return None
    try:
        parsed = urlsplit(raw)
        clean = urlunsplit((parsed.scheme, parsed.netloc, parsed.path, parsed.query, ""))
        return https_url(clean)
    except ValueError:
        return None


def _base_domain(host: str) -> str:
    return (host or "").lower().removeprefix("www.").removeprefix("m.")


def normalize_source_author_url(record: dict, source_url: str) -> str | None:
    """Validate and canonicalize a creator/author/commenter profile URL from source data.

    Rejects cross-site links, credentials, video/category/search routes, and unsafe URLs.
    Supports known providers explicitly and future generic providers via same-owner routing.
    """
    if not isinstance(source_url, str) or not isinstance(record, dict):
        return None
    owner_spec = resolve_provider(source_url)
    owner_host = _base_domain(urlsplit(source_url).hostname or "")
    if not owner_host:
        return None

    if owner_spec.provider_id == "youtube":
        cid = record.get("author_id")
        canonical = (
            f"https://www.youtube.com/channel/{cid}"
            if isinstance(cid, str) and _YOUTUBE_CHANNEL_ID_RE.fullmatch(cid)
            else None
        )
        raw_author_url = record.get("author_url")
        if isinstance(raw_author_url, str) and raw_author_url.strip():
            raw_joined = urljoin("https://www.youtube.com", raw_author_url.strip())
            try:
                safe = https_url(raw_joined)
            except ValueError:
                return canonical
            parsed = urlsplit(safe)
            target_host = _base_domain(parsed.hostname or "")
            if parsed.query:
                return canonical
            if target_host == "youtube.com" and owner_spec.allows_profile_path(parsed.path):
                if canonical and parsed.path.startswith("/channel/") and parsed.path != f"/channel/{cid}":
                    return canonical
                return safe
        return canonical

    raw_author_url = record.get("author_url")
    if not isinstance(raw_author_url, str) or not raw_author_url.strip():
        return None
    base_url = f"https://{urlsplit(source_url).netloc or owner_host}"
    try:
        safe = https_url(urljoin(base_url, raw_author_url.strip()))
    except ValueError:
        return None

    parsed = urlsplit(safe)
    if parsed.query:
        return None
    target_host = _base_domain(parsed.hostname or "")
    # Enforce same-owner host parity unless identical provider domain alias (e.g. rt.pornhub.com -> pornhub.com)
    if owner_spec.provider_id == "generic":
        if target_host != owner_host:
            return None
    else:
        if not owner_spec.matches_host(target_host):
            return None

    if owner_spec.allows_profile_path(parsed.path):
        return safe
    return None
