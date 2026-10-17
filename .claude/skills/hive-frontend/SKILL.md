---
name: hive-frontend
description: Load before writing or reviewing ANY HTML/CSS/JS for Hive's landing page or dashboard. Enforces the warm-paper + honey design system and the anti-slop rules. Triggers - landing page, dashboard, UI, CSS, styling, front-end, design review.
---

# Hive frontend rules (condensed from docs/DESIGN.md — read that file for full specs)

1. Tokens only — never hardcode colors. `--paper #FDFCF7 · --ink #16150F · --ink-2 #6F6A5C · --line #EBE6DA · --honey #F5B800 · --honey-deep #D99E00 · --honey-wash #FDF3D8 · --dark #141310 · --dark-ink #F7F6F2 · --ok #3A9B5C · --ease cubic-bezier(0.2,0,0,1)`.
2. **Yellow rule:** `--honey` never as text on light backgrounds. Fills/badges/highlights only, ink text on top.
3. Fonts: Space Grotesk (display, -0.03em tracking) · Inter (body, font-feature-settings "cv01","ss03") · JetBrains Mono (feed/counters/keys/eyebrows). No fourth font.
4. **Hexagon ration — three uses only:** logo/favicon, 4–6% opacity hero lattice, clip-path avatars. Nothing else, ever. No 3D/glowing/gradient hexes.
5. Motion: one easing `var(--ease)`, 150–250ms; only live data animates continuously; honor `prefers-reduced-motion`.
6. Buttons: honey pill primary (ink text) or ghost secondary (1px `--line`). Nothing else.
7. Banned: AI gradients, glassmorphism, emoji in UI copy, stock illustrations, lorem ipsum, dead nav links, heavy shadows, framework-default blue.
8. After any UI change: check it at 1280px AND phone width (16px gutters, no horizontal scroll), verify against docs/DESIGN.md's anti-slop checklist, and confirm the dashboard stays legible from 3m (feed mono ≥14px).
