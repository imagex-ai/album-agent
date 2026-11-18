---
version: alpha
name: IMAGEX
description: Dense media extraction studio with themed surfaces, colorful media badges and immersive players.
colors:
  primary: "#3b82f6"
  background: "#0b0f19"
  surface: "#111827"
  elevated: "#162032"
  text: "#f8fafc"
typography:
  sans:
    fontFamily: "Plus Jakarta Sans, Inter, -apple-system, sans-serif"
  mono:
    fontFamily: "JetBrains Mono, monospace"
omitted:
  - section: spacing
    reason: "Existing Tailwind utilities and per-view responsive classes remain canonical; this performance change adds no spacing scale."
  - section: rounded
    reason: "Existing card/control classes remain canonical; no radius values change."
  - section: components
    reason: "Shared component ownership and unchanged visual behavior are documented below and in UX-CONTRACT.md."
---

# IMAGEX visual contract

## Profile Hub initial page

A cold Hub entry uses the existing directory hero and URL-entry controls, with
an empty input, saved directories, history and favorites. It does not expose
demo-profile shortcuts, profile tabs or the profile selection bar. Demo shortcuts
must also stay out of profile navigation and URL toolbars; the local example is
accessed through favorites. The local
example is opened deliberately through favorites. The profile and loaded
directory screens retain their existing composition.

## Profile Hub source indicators

Profile tabs and quick favorites place a compact source icon immediately after
the profile name. `ProfileSourceLabel` uses the existing 0.75rem icon scale,
keeps the avatar and actions, and shows a neutral globe when a known origin has
no usable icon. Demo or invalid origins do not invent a source. The real Hub was
visually inspected in the current dark theme at 1249, 390 and 320 CSS pixels;
the indicators measured 12 px. A matched-fixture comparison with the approved
preview and verification of other themes remain pending.
The icon service reads a bounded prefix of large pages, resolves HTML base URLs
and validates HTTPS with the maintained CA bundle plus system trust roots;
discovery stays source-agnostic.

## Saved directories — approved additive integration, 04/11/2026

After the first delivery was rejected for visual divergence, the real component
was compared against the approved prototype with matching fixtures and full
application CSS. Scoped `.pd-dialog.sd-panel` and `.pd-dialog.sd-editor` selectors
retain the intended dimensions despite shared dialog rules. The panel uses a
title/count row, compact pin and overflow actions, an active source indication,
and the approved header/search/list/footer geometry. Native dialogs and the
existing source navigation remain owners. iOS keeps the existing 16px input
safeguard; other narrow layouts use the compact reference typography.

The saved-directory trigger uses its own compact `sd-trigger-count`, not the
catalog/title `pd-count`. Header actions share a 35px desktop height and 44px
mobile height; narrow layouts wrap without hiding actions. The directory's
`profile-catalog` container queries use the width remaining beside the App
sidebar. The active-source label identifies the loaded directory's real hostname,
independently of edits to the URL input. Profile URL actions wrap on mobile while
retaining their desktop composition. Visual verification must include the whole
header, URL form and catalog, as well as the saved-directory overlay.

Directory cards keep the favorite heart at the top right and the overflow menu
at the bottom right. The user requested a transparent heart control with a
slightly stronger rose/red outline and a subtle static neon glow. Its color
comes from Tailwind's canonical `colors.accent.rose`; the icon remains compact
while its pointer/touch target stays larger. The directory tab has no catalog
badge.

`ProfileFavoriteButton` owns click feedback: a pulse when adding and a brief
recoil when removing. Only successful changes initiated by that button animate;
mounting and external favorite updates stay still. Fine-pointer hover adds a
small tilt/scale and stronger neon glow; keyboard focus has equivalent emphasis.
The hit area stays fixed. OS reduced motion and `disableAllAnimations` suppress
movement, including when the preference changes during an effect.

`components/profile-hub/SavedDirectories.tsx` adds a compact action to the existing
Hub/profile and directory headers. It opens an AppDialog overlay on desktop and
the same dialog at full viewport height on phones. Existing hero, URL entry,
tabs, filters, paging, players and profile composition retain their owners.
`saved-directories.css` consumes existing `--pd-*` tokens. Grid-only desktop hover
adds a small lift; pointer/hover capability and reduced motion suppress it where
appropriate. Local shortcut data lives separately in `useSavedDirectoriesStore`;
only the existing directory resolver validates entries and the existing opening
handler performs navigation. No media task is dispatched by shortcut CRUD.
Shortcut caches are backed by server persistence and a local durable outbox;
explicit edits flush immediately, retries send desired state, and server reads
replace stale snapshots while preserving pending edits. Profile URL identity is
shared by favorite restoration and heart state. Storage/HTTP failures retain
useful local state and expose the existing storage warning.

