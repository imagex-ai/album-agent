# Universal Video Player Architecture & Anti-Regression Best Practices

> **Status:** Canonical architectural specification for all video playback surfaces (Desktop & Mobile).
> **Applies to:** Any future change in `frontend-mobile-preview/src/components/video-player/`, `TimelinePostCard.tsx`, `TimelineWatchView.tsx`, `VideoPlayerModal.tsx`, `VideosView.tsx`, `AlbumDetailView.tsx`, `LightboxModal.tsx`, `PhotoLightboxModal.tsx`, `WebVideoScraperView.tsx`, `TrashView.tsx`, `FloatingMiniPlayer.tsx`, and `MiniTaskDock.tsx`.

---

## Why This Architecture Exists (Read Before Editing Any Player Code)

A live Desktop (`1440×900`) and Mobile (`390×844`) audit uncovered systemic defects caused by having **three diverging player implementations** (`TimelinePostCard`, `VideoPlayerModal`, and raw `<video controls>` across secondary screens):

1. **Nested Interactive Elements Hijacked Playback:** `TimelinePostCard.tsx` placed an outer `role="button"` wrapper (`"Open video ..."`) around inner `<button>` controls (Play, Mute, Quality, Fullscreen), violating HTML/WCAG `4.1.2` and causing inline feed clicks to bubble and unexpectedly navigate into `TimelineWatchView`.
2. **Severe Mobile Overflow & Tiny Hit Targets:** `VideoPlayerModal.tsx` rendered an unwrapped horizontal bottom toolbar that overflowed to `x = 700px` on a `390px` phone screen (pushing Quality, Speed, PiP, Fill, and Fullscreen off-screen) and wrapped the `02:16 / 16:09` clock across 3 vertical lines at intermediate widths. Meanwhile, `TimelinePostCard` rendered `24×24px` buttons (`0px` gap between Quality and Fullscreen on `390px`) and a `4px` tall range scrubber (`< 44×44px` minimum touch target).
3. **`Escape` Event Listener Leaks:** Popover menus (`Quality`, `Options`) used bubble-phase `document.addEventListener('keydown', ...)` calling `e.stopPropagation()`. On the same `document` target, `stopPropagation()` does **not** stop sibling listeners registered on `document` (such as `TimelineWatchView` or `VideoPlayerModal` close handlers), so pressing `Escape` to close a dropdown could simultaneously dismiss Watch View or the Modal.
4. **Hardcoded `isDesktop` & Divergent Capabilities:** `TimelineWatchView.tsx` hardcoded `isDesktop` when mounting `TimelinePostCard` even in single-column mobile widths (`wide === false`), while inline library/album/lightbox/scraper/trash views fell back to inconsistent browser-native `<video controls>` without app themes (`--tl-*`), HLS renewal, shortcuts, or handoff.
5. **Missing Modern Mobile & Floating Capabilities:** No double-tap `±10s` seek accumulation, no hold-`2x` gesture, no vertical fine-scrubbing, no persistent Floating Mini-Player with screen-edge stashing across app navigation or native OS PiP / Auto-PiP handoff, and leaked untranslated Portuguese strings (`'Stream Renovado'`, `'Recarregar'`, `'Fechar Reprodutor'`, `'Vídeo'`).

To prevent any future change from reintroducing these regressions or breaking frozen features, **do not bypass or inline-replace any layer or invariant below.**

---

## Mandatory Scope Boundaries (DO NOT CONVERT)

1. **Frozen Smart Shorts & Highlights (`PROJECT_RULES.md`):**
   - `ShortsView.tsx`, `src/core/smart_shorts_detector.py`, `get_or_detect_smart_highlight`, and all highlight detection/scoring/selection APIs are **strictly frozen** and must **never** be refactored or consolidated into `<UniversalVideoPlayer />` without explicit user authorization.
   - Preserve `VideoPlayerModal.tsx`'s highlight scrubber notches. The user subsequently requested no separate Climax button or icon in the player; generic extension slots remain available for other controls.
