# Profile Hub — Unified Avatar & Extensible Provider Architecture

This document records the permanent 5-layer architecture, invariants, and anti-regression guardrails for resolving profile, creator, channel, participating artist, and source-commenter avatars across built-in providers (`youtube`, `eporner`, `pornhub`, `xhamster`) and arbitrary future sources.

## Why This Pipeline Exists

Watch pages and comment feeds across heterogeneous platforms frequently:
- omit `<img>` avatars inline from the watch HTML or comment payload (for example, channel pages using CSS `background-image`, Eporner uploader links without inline thumbnails, Pornhub model/performer pages, or paginated comments with `author_url` only);
- exceed small 512 KiB HTML prefix limits before structured avatar metadata or DOM headers appear (Pornhub places `#getAvatar`/`.thumbImage` around ~535 KiB; YouTube puts ~845 KiB of inline `<head>` styles/scripts before `<link rel="image_src">`, `<meta property="og:image">`, and `ytInitialData`);
- return HTTP 401/403 or `200 OK` HTML/challenge/placeholder responses from CDNs when requested directly by the browser without proper `Referer`/headers, or serve tiny (<1 KiB) legitimate raster images that naive size thresholds would falsely reject.

To guarantee every profile surface renders reliably without scattering brittle site checks, **do not bypass or inline-replace any layer below**.

---

## Architecture Overview (5 Layers)

### 1. Image Proxy Magic-Byte & Anti-Hotlink Guard
- **Owners:** `src/server/proxy_image_guard.py`, `src/server/server.py` (`/api/proxy-image`).
- **Contract:** `sniff_image_mime` and `is_valid_image_response` (`MIN_IMAGE_BYTES = 16`) validate real raster signatures (`image/jpeg`, `image/png`, `image/gif`, `image/webp`, `image/avif`) and reject HTML/JSON/text/empty payloads.
- **Invariants:**
  - Trigger anti-hotlink retries on both `401/403` **and** invalid `200 OK` HTML/non-image bodies.
  - Never write unvalidated bytes to `_IMAGE_CACHE_DIR`.
  - Never reintroduce a hard ~1 KB minimum byte rejection that breaks small legitimate raster avatars.

### 2. Extensible Provider Registry & Routing
- **Owners:** `src/server/profile_hub_providers.py`, `src/server/profile_hub_watch_sources.py`, `src/server/profile_hub_comment_sources.py`.
- **Contract:** `ProfileProviderSpec`, `GENERIC_PROVIDER`, `register_provider()`, `unregister_provider()`, `resolve_provider()`, `canonicalize_profile_url()`, `normalize_source_author_url()`.
- **How to add a new site/source:** Register a `ProfileProviderSpec` declaration (domains, suffix/prefix matchers, `profile_path_patterns`, `avatar_selectors`, `avatar_bg_selectors`, `confirmed_no_avatar_selectors`, `max_html_bytes`). Do **not** scatter per-site `if/elif` domain branches across UI components, `TimelineWatchView`, `SourceComments`, or batch resolvers.
- **Invariants:**
  - `ProfileProviderSpec.max_html_bytes` defaults to `1536 * 1024` (1.5 MiB), and `youtube`/`pornhub` use `2 * 1024 * 1024` (2 MiB). Never reduce this back to `512 KiB`, or Pornhub (`#getAvatar` at ~535 KB) and YouTube (`link[rel='image_src']`/`og:image` at ~845 KB) will truncate before their avatar metadata!
  - `normalize_source_author_url` restricts commenter/creator URLs to safe HTTPS routes on the owning provider (blocking `javascript:`, credentials, search/watch routes, and cross-site injection).