## Product and visual direction

A media extraction and inspection tool used repeatedly on desktop localhost and
phones. The user approved performance work while explicitly preserving the
existing appearance and interactions. The reference is the current album/video
gallery, not a new visual direction. The studio identity comes from layered
dark surfaces, blue actions, colorful category badges, media covers, rounded
cards and the existing motion presets. Keep that density and hierarchy.

English and Brazilian Portuguese are supported by `src/i18n/translations.ts`.
Locale is not evidence of a market-specific legal or product requirement.

## Runtime ownership

### Hub Violet and Hub home alignment

The optional `hub-violet` theme uses the Profile Hub plum/violet palette through
`index.css`. Tailwind `slate` and `brand` utilities consume RGB channel variables
with the original palettes as fallbacks, including opacity modifiers. Glass
surfaces inherit the new theme in the shell and portals. Status colors retain
their semantic palettes. The existing settings preference persists this theme.

Hub home aligns navigation, hero, URL entry and quick favorites to the existing
1900px content width. Quick favorites use sibling native open/remove buttons,
desktop overflow arrows and a touch-scroll strip with visible removal on mobile.
Home welcome counters wrap on narrow screens.

The loaded-profile header uses the same content width as Hub home. Its active
tab has the strongest navigation emphasis, while the matching favorite remains
subtle. Quick favorites snap horizontally and fade only overflowing edges.
Profile tabs reveal the active tab horizontally on selection and resize.
Profile status feedback uses a compact, dismissible live region.

Existing runtime tokens remain canonical (model B):

| Documented role | Runtime source | Adapter/consumer |
|---|---|---|
| Primary blue | `frontend-mobile-preview/tailwind.config.js`, `brand.500` | existing action and focus classes |
| Background/surface/elevated/text | `frontend-mobile-preview/src/index.css`, root CSS variables | Tailwind semantic color aliases and existing card classes |
| Theme alternatives | `.theme-deep-oled`, `.theme-clean-light`, `.theme-cyber-studio` in `index.css` | App theme selection |
| Body/technical typography | `tailwind.config.js`, `fontFamily.sans/mono` | existing text classes |
| Motion | `src/services/motionConfig.ts` and existing CSS | view transitions and players |

This document mirrors those values; it does not generate CSS or introduce new
tokens. Token changes require a corresponding deliberate design decision.

## Layout and components

`App.tsx` owns the sidebar, top header, session tabs and the single scrolling
`main`. Keep its scroll ownership and viewport/safe-area rules. Existing page
toolbars, folder rows, category filters, headings, labels, icons, card markup and
responsive column classes remain the references. Lucide icons and current
`IconBadge`, `ModalPortal`, notifications and player components are reused.

`VirtualCollection` owns bounded rendering only. It must preserve the same
horizontal and vertical gaps, responsive columns, card identity, full-dataset
selection, scroll position, keyboard traversal, open menus and inline playback.
It is not a second card design. Offscreen placeholders represent geometry and
are hidden from accessibility tools. Existing empty and failure states remain.

No animation or image-quality reduction is part of the performance changes.
Existing accessibility limitations outside changed behavior are not declared
compliant by this document.

## Profile Hub source data

The Lara Monteiro demo remains a comparison example with an explicit reset action.
A pending or failed URL scan preserves the displayed profile and selection. A
successful scan activates its own profile session, including empty sections. Earlier real sessions and selections remain available when returning. Source
metadata stays raw in the API; `services/profileHubPresentation.ts` owns localized
relative dates, unknown values and counts using `i18n/translations.ts`. Missing
metadata must not imply recency, quality, ownership, verification or completeness.
Collection progress measures loaded records and requires confirmed pagination
completion before reporting a completed load.

Catalog and playlist-item responses return listing data immediately, without waiting
for watch-page metadata. ProfileHubView fills metadata automatically through
cancelable batches of at most eight targets; the backend limits each batch to two
concurrent lookups. Missing, failed and not-yet-queried metadata remain distinct.
Thumbnail extraction prefers actual lazy-image URLs and preserves CDN filenames;
grid images use native lazy loading and asynchronous decoding.


## Profile Hub session integration

The existing Profile Hub now owns the profile/directory subflow internally; the
sidebar remains unchanged. `store/useProfileHubStore.ts` owns all profile view
sessions and the global selection grouped by source profile. Demo selections are
excluded once real sessions exist. `store/useProfileDirectoryStore.ts` keeps
listing pages and local display context separately per query.

`services/profileHubNavigation.ts` and `profileHubRuntime.ts` integrate opaque
local context references with the existing App hash handler. The existing scroll
hook accepts a context key, which takes precedence over shared tab/view offsets.
No profile URL/name is written into the context hash. Contexts and selections
remain in memory; a cold context link shows recovery guidance rather than
fetching an arbitrary source. The same URL input delegates adapter recognition
to the server, preserving the previous scanner for legacy inputs.