2. **Chrome-Free Muted GIF-MP4 Previews & Hover Previews:**
   - Muted auto-looping MP4 previews (`type === 'gif'` cards in `TimelinePostCard.tsx`, grid cells in `AlbumDetailView.tsx`, GIF lightbox view in `LightboxModal.tsx`, `SlideshowModal.tsx`, and muted hover preview snippets in `AdaptiveProfileContent.tsx`) stay lightweight chrome-free loops (`autoPlay loop muted playsInline`). Do not wrap animated GIF cells with scrubber bars, floating mini-player hooks, or Media Session claims.

---

## Unified Architecture Overview (3 Layers + Floating Layer)

```text
frontend-mobile-preview/src/components/video-player/
├── engine/
│   ├── videoPlayerCore.ts           # Pure logic: stream classifier, ABR fallback, error classifier, clock format, shortcuts, overlay priority, dock snap/clamp math
│   ├── useUniversalVideoEngine.ts   # Headless HTML5 + hls.js + Safari native lifecycle, 20s timeout, stream renewal, snapshot handoff
│   ├── usePlayerControlsAutoHide.ts # Unified 2500ms idle timer + freeze locks (paused, menuOpen, scrubbing, toolbarHovered, focusWithin)
│   ├── usePlayerGestures.ts         # Double-tap ±10s combo, hold-350ms 2x (canceled on >10px move), vertical fine scrub, vertical fullscreen swipe
│   ├── usePlayerShortcuts.ts        # Full YouTube-style shortcuts gated against typing elements + active overlay stack
│   ├── useMediaSession.ts           # OS lockscreen metadata, hardware keys & opt-in enterpictureinpicture Auto-PiP
│   ├── useExternalPictureInPicture.ts # Document PiP (Desktop Chromium/Firefox HTTPS/localhost) + Classic OS PiP fallback (iOS/Android/Safari)
│   └── playerOverlayStack.ts        # Capture-phase Escape stack manager (Menu > Sheet > Shortcuts > Fullscreen > Watch > Modal > Mini-Player)
├── ui/
│   ├── UniversalVideoPlayer.tsx     # Single @container-driven UI shell ('card' | 'cinema' | 'compact' | 'mini' density modes)
│   ├── PlayerScrubber.tsx           # Buffer + progress + hover/touch bubble + vertical fine-scrub + frozen renderTrackMarkers slot
│   ├── PlayerControlBar.tsx         # Adaptive bar: compact mobile touch HUD (↺10s ▶/⏸ 10s↻) vs full desktop studio toolbar
│   ├── PlayerSettingsSheet.tsx      # Responsive menu: anchored popover (desktop) <-> native <dialog> Bottom Sheet (mobile/coarse)
│   ├── PlayerGestureOverlay.tsx     # ±10s ripples, "2x >>" hold pill, volume HUD, ambient backdrop toggle
│   ├── PlayerShortcutsDialog.tsx    # Shift+? keyboard shortcuts cheat sheet (pt-BR / en-US)
│   └── universal-player.css         # @container, @media (pointer: coarse) >=44px hitboxes, tabular-nums timer lock, 5-theme --tl-* mappings
└── FloatingMiniPlayer.tsx           # Persistent edge-stashable floating dock + useMiniPlayerStore.ts coordinator
```

---

## Non-Negotiable Architectural Invariants

Every invariant below documents **What It Does**, **Why It Exists**, and **Do-Not-Break Rules** for AI agents and engineers.

