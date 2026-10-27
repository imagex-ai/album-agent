---
version: alpha
name: IMAGEX.AI
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

# IMAGEX.AI visual contract

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