The directory catalog and grouped review are internal modes of this Hub. Existing
real-profile Save entry points open the grouped review; compatible ZIP entry
points retain their existing guards and confirmations. The global selection bar
opens that same review. Execution uses the confirmed executor documented in
`docs/profile-hub-execution.md`, never the incomplete legacy album batch-save.
Video/gallery destinations and video mode remain independent per profile.


## Profile directory catalog

`components/profile-hub/ProfileDirectoryPanel.tsx` owns the directory mode inside
Profile Hub. The approved directory mockup governs its main content. App's sidebar,
top header and session-tab shell remain canonical. The existing profile layout
is preserved; its entry form and URL opening handler are shared with the catalog.

`profile-directory.css` owns scoped `--pd-*` tokens: dark violet catalog surfaces,
purple actions, subtle borders and compact typography matching the reference.
Light, OLED and Cyber Studio variants remain scoped; no global brand palette or
sidebar redesign occurs. The hero uses CSS/lucide decoration, not invented media.
Cards display source names, images and counters; fallback initials/hostnames are
neutral, photos do not imply albums, and the small glow dot is decorative.

`services/profileDirectoryCopy.ts` is the catalog's pt-BR/en-US message namespace,
selected from the existing application language. Search/sort scope is explicit.
`DirectoryControls.tsx` owns disclosure menus and native modal dialog behavior,
rendered through the existing ModalPortal. Native selects remain canonical.

The desktop grid has five columns at the reference width; four/three/two/one
columns and collapsible filters support smaller widths. Main remains the content
scroll owner; only the alphabet strip and bounded modal body scroll separately.
One isolated desktop screenshot was inspected at user request; this is not a full
responsive/theme/focus compliance claim. No agents were used.

## Profile Hub grouped review

The user approved the specific multi-profile review proposal on 01/11/2026.
`ProfileReviewPage.tsx` implements that composition: profile blocks, media beside
their respective destinations, a summary on the right and the existing global
selection-bar component in its named `review` variant. Sidebar, profile layout
and players retain their existing owners.

`profile-review.css` owns review geometry only and consumes the directory's
`--pd-*` tokens from `profile-directory.css`. Those existing theme selectors also
cover the selection bar when displayed over the profile. No new global palette,
font family or scrollbar baseline is introduced. Container queries stack the
summary and destination blocks according to the actual content width.
The canonical token owner derives `--pd-control-border` from text/border tokens
for review inputs. Its named `phr-primary` button variant derives the gradient
from primary/accent tokens to retain readable small white labels; existing
directory buttons keep their approved styling.

Review thumbnails and metadata come from profile sessions, with neutral icon/text
fallbacks. Unknown collection sizes remain unknown. An explicitly selected
collection can cover a child only when membership is known in that same session.
Counts describe selections rather than an invented total of expanded files.

`AppDialog` centralizes native modal containment and trigger-focus restoration
through ModalPortal for new review overlays. `FolderSelectModal` exposes the
business variant `purpose="destination"`, using its existing video/album domain
logic while deferring new-folder creation. Its legacy save variant keeps existing
behavior. Mode selects use the established native/platform popup contract.

Review state, per-profile destinations and display limits stay in the Hub store
through navigation. The authorized Stage 5 adds execution inside the existing
summary, using `ProfileExecutionPanel`, the same buttons and `--pd-*` tokens.
The confirmed snapshot replaces the live summary while tracking, so editing
current selections cannot misrepresent the committed profiles or destinations.
Text/icons distinguish queued, resolving, running, completed, failed and
interrupted states; percentages appear only with actual measured byte totals.
Running/resolving indicators and an active status-query icon reuse the existing
`animate-spin` utility; failure/success/queued icons remain still. The review's
explicit reduced-motion override has enough specificity to disable that utility
when the platform requests reduced motion. Source-count failures show reported,
found and visited-page counts when the journal has that evidence.
Operations initially render twelve entries with explicit increments. Retry
targets failed tasks only. An uncertain confirmation keeps its original snapshot
and offers status lookup or an idempotent resend. Production never simulates
extraction success. No further browser inspection or independent-agent review
was performed, as requested; source/unit/render checks are not visual approval.

## Profile Hub loading performance — 2026-11-02

The existing layout, components, tokens and labels remain the visual reference.
First-page profile content is usable while deep discovery continues. Unknown
totals remain unknown until discovery finishes. Completion updates the same
session and preserves selections, filters, destinations and the active panel.
Known profiles and fresh complete collections reuse session data; incomplete
discovery remains retryable. Metadata delivery coalesces for at most 16 ms and
uses one store transaction per batch. Processing measurements and validation
are recorded in `docs/profile-hub-performance.md`; they do not claim live-site
latency or visual approval.