### 1. Zero Nested Interactive Controls (DOM & Accessibility)
- **What:** `<UniversalVideoPlayer />` wraps the `<video>` surface in a plain `<div data-video-surface>` element—**never** `<div role="button">` or `<button>` containing child `<button>`, `<input>`, or `<a>` elements.
- **Why:** Nesting controls breaks screen readers (WCAG `4.1.2`) and causes taps on Play/Pause or Quality inside Timeline cards to bubble upward and hijack inline playback into Watch navigation.
- **Rule:** Navigation to `TimelineWatchView` must be triggered by dedicated sibling actions (the post title, a separate "Watch" action button outside `[data-player-chrome]`, or an explicit navigation affordance), never by wrapping the player surface in a clickable button ancestor. Clicking/tapping empty video surface toggles controls (`coarse` touch) or Play/Pause (`fine` pointer), and stops propagation strictly inside the media container.

### 2. Deterministic Capture-Phase `Escape` & Top-Layer Stack (`playerOverlayStack.ts`)
- **What:** All player overlays (Settings Popover, Bottom Sheet, Shortcuts Cheat Sheet, Fullscreen, `TimelineWatchView`, `VideoPlayerModal`, and optional Mini-Player dismiss) register with a centralized capture-phase stack (`document.addEventListener('keydown', ..., { capture: true })`).
- **Why:** Sibling bubble listeners on `document` ignore `event.stopPropagation()` and fire simultaneously (observed live: pressing `Escape` inside an open Quality menu closed both the menu AND Watch View).
- **Rule:** The top-most open layer calls `event.preventDefault(); event.stopImmediatePropagation();`, closes only itself, and returns focus to its trigger (`trigger.focus({ preventScroll: true })`). Wait for any `<dialog open>` top-layer native close before dismissing backing views.

### 3. Container-Driven Layout & Coarse-Pointer Ergonomics (`@container` + `@media (pointer: coarse)`)
- **What:** `UniversalVideoPlayer` declares `container-type: inline-size` on `.uvp-stage` and adapts controls via `@container` widths (`< 480px`, `480px–767px`, `>= 768px`) and input precision via `@media (pointer: coarse)` / `(hover: none)`.
- **Why:** Passing hardcoded props like `isDesktop` from parent views (e.g., `TimelineWatchView.tsx` passing `isDesktop` unconditionally) caused squashed or overflowing control rows whenever split panes, resizable windows, or mobile views didn't match the prop assumption.
- **Rule:**
  - Never hardcode `isDesktop` to control button visibility inside `<UniversalVideoPlayer />`.
  - Every interactive control inside player toolbars must maintain `>= 44×44px` hit target area under `@media (pointer: coarse)` (via button dimensions or `::after` expanded hit area) with `>= 8px` gap (`gap-2`) between adjacent triggers.
  - All time displays (`02:16 / 16:09`) MUST use `font-variant-numeric: tabular-nums; white-space: nowrap; flex-shrink: 0;` (`whitespace-nowrap shrink-0`) inside a two-zone layout so clocks **never** wrap onto multiple lines at intermediate widths.
  - Settings/Quality/Speed menus below `520px` container width (or coarse touch) MUST render inside a Bottom Sheet (`max-height: 75dvh`, `env(safe-area-inset-bottom)`) rather than an overflowing inline floating popover.

### 4. Touch Scroll Safety & Non-Conflicting Gestures (`touch-action`)
- **What:** Inline feed/library players enforce `touch-action: pan-y` on `[data-video-surface]` (only switching to `touch-action: none` inside active Fullscreen or when actively dragging the Scrubber handle itself).
- **Why:** Setting `touch-action: none` or `preventDefault()` on unconfirmed `pointerdown` freezes vertical feed scrolling on iOS Safari and Android Chrome.
- **Rule:**
  - `hold-for-2x` (`350ms` press timer) MUST cancel immediately if `|Δx| > 10px` or `|Δy| > 10px` (or `pointercancel`), preserving vertical page scroll.
  - Double-tap zones (`left 32%` = `-10s`, `center 36%` = HUD/Play, `right 32%` = `+10s`) accumulate within a `450ms` window without delaying initial feed scroll.
  - Vertical scrubbing sensitivity reduces smoothly (`1.0x -> 0.5x -> 0.25x`) only **after** a horizontal scrubber `pointerdown` has already captured the pointer.