### 3. Unified SSRF-Safe Batch Avatar Resolver Service
- **Owners:** `src/server/profile_hub_avatar_service.py` (mounted on `profile_hub_comments.router` at `/api/profile-hub/avatars/resolve` and `/api/profile-hub/avatars/resolve-single`), `src/server/profile_directory_service.py`.
- **Invariants:**
  - Uses `PublicHTTPSHttpxTransport` with manual hop-by-hop redirect canonicalization (`MAX_AVATAR_REDIRECTS = 3`), blocking loopback/private/link-local targets on initial fetch and redirects alike.
  - Bounds HTML reads cleanly (`MAX_AVATAR_HTML_BYTES = 2 * 1024 * 1024`) with `Accept-Encoding: identity`.
  - **Queue/Semaphore Ordering:** Always acquire per-host `host_sem` (`Semaphore(2)`) **outside** `_GLOBAL_SEMAPHORE` (`Semaphore(6)`), and place `asyncio.timeout(...)` **inside** both locks. Reversing that order causes queued comments from one host to starve other providers and burn their request timeout waiting in line.
  - **Single-Flight + Dual TTL:** `_INFLIGHT` refcounts readers before pruning; `_AVATAR_CACHE` (LRU 2048) caches:
    - `found` -> `3600s`
    - `not_found` (`confirmed_empty=True` ONLY) -> `900s`
    - `error` (`challenge`/403/503/timeout/`confirmed_empty=False`) -> `60s` backoff.
  - Anti-bot challenge pages must **never** return `confirmed_empty=True` or enter the 900s negative cache.

### 4. Structured HTML/CSS/JS Extractors & Anti-Logo Filters
- **Owners:** `src/server/profile_hub_avatar_extractors.py`, `src/server/profile_hub_workers.py`.
- **Cascade (`extract_structured_profile_avatar`):**
  1. `looks_like_challenge_page` -> returns `(None, False)` so error isn't negative-cached.
  2. Provider `confirmed_no_avatar_selectors` (e.g., `.pf-avatar .pf-letter`, `img#getAvatar[src*='/users/default/']`) -> `(None, True)`.
  3. Provider `avatar_selectors` & `avatar_bg_selectors` using shared `_extract_node_image` (`link[href]`, `meta[content]`, `<picture><source srcset>`, `data-src`/`data-lazy-src`/`data-original`, CSS `background-image`).
  4. JSON-LD entity metadata (`Person`, `ProfilePage`, `Organization`, etc.).
  5. Universal `_DEFAULT_AVATAR_SELECTORS` & `_DEFAULT_BG_SELECTORS`.
  6. Embedded JS state (`window.initials`, `ytInitialData`, `pageHeaderViewModel`, `avatarUrl`, `thumbURL`, etc.).
  7. Scoped `og:image` / `twitter:image`.
- **Anti-Logo Guard (`is_generic_site_asset`):** Blocks sitewide logos (`oglogo`, `youtube_logo`, `yt_1200`), placeholders (`default-avatar`, `/users/default/`, `/default/pornhub/`, `noavatar`, `avatar-placeholder`), and video thumbnails (`/thumbs/`, `/thumb/`) so real avatars never get replaced by generic site icons or user silhouettes. Note: performer portrait paths like `/thumb_1173801.jpg` and cache-busted `.v<ts>` channel filenames like `logo.jpg.v1533717764` are deliberately preserved.

### 5. Unified Frontend Store & `<SourceAvatar />` Component
- **Owners:**
  - `frontend-mobile-preview/src/services/profileAvatarService.ts`
  - `frontend-mobile-preview/src/store/useProfileAvatarStore.ts`
  - `frontend-mobile-preview/src/components/profile-hub/common/SourceAvatar.tsx`
  - `frontend-mobile-preview/src/services/profileHubImageFallback.ts`
  - Integrated in: `TimelineWatchView.tsx`, `WatchArtistsRow.tsx`, `SourceComments.tsx`, `ProfileHubLibraryView.tsx`, `ProfileDirectoryPanel.tsx`, `TimelineStoriesBar.tsx`, `AdaptiveProfileHeader.tsx`, `TimelinePostCard.tsx`.
- **Invariants:**
  - All Profile Hub avatar surfaces MUST render `<SourceAvatar />` (not bare `<img>` tags), which enforces `safeAvatarSourceUrl`, batched debounced hydration via `useProfileAvatarStore`, `/api/proxy-image` error recovery with `referer`, and monogram initials fallback (`getInitialsAvatar`).
  - `avatarIdentityKey` (stripping `www.`/`m.` and trailing `/`, preserving path case for case-sensitive YouTube `UC...` IDs) is intentionally separate from `profileShortcutIdentity` (which keeps `www.` for persisted favorites compatibility). Do not merge or break either normalizer.
  - Comment lists use `lazyHydrate` (`IntersectionObserver`) so offscreen commenters do not trigger unnecessary backend bursts.
  - When `TimelineWatchView` resolves an improved `resolvedCreatorAvatar`, History updates MUST use `{ enrichOnly: true }` so `watchedAt` order is preserved.
