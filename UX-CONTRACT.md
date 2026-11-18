# IMAGEX performance and interaction contract

Source: user-approved performance remedies, existing gallery/scraper workflows,
`PROJECT_RULES.md`, the types/store and server API. This document records the
observable consequences, without changing media detection or lifecycle policy.

| Capability | Canonical owner | Contract | Verification |
|---|---|---|---|
| Collection windowing | `components/common/VirtualCollection.tsx` | Same card markup/columns/gaps; only nearby rows mounted; focus, playing cards and menu anchors retained | Node geometry tests and real-browser checks |
| Selection | `store/useAppStore.ts` existing selection actions | Select-all uses the complete filtered collection, including offscreen items | Existing library tests and browser checks |
| Classification | `utils/mediaClassification.ts` | Preserve photo/GIF/video and animated-video transport semantics; invalidate summaries when media arrays change | `scripts/test_media_classification.cjs` |
| Saved badges | `services/savedMediaLookup.ts`, store optimistic registry | Preserve first-match order, URL/title matching, folders, alternate resolution and optimistic updates | `scripts/test_performance_contracts.cjs` |
| Loading and refresh | `services/realApi.ts`, store sync actions | Complete records remain available to Shorts/slider/export; bounded mapping yields to input; failures preserve current data; concurrent completions queue another refresh | Frontend/API tests |
| Progress and persistence | Store polling/SSE, `services/deferredStorage.ts` | Progress stays live; unchanged snapshots do not republish; delayed persistence flushes on page exit; explicit clearing cancels pending writes | State tests |
| Scroll and navigation | `services/scrollRestoration.ts`, `hooks/useScrollRestoration.ts` | Main is the scroll owner; return to tabs retains position; redirect badges locate offscreen items | Existing scroll tests and browser checks |
| Locale, theme and feedback | Existing translations, CSS/Tailwind theme, notifications, `ModalPortal` | Mandatory 100% pt-BR/en-US parity for all UI text/notifications/toasts; zero single-language hardcoded strings; current themes, messages, empty/error states and modal outcomes preserved | Typecheck/build, i18n string audit and browser comparison |

The API retains the legacy full-list response. Cursor pagination returns complete
album records; its optional image-limit parameter applies only when explicitly
requested. The current app does not silently truncate media for full-library
consumers. Pagination invalidation must not consume a newly completed extraction
without eventually refreshing it. Failed fetches must not clear the library or
prevent task tracking from initializing.

`PROJECT_RULES.md` governs the frozen Smart Shorts/highlight implementation.
Deletion, export, upload, folder operations and their confirmation behavior are
unchanged. This work does not create permissions or change retention policy.

## Canonical UI map

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
|---|---|---|---|---|
| Table Selection | Existing store selection actions | Full filtered dataset, including offscreen items | Albums / videos | Library action and performance tests; browser |
| Select/Listbox | Existing native select controls | Platform-owned popup behavior, including directory/review selects | Native | Render/model checks; open-popup browser matrix remains unverified |
| Scrollbar | Existing `src/index.css` in frontend-mobile-preview | Runtime theme; unrelated legacy exceptions are not newly endorsed | Main / existing horizontal folder strips | Desktop/mobile scrolling |
| Toast | Store notifications and NotificationDrawer | Existing translated notifications | Existing success/info/error | Library action tests |


## Profile Hub navigation and selection

