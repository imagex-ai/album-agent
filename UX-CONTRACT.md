# IMAGEX.AI performance and interaction contract

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
| Locale, theme and feedback | Existing translations, CSS/Tailwind theme, notifications, `ModalPortal` | Keep pt-BR/en-US, current themes, messages, empty/error states and modal outcomes | Typecheck/build and browser comparison |

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
| Select/Listbox | Existing native select controls | Established platform popup behavior; no new select controls in this work | Native | Existing gallery and mobile browser checks |
| Scrollbar | Existing `src/index.css` in frontend-mobile-preview | Runtime theme; unrelated legacy exceptions are not newly endorsed | Main / existing horizontal folder strips | Desktop/mobile scrolling |
| Toast | Store notifications and NotificationDrawer | Existing translated notifications | Existing success/info/error | Library action tests |