### 5. Sticky Watch Clearance & `main` Scroll Ownership (`--timeline-watch-top`)
- **What:** `TimelineWatchView` keeps its sticky player at `top: var(--timeline-watch-top, 0px)` (`bg-[var(--tl-bg)]`), preserves the single-column `contentTop` tab-scroll calculation (`stickyTop + player.getBoundingClientRect().height`), and lets `App.tsx`'s `<main>` own scrolling.
- **Why:** Missing `--timeline-watch-top` clearance or moving scroll into nested panels breaks scroll restoration, hides `Related videos` / `Comments` tabs under the sticky player, or creates double scrollbars.
- **Rule:** Keep `<main>` as the sole scroll owner; never wrap `TimelineWatchView` or cards in `overflow: auto` containers that trap `position: sticky`. In full Theater Mode (`T`), unstick or bound max player height to `min(78dvh, 720px)` so below-the-fold details remain reachable.

### 6. Stream Continuity, `hls.js`, Safari Native & Safe Renewals (`useUniversalVideoEngine`)
- **What:** One shared state machine manages direct MP4, proxied `/api/proxy-video-stream`, `hls.js` MSE streams (Desktop Chrome/Edge/Firefox/WebView2), and native HLS fallback (`canPlayType('application/vnd.apple.mpegurl')` on iOS/macOS Safari).
- **Why:** Rewriting playback per view previously lost resume times during `playbackHandoff`, triggered infinite renewal loops on expired signed URLs, or broke relative-URL deduplication when switching React state.
- **Rule:**
  - Increment `playbackGenerationRef.current` on source/quality/renewal transitions and drop stale async promises (`qualities`, `renew-stream`) whose generation mismatches.
  - Normalize relative vs absolute stream URLs (`loadedSrcRef.current === nextUrl`) before reassigning `<video>.src` so unrelated re-renders never flicker or reset buffered frames.
  - Preserve `capturePlaybackSnapshot()` handoff across `Feed Card <-> TimelineWatchView <-> VideoPlayerModal <-> FloatingMiniPlayer` (preserving `currentTime`, `playbackRate`, `isMuted`, `selectedQuality`, `masterHlsUrl`, `qualities`).
  - Keep startup timeout (`20s`) + max 1 auto-renewal attempt per source + `pickFallbackStreamCandidate` (<= 720p progressive/HLS fallback ladder).