| Capability | Canonical owner | Contract | Verification |
|---|---|---|---|
| Profile sessions/global selection | `store/useProfileHubStore.ts` | Source-bound session data, filters, collection caches and all selection kinds; global groups/totals; separate video/gallery destinations; no automatic execution | `scripts/test_profile_hub_store.cjs`, `scripts/test_profile_hub_scan_transition.cjs` |
| Directory session | `store/useProfileDirectoryStore.ts` | Cache by remote query/page; stable-key deduplication; local search/order/view/display-page retained separately | `scripts/test_profile_hub_store.cjs` |
| Internal Hub history | `services/profileHubNavigation.ts`, `profileHubRuntime.ts`, App hash handler | Opaque local context; actual visited path; restore without pushing another entry; direct profile entry never creates a directory | `scripts/test_profile_hub_store.cjs` |
| Single URL input | `services/profileDirectoryApi.ts`, `/api/profile-directory/resolve` | Installed adapters recognize supported directories/profiles; legacy scans retain their existing validation path; no deep scan for a recognized directory | Client, transition and isolated endpoint tests |
| Profile source icon | `ProfileSourceLabel`, `/api/profile-directory/site-icon` | Tabs and quick favorites use only the profile origin; failures retain a neutral indicator, demos do not invent a source, and inactive Hub views start no new icon requests. Generic discovery reads a bounded HTML prefix, resolves HTML bases and validates TLS using maintained and system trust roots | `scripts/test_profile_source_label.cjs`, `tests/test_profile_site_icon_service.py`, isolated live-origin and browser checks; real-browser inspection at 1249/390/320 px in the current dark theme; matched-fixture and other-theme comparison pending |
| Contextual scroll | Existing scroll service/hook | Main remains scroll owner; Hub route key precedes generic tab/view offsets; other modules retain existing behavior | Model tests; browser/visual checks not performed at user request |
| Multisource execution guard | FloatingActionBar/Hub handlers and ProfileReviewPage | Global totals and real-profile Save open grouped review; only explicit confirmation dispatches the immutable snapshot; compatible active-profile ZIP retains its existing confirmation | Review/execution/state/transition tests and typecheck |

User constraints for this stage: no agents and no browser. Independent-agent and
browser checks were intentionally not performed; unit checks and build do not
claim visual, focus or cross-device approval.


## Directory presentation and local shortcuts

| Capability | Canonical owner | Contract | Evidence |
|---|---|---|---|
| Catalog/filter projection | `ProfileDirectoryPanel.tsx`, `profileDirectoryModel.ts` | Source pages remain distinct from local 50-item pages; local search/sort scope explicit, null distinct from zero | model/render tests; one desktop capture |
| Profile entry | Existing Hub `openHubUrl` | One input and service path for direct URLs and card/shortcut opening; no deep profile scan while listing | transition/client tests |
| History/Favorites | `useProfileDirectoryLibraryStore.ts`, `deferredStorage.ts` | Device-local metadata only; bounded history/favorites; storage errors preserve memory; clearing history preserves favorites/selection/library | library/performance tests |
| Catalog overlays | `DirectoryControls.tsx`, `ModalPortal` | Native disclosure and modal dialog, app labels/geometry, Escape and trigger-focus restoration; no native alert/confirm calls | code/render checks; overlay runtime matrix not run |
| Source navigation | Directory adapter capabilities | First-page/all/letter/category URLs and form choices supplied by source adapter; existing remote query retained on A–Z | Python parser tests |
| Navigation checkpoint | Existing Hub navigator/runtime | Save presentation/scroll before cache commits; restore snapshots without pushing entries; cancel superseded/background work | model/session/transition tests |

Validation constraint: one quick browser visit and one capture only, no agents.
The full accessibility/mobile/theme/browser interaction matrix remains unevaluated;
no compliance claim is inferred from the static audit or code tests.

## Approved multi-profile review

Source: the user's approved review proposal and requirements in this conversation,
01/11/2026. Stage 4 implements review, selection editing and destination drafts;
the separately authorized Stage 5 adds the confirmed execution below. No save/export API is called by
entering review, switching selections or choosing a destination.

| Capability | Canonical owner | Contract | Evidence |
|---|---|---|---|
| Review selection | useProfileHubStore, profileHubReviewModel | Composite profile/type/ID identity; unchecking keeps a candidate for rechecking; remove/undo and clear preserve other profiles, caches and destinations | test_profile_hub_review.cjs |
| Coverage | profileHubReviewModel | Album membership by collection ID; playlist membership by collection ID or loaded session map; raw child selections are retained and reappear when the collection is deselected | Review/store tests |
| Review navigation | Existing hubNavigation/runtime | Review is an opaque internal route; visiting a profile and Back restore the actual path and scroll without fabricating a directory | Navigation/store tests |
| Destination configuration | FolderSelectModal, purpose=destination | Separate video/album domain lists; per-profile fields; new folders are drafts, no media calls or global-default mutation; video Web Stream/download choice is explicit | Review render and isolated production-handler tests |
| Modal behavior | AppDialog + ModalPortal | Native modal focus containment/inert background, Escape, title/description and connected trigger restoration; clear initially focuses Keep selection | Source/SSR; real-browser focus matrix not run |
| Global bar | ProfileHubSelectionBar + FloatingActionBar review variant | All real profiles counted; bar aligned with App main; clear requires confirmation and preserves destinations | Render/state tests; layout not browser-verified |
| Long groups | Existing Hub store reviewDisplayLimits | Show 12 candidates per media section initially; explicit increments of 12, independently preserved; selection/counts still use the complete group | Review/render tests |
| Confirmation | ProfileReviewPage, ProfileExecutionPanel, useProfileHubExecutionStore | Required domain/mode errors prevent submission; explicit Confirm snapshots all real origins and destinations, prevents duplicate activation and starts the verified executor | Render, execution-store and endpoint tests |