## Profile Hub unified avatar resolution

All creator, uploader, participating artist, comment author, and history
avatar slots across Profile Hub share a single visual and state owner:
`<SourceAvatar />` (`frontend-mobile-preview/src/components/profile-hub/common/SourceAvatar.tsx`)
backed by `useProfileAvatarStore.ts` and `profileAvatarService.ts`. Components
must not issue bespoke profile fetches or inline custom fallback `<img>`
pipelines for profile avatars.

Resolved images render smoothly from `avatarIdentityKey` (stripping `www.`/`m.`
and trailing `/` while preserving path case for provider IDs such as YouTube
channels, distinct from `profileShortcutIdentity`), fall back automatically
through `/api/proxy-image` when third-party CDNs block direct hotlinking, keep
clean initial monograms when providers report `confirmed_empty: true` (default
silhouettes excluded by the backend extractor), defer off-screen comment/list
lookups via `IntersectionObserver`, and propagate discovered metadata back to
History items using `{ enrichOnly: true }` without mutating watch order or
unloaded entries. Backend provider specs, semaphore ordering, HTML budget limits,
and image-response guards are documented in `docs/profile-hub-avatar-architecture.md`.

## Universal Video Player & Floating Mini-Player

All video playback controls outside frozen Shorts (`ShortsView.tsx`) and chrome-free
muted GIF/hover loops share one container-adaptive component shell
(`<UniversalVideoPlayer />` inside `frontend-mobile-preview/src/components/video-player/`)
paired with `<FloatingMiniPlayer />`.

- **Container-Query & Coarse-Pointer Sizing:** Control bar density adapts via
  `@container` inline-size (`< 480px` compact mobile HUD with central
  `↺10s | ▶/⏸ | 10s↻` + `⚙` Bottom Sheet; `>= 768px` studio desktop bar) rather
  than hardcoded parent `isDesktop` props. Clocks stay `tabular-nums whitespace-nowrap`,
  touch targets meet `>= 44×44px` under `@media (pointer: coarse)`, and narrow
  settings render in a Bottom Sheet obeying `env(safe-area-inset-bottom)`.
- **Theme Tokens & Ambient Glow:** Scrim/chrome inside video surfaces maintains
  high contrast (`rgba(15,23,42,0.78)` + crisp white controls), while surrounding
  popovers, Bottom Sheets, shortcuts dialog, and Floating Mini-Player consume
  `--tl-*` tokens across all 5 themes (`dark-slate`, `deep-oled`, `clean-light`,
  `cyber-studio`, `hub-violet`). Portrait Ambient Glow stays opt-out and respects
  `prefers-reduced-motion` and `disableAllAnimations`.
- **Single-Player Freeze & Slot Compliance:** Highlight markers and the `⚡ Clímax`
  jump control in `VideoPlayerModal` remain frozen (`PROJECT_RULES.md`) and plug
  into `<UniversalVideoPlayer />` via declarative track/control slots. See
  `docs/video-player-architecture.md` before changing layout, scrims, mini-player
  dock geometry, or PiP fallbacks.

### Motion Tokens, Physics Curves & React Render Rules (`DESIGN.md` Binding)
- **GPU Compositor Only:** Progress bar fill (`scaleX`), scrubber thumb growth, double-tap halo rings, `2x >>` hold pill spring, Edge-Stash tab slide, and mini-player corner snapping animate only `transform` and `opacity` (SVG icons animated via HTML wrappers). Scrubber & drag offsets update CSS variables through `useRef` (`requestAnimationFrame`) without React re-renders at 60fps.
- **Physics & Motion Config Sync:** Connect `<UniversalVideoPlayer />` & `<FloatingMiniPlayer />` to `motionConfig.ts` (`--anim-speed-duration`, `getVideoPlayerAnimationClass`, `getFullscreenAnimationClass`, `disableAllAnimations`) and `@media (prefers-reduced-motion: reduce)`. Spring `linear(...)` curves apply exclusively to `transform`/`scale`/`rotate` with `@supports` `cubic-bezier(0.34, 1.56, 0.64, 1)` fallback — never to `opacity`.
- **Discrete Top-Layer & Intrinsic Drawer Transitions:** Bottom Sheet, menus, and Shortcuts Dialog use `@starting-style` + `transition-behavior: allow-discrete` with `canTransitionDisplay()` (`playerMotion.ts`) `[data-closing]` fallback (`2000ms` timeout failsafe); Desktop volume slider uses `interpolate-size: allow-keywords` / `calc-size()` width reveal with instant fallback. Card→Watch & Mini→Watch transitions support `startViewTransition()` with temporary `view-transition-name` stripped in `.finished.finally(...)`.