### 7. Floating Mini-Player, Edge-Stash & External OS PiP Boundaries
- **What:** `useMiniPlayerStore` + `<FloatingMiniPlayer />` persists active playback cleanly when navigating across app views (`Profile Hub <-> Albums <-> Videos <-> Settings`), with modern floating ergonomics AND honest OS Picture-in-Picture bridging.
- **Architecture Split (CRITICAL — Browser/OS Security Boundary):**
  1. **Inside App Viewport (DOM Overlay):**
     - Supports free pointer drag (`clampMiniPlayerPosition` inside viewport minus safe-area insets), `S / M / L` corner resize, swipe-to-dismiss, queue `Prev / Next`, `-10s / +10s`, seek bar, mute toggle, and 1-tap `Expand` back to Watch View or `VideoPlayerModal` with zero stream reload (`playbackHandoff`).
     - **In-App Edge-Stash (Lateral Screen Dock):** Dragging within `28px` of the left or right viewport border—or tapping the dock-aside chevron—snaps the player off to the screen side, collapsing into a compact edge handle (`~28–36px` visible tab with glowing audio indicator, play/pause toggle or quick chevron to slide back out) while audio/media continues smoothly.
     - **`MiniTaskDock` Collision Contract:** `MiniTaskDock.tsx` occupies bottom-right (`z-40`). `FloatingMiniPlayer` MUST read `--mini-task-dock-height` (or `MiniTaskDock` visibility/expanded state) and default its bottom margin above the active task dock (or snap to opposite side / top-right corner when dock expands on mobile), preventing overlapping floating cards. Z-index hierarchy: `FloatingMiniPlayer (z-45)` sits **above** `MiniTaskDock (z-40)` **below** `VideoPlayerModal` / `AppDialog` / `PhotoLightboxModal` (`z-50+`), and hides automatically while the same media is open in full `Watch` / `VideoPlayerModal` / active `ShortsView`.
  2. **Leaving the App / Switching Browser Tabs (External OS PiP — Sandboxed Web Reality):**
     - Standard web DOM elements **cannot** float over other OS applications or slide onto the physical phone screen edge outside the browser/WebView frame. **Never attempt undocumented host/OS window hacks.**
     - Instead, `<FloatingMiniPlayer />` delegates OS-level "hide to side of screen outside the app" to standard browser/OS PiP (`useExternalPictureInPicture.ts`):
       - **Desktop Chromium / Edge / pywebview (WebView2 >= 116) & Firefox (>= 151) over HTTPS or `localhost`:** Prefer **Document Picture-in-Picture (`window.documentPictureInPicture.requestWindow()`)** to launch a true OS always-on-top window carrying the app's themed controls (`Prev`, `-10s`, `Play/Pause`, `+10s`, `Next`, scrubber, `Return to App`).
       - **Safari macOS, iOS 13.4+ Safari, Android Chrome & Fallback Runtimes:** Use Classic Element PiP (`video.requestPictureInPicture()` / WebKit `webkitSetPresentationMode('picture-in-picture')`). On **iOS and Android**, native OS PiP automatically lets the user drag and **stash/hide the floating video to the left/right screen edge** while background audio continues—matching YouTube Mobile OS behavior.
       - **Auto-PiP on App/Tab Switch:** Register `navigator.mediaSession.setActionHandler('enterpictureinpicture', ...)` behind an explicit user setting (`autoPipOnTabSwitch`, Chromium desktop `enterpictureinpicture` support check). Always expose an explicit manual PiP button as fallback where mobile browsers forbid background Auto-PiP without a fresh gesture.

### 8. Visual Themes (`--tl-*`), Ambient Glow, Reduced Motion & 100% i18n
- **What:** Every UI control outside the dark video frame (`rgba(15,23,42,0.78)` scrim inside player canvas uses crisp white WCAG `>= 4.5:1` foreground) consumes `--tl-*` tokens across all 5 themes (`dark-slate`, `deep-oled`, `clean-light`, `cyber-studio`, `hub-violet`).
- **Why:** Hardcoded slate/violet colors break `theme-clean-light` readability; unbounded blur loops cause thermal throttling on phones.
- **Rule:**
  - **Ambient Glow (opt-out toggle in settings):** When enabled on desktop theater/portrait (`9:16`) videos, sample downsampled canvas (`16×9px` throttled to `<= 4fps`) or static poster blurred gradient. Automatically disabled when `prefers-reduced-motion: reduce`, `settings.disableAllAnimations`, or `theme-clean-light` subtle limit applies.
  - **100% i18n:** Zero hardcoded Portuguese or English strings in player components, stores, or error boundaries (`translations.ts` `player.*` namespace for both `pt-BR` and `en-US`, compiled cleanly with `tsc --noEmit`).

### 9. Existing Regression Test Contracts (`scripts/test_*.cjs`)
- **What:** Several repo tests inspect source ASTs / SSR markup of `TimelinePostCard.tsx`, `TimelineWatchView.tsx`, and `ShortsView.tsx`:
  - `scripts/test_timeline_player_lifecycle.cjs`
  - `scripts/test_timeline_menu_dismissal.cjs`
  - `scripts/test_timeline_review_fixes.cjs`
  - `scripts/test_timeline_watch_ux.cjs`
  - `scripts/test_profile_hub_engagement.cjs`
  - `scripts/test_shorts_playback.cjs`