Sessions, selection candidates and destination drafts remain in memory across
navigation; they are not promised across application restart. Confirmed execution
is journaled separately. Browser and independent-agent checks remain excluded by
the user's instructions. Real-profile Save routes to review for videos, playlists,
albums and individual supported media. Legacy ZIP retains its compatibility
guards and explicit confirmation. The old album batch-save rejects unsupported
requests before touching storage rather than counting unsaved albums as saved.

## Confirmed multi-profile execution

Source: user authorization to continue Stage 5 on 01/11/2026, approved review
proposal, and the maintained API/domain contract `docs/profile-hub-execution.md`.

| Capability | Canonical owner | Observable contract | Evidence |
|---|---|---|---|
| Immutable confirmation | useProfileHubExecutionStore, ExecutionCoordinator | One nonce/body; independent profile/type/mode/destination; later live edits apply to a new batch; selections are not cleared as a side effect | test_profile_hub_execution.cjs, test_profile_hub_execution.py |
| Unknown outcome | profileHubExecutionApi, execution store | Timeout/malformed response preserves exact snapshot and nonce; GET or explicit same-confirmation resend; no silent new batch | Client/API tests |
| Recovery | SQLite ExecutionRepository, existing deferredStorage | Only opaque batch UUID in browser storage; return/restore does GET only; interrupted server work requires explicit retry after ownership lease expiry | Restart/client/coordinator tests |
| Task progress | Existing workers/job queue, ProfileExecutionPanel | Real completion/readback, measured bytes only; failed children remain visible with their source; slow collection resolution does not hold ready work | Runtime/coordinator/SSR tests |
| Execution capacity | ProfileExecutionSlots in ExecutionCoordinator | Two simultaneous units globally; prefer waiting profiles with fewer active units, rotate ties, never preempt running work; one profile can use otherwise idle capacity; cancel releases its reservation | Isolated fairness/cancellation tests |
| Active indicator and count failure | ProfileExecutionPanel, executionErrorText, source adapter | Running/resolving visibly rotate unless reduced motion is requested; count mismatch shows exact reported/found/pages evidence; no silent partial extraction or fabricated missing items | Count evidence, SSR and isolated Chrome/CSS checks |
| Partial failure and retry | ExecutionCoordinator, queue relaunch branch | Retry failed/interrupted units or unresolved roots only; successful siblings and completed overlap are retained; retry nonce handles lost acknowledgement | Endpoint/state/runtime and existing-worker regression tests |
| Domain destinations | Existing FolderSelectModal and video/gallery storage | Video filesystem names and gallery logical labels validated separately; explicit Web Stream/download for videos; gallery keeps existing remote-original album semantics | Destination/runtime tests |
| Collections and selected originals | ExecutionSources, existing gallery resolver and shared collection parsers | Eporner first; bounded discovered pagination; incomplete source fails visibly; individual selection resolves only matching originals, never neighbors | Source/subset/parser tests |
| Tracking and further selection | ProfileHubSelectionBar, ProfileReviewPage | Continue navigating/editing selections while the confirmed snapshot stays fixed; tracking bar available even with no live selection; New review preserves choices and is disabled for active/uncertain work | Store/render tests and typecheck |

No actual user library extraction or live-source round trip was performed during
verification. Static/SSR checks do not establish pixel fidelity, keyboard behavior
or a complete accessibility/theme/mobile matrix.

## Profile Hub progressive loading — 2026-11-02

| Capability | Canonical owner | Observable contract | Evidence |
|---|---|---|---|
| Initial profile delivery | Existing Hub scanner, `scan-stream`, `openHubUrl` | First real page opens before deep catalog discovery; pending totals stay unknown; completion updates the same route/session | `test_profile_hub_performance.py`, `test_profile_hub_performance_api.cjs`, `test_profile_hub_scan_transition.cjs` |
| Cache navigation | Existing Hub sessions and collection maps | Known profiles render before resolver work; incomplete discovery resumes; fresh complete collections including empty results reuse data for five minutes | Transition and performance-store tests |
| Metadata processing | Existing Hub API and store | Up to eight ready items or 16 ms per delivery; one transaction per batch; unchanged collections preserve identity; cancelled or stale responses do not publish | Performance API/store and transition tests |