- **Rule:** When refactoring internals into `components/video-player/engine/`, **keep every regression scenario green**: migrate AST assertions cleanly if callback homes move to `engine/` (never delete coverage silently!), preserve `data-watch-*` structural hooks and `<SourceAvatar />` contracts, and verify with `node scripts/test_*.cjs` + live **Browser UI Verifier** across Desktop (`1440×900`) and Mobile (`390×844`) after every visual edit.


---

## 10. Timeline Autoplay, Preload & Feed-to-Watch Parity Contract (Zero Breakage Guarantee)

Refactoring inline feed playback in `TimelinePostCard.tsx` and inline cinema in `TimelineWatchView.tsx` onto `<UniversalVideoPlayer />` MUST preserve **100% behavioral parity** with the existing working Timeline system:

1. **Single-Active Autoplay Mutual Exclusion (`activeAutoplayPostId`):**
   - `ProfileTimelineView.tsx` enforces at most one active feed video via `activeAutoplayPostId`. `<UniversalVideoPlayer density="card" />` MUST never start independent feed autoplay unless driven by `isAutoplayActive` (`activeAutoplayPostId === post.id`) or explicit inline user interaction.
2. **Deterministic 7-Event State Machine (`computeAutoplayTransition` in `timelineModel.ts`):**
   - Every feed video state transition (`hover_enter`, `hover_leave`, `viewport_enter`, `viewport_leave`, `video_click`, `toggle_mute`, `pause_external`) remains owned by `computeAutoplayTransition`:
     - `hover_enter` & `viewport_enter`: start playback (`isPlaying: true`, `isAutoplayPreview: true`) strictly with `isMuted: true` and `showControls: false`.
     - `hover_leave`: pauses playback ONLY when `!hasUserClickedVideo`.
     - First `video_click` during preview: reveals controls (`showControls: true`, `hasUserClickedVideo: true`), keeps playing, and preserves `isMuted: true` until user explicitly presses mute toggle; second `video_click` with controls open toggles pause.
     - `viewport_leave`: resets to paused + `showControls: false` + `isMuted: true`.
3. **Mobile Viewport Intersection Thresholds (`TimelinePostCard.tsx`):**
   - Preserve `IntersectionObserver` with `threshold: [0, 0.15, 0.35, 0.6, 0.85]`: entering `>= 0.35` on coarse/touch screens activates `setActiveAutoplayPostId(post.id)` + `'viewport_enter'`; dropping below `0.15` dispatches `'viewport_leave'`.
4. **Idle Metadata Preloading (`TimelinePostCard.tsx`):**
   - Preserve silent muted `preload = 'metadata'` warmup when `!isPlaying && !playbackError && (isNextInQueue || isCardHovered) && !isWatchPageOnlyUrl(post.videoUrl)`, skipping HLS URLs so feed scrolling never wastes segment bandwidth.
5. **Passive Mobile Audio/Gesture Unlock (`TimelinePostCard.tsx`):**
   - Keep `window.addEventListener('touchstart', unlockOnTouch, { once: true, passive: true })` intact.
6. **Deep-Link Auto-Start & `suspended` Stream Release (`TimelinePostCard.tsx`):**
   - Preserve `autoStartWithControls` (`setActiveAutoplayPostId(post.id)` + `'video_click'` + `isMuted: false`).
   - Preserve `suspended` cleanup on Watch transition/unmount: save `pendingResumeTimeRef.current = video.currentTime`, pause, strip `src`, abort `qualitiesRequestRef`, destroy `hlsRef`, and dispatch `'viewport_leave'`.
7. **Accessible Target Separation Without Regressing Navigation or Controls:**
   - Replace nested `<div role="button">` wrappers with `<div data-video-surface>` while keeping exact click semantics: clicking unmasked card surface in Feed invokes `onOpenVideo(post, handoff)` passing `{ currentTime, isMuted, isPlaying: true, selectedQuality, qualities, masterHlsUrl, sourceRect }` and suspends the card stream; inline controls call `stopPropagation()` and stay inline; `watchPresentation` never opens another Watch view.

---

## 11. Motion, Animation & React Performance Governance

Every animation inside `<UniversalVideoPlayer />` and `<FloatingMiniPlayer />` MUST combine the app's existing `motionConfig.ts` / `index.css` preferences with Web Platform & React performance guarantees:

1. **Motion Settings & Accessibility Gate (`motionConfig.ts` + `prefers-reduced-motion`):**
   - Respect `disableAllAnimations`, `animationSpeed` (`--anim-speed-duration`: `180/250/350/500ms`), `animationDistance`, `videoPlayerAnimation` (`'zoom' | 'fade' | 'slide-up' | 'none'`), and `fullscreenAnimation` (`'elastic' | 'smooth' | 'instant' | 'none'`).
   - Under `@media (prefers-reduced-motion: reduce)` or `disableAllAnimations`: cancel springs, ripples, ambient glow, staggers, and `view-transition` transforms, falling back to brief opacity cues (`<= 150ms`).
2. **Compositor-Only Property Rule:**
   - Animate **only** GPU-composited `transform` (`translate`, `scale`, `rotate`), `opacity`, and wrapper transforms around SVGs. Never animate `width`, `height`, `top`, `left`, or layout geometry during scrubbing, dragging, buffering, or Edge-Stash motion.
3. **Physics-Based Springs (`linear(...)` + Fallback):**
   - Apply `linear(...)` spring/overshoot curves (matching `index.css`'s `.heart-pop` pattern) strictly to `transform`/`scale`/`rotate` on micro-interactions (`2x >>` hold badge, double-tap `±10s` seek halo, mini-player corner snap, Edge-Stash tab pop) with **explicit durations** and `@supports not (animation-timing-function: linear(0, 1))` fallback `cubic-bezier(0.34, 1.56, 0.64, 1)`.
   - Never apply overshoot `linear(...)` curves to `opacity` (avoids alpha clamping flicker).
4. **Discrete Popover / Bottom Sheet / Dialog Exit Transitions (`@starting-style` + Firefox Bug `1882408` Guard):**
   - Entry transitions use `@starting-style` + standalone `transition-behavior: allow-discrete` (never shorthand).
   - Provide runtime `canTransitionDisplay()` capability detection in `playerMotion.ts`: when top-layer/display exit transition is unsupported or hits Firefox Bug `1882408`, fall back to `[data-closing="true"]` class transitions awaited via `Promise.allSettled(el.getAnimations().map((a) => a.finished))` capped by a `2000ms` failsafe timeout.
5. **Intrinsic Width/Height Reveals (`interpolate-size: allow-keywords` / `calc-size()`):**
   - Desktop hover/focus Volume slider drawer uses progressive `interpolate-size: allow-keywords` / `calc-size(auto, size)` width reveal with instant reveal fallback on unsupported browsers.
6. **Card-to-Watch & Mini-to-Watch Morph (`startViewTransition`):**
   - Wrap transitions with feature-detected `document.startViewTransition()` / element `startViewTransition()`, assign temporary `view-transition-name` only during handoff, attach `.ready.catch(() => {})`, strip `view-transition-name` inside `.finished.finally(...)`, and call `.focus({ preventScroll: true })` on the destination player surface.
7. **Zero-Jank React Performance Rules (`vercel-react-best-practices` alignment):**
   - **Transient 60fps State in `useRef`:** Scrubber drag progress (`--uvp-progress`), hover preview coordinates (`--uvp-hover-x`), and mini-player drag offsets (`--fmp-x`, `--fmp-y`) write CSS variables directly via `ref` + `requestAnimationFrame` — never trigger `useState` ticks at 60fps.
   - **Passive Event Listeners:** Attach scroll/touch gesture listeners (`touchstart` unlock, vertical pan detection) with `{ passive: true }`.
   - **Derived Autoplay Boolean & Lazy Secondary UI:** Feed cards receive boolean `isAutoplayActive` (never broad playback stores), and secondary overlays (`PlayerShortcutsDialog`, Document PiP portal) stay lazily loaded.