These changes do not dispatch save/export actions. Visual markup, theme and
existing focus/scroll owners remain unchanged. No auxiliary agent or live
personal-library test was used. The static audit records unrelated existing UI
findings in `scratch/profile-hub-performance-ui-audit.json`.

## Universal Video Player & Floating Mini-Player Contract

| Capability | Canonical owner | Observable contract | Evidence |
|---|---|---|---|
| Non-nested card semantics | `UniversalVideoPlayer`, `TimelinePostCard` | Media surface uses `<div data-video-surface>` without `role="button"` wrapping child `<button>` controls; feed card play never hijacks watch navigation | `docs/video-player-architecture.md`, `test_video_player_architecture.cjs` |
| Escape & overlay stack | `playerOverlayStack.ts` | Capture-phase `Escape` closes only top-most layer (`Menu > Sheet > Shortcuts > Fullscreen > Watch > Modal > Mini-Player`) with `stopImmediatePropagation()` and focus restore | `test_timeline_menu_dismissal.cjs`, Browser UI Verifier |
| Touch scroll & gestures | `usePlayerGestures.ts` | Inline surfaces keep `touch-action: pan-y`; `350ms` hold-`2x` cancels at `>10px` move; left/right double-tap accumulates `±10s` (`450ms`); scrubber supports vertical fine-scrub (`0.5x`/`0.25x`) | Gesture unit & pointer tests |
| Responsive bar & auto-hide | `PlayerControlBar`, `PlayerSettingsSheet`, `usePlayerControlsAutoHide` | Auto-hide (`2500ms`) pauses on menu/scrub/hover/focus/pause; `0px` horizontal overflow at `390px`; non-wrapping time display; `>=44×44px` coarse hit areas | Browser UI Verifier (`390×844` & `1440×900`) |
| Floating Mini-Player & OS PiP | `FloatingMiniPlayer`, `useMiniPlayerStore`, `useExternalPictureInPicture` | Drag, swipe dismiss, resize, queue Prev/Next, stream-preserving Expand (`playbackHandoff`), `MiniTaskDock` clearance (`z-45` vs `z-40`), in-app screen-edge stash handle, plus Document/Classic/Auto-PiP when leaving the app | Mini-player clamp/stash & PiP tests |
| Frozen highlights & 100% i18n | `VideoPlayerModal`, `translations.ts` | `ShortsView`, `smart_shorts_detector.py`, and `VideoPlayerModal` highlight notches + `⚡ Clímax` remain intact via extension slots; zero hardcoded PT/EN strings (`pt-BR` & `en-US`) | `test_shorts_playback.cjs`, i18n scan, `tsc --noEmit` |

### Contrato Adicional: Preservação Total de Autoplay da Timeline & Comportamento de Animações
- **Timeline Feed Parity (Zero Regressão):** `<UniversalVideoPlayer density="card" />` e `TimelinePostCard.tsx` DEVEM manter idênticos: exclusão mútua global (`activeAutoplayPostId`), máquina de 7 eventos `computeAutoplayTransition` (`hover_enter/leave`, `viewport_enter/leave` em `0.35`/`0.15`, `video_click` mantendo mudo até toggle explícito, `toggle_mute`, `pause_external`), pré-carga `metadata` no próximo item/hover sem baixar HLS, `touchstart` passivo mobile, `autoStartWithControls`, suspensão imediata de stream (`suspended`) e abertura para `TimelineWatchView` com `playbackHandoff` + `sourceRect` em contínuo 60fps.
- **Acessibilidade & Resposta Tátil:** Animações do player (abertura de modal/Watch, Morph `startViewTransition`, double-tap `±10s`, hold `2x >>`, slide/stash lateral `<= 28px`, Bottom Sheet `@starting-style` com fallback `[data-closing]`) obedecem integralmente a `disableAllAnimations` nas configurações do app e a `@media (prefers-reduced-motion: reduce)`, mantendo feedback visual funcional imediato em no máximo `150ms` e deslocamento/foco acessível após cada transição.
