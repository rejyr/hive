# Hive Design System — "Warm Paper + Honey Ink"

Every AI-infra site is dark. Hive is a warm near-white page with dark ink and one honey accent — distinctive on a projector in a bright ballroom. The dashboard alone sits in a dark band so the live data pops.

## Brand

- **Logo:** a single flat-top hexagon outline (2px stroke, ink) beside the wordmark "Hive" in Space Grotesk 700. The hex alone is the favicon. Draw it as inline SVG.
- **Voice: subtle.** Permitted bee vocabulary, exhaustively: the name "Hive", "the Queen" (orchestrator), and the CTA "Join the hive". No other bee/swarm/honey puns anywhere in UI copy.
- **H1 (exact):** Your team's agents, finally working as a team.
- Sub-line (reference): "Every teammate's agent shares one live memory. The Queen keeps the team in sync."

## Tokens — define once in `:root`, use everywhere

```css
:root {
  --paper: #FDFCF7;      /* page background */
  --surface: #FFFFFF;    /* cards */
  --ink: #16150F;        /* primary text */
  --ink-2: #6F6A5C;      /* secondary text */
  --line: #EBE6DA;       /* hairline borders */
  --honey: #F5B800;      /* THE accent */
  --honey-deep: #D99E00; /* hover, strokes on yellow */
  --honey-wash: #FDF3D8; /* tinted backgrounds, selected states */
  --dark: #141310;       /* dashboard band bg */
  --dark-ink: #F7F6F2;   /* text on dark */
  --ok: #3A9B5C;         /* DEDUPE / prevented-duplicate green */
  --radius: 10px; --radius-sm: 6px;
  --ease: cubic-bezier(0.2, 0, 0, 1);
}
```

**The yellow rule (non-negotiable):** `--honey` is never text on a light background (contrast failure). It appears only as fills, badges, underlines, counter highlights, and glows — always with ink text on top.

## Type

- **Display:** Space Grotesk 500/700. H1 `clamp(40px, 7vw, 72px)`, letter-spacing `-0.03em`, line-height 1.05.
- **Body/UI:** Inter, 16px/1.6, `font-feature-settings: "cv01","ss03"`.
- **Mono:** JetBrains Mono — feed rows, timestamps, counters, memory keys, and uppercase eyebrow labels (11px, letter-spacing `+0.08em`).
- Load all three from Google Fonts with one `<link>`. No other fonts, no local font files.

## Layout

- Landing max-width 1080px; hero text block max 720px, centered; 16px minimum side gutters; hero top padding ~120px. Must work at phone width with no horizontal scroll.
- Section order: Hero → Live dashboard band (dark) → three feature rows (shared context · duplicate prevention · "where are we?") → How it works (3 steps: add one MCP line → work normally → stay in sync) → footer (GitHub link, built-at line).
- Buttons: primary = honey pill, ink text, `--radius` full; secondary = ghost with 1px `--line` border. No other button styles.

## The hexagon ration — exactly three uses

1. **Logo/favicon** (above).
2. **Hero background lattice:** 1px-stroke hexagonal grid, ink at 4–6% opacity, fading out radially (SVG pattern + CSS mask). Barely visible texture, not a graphic.
3. **Agent avatars:** CSS `clip-path` hexagons with a 2px per-agent color ring (active) / gray ring (idle).

Anywhere else: **no hexagons.** Banned outright: 3D hexes, glowing hexes, gradient-filled honeycomb walls, hexagon section dividers.

## Dashboard spec (`/live`, and embedded as the landing's dark band)

Background `--dark`, text `--dark-ink`, same three fonts. It must read as a **work tool** — a beautiful git log, not a visualization art piece. Legible from 3 meters: feed mono ≥14px, everything else ≥16px.

- **Top bar:** hex avatar stack (one per connected agent, colored ring while active) · connection-status dot · three mono counters: `3 agents · 42 items shared · 5 duplicates prevented` — the last counter rendered in `--honey`.
- **Feed (left, ~55%):** one row per event: hex avatar · verb badge · title · mono key · relative timestamp. Verb badges: `SHARE` filled honey/ink text · `RECALL` outlined honey · `CLAIM` outlined honey · `DEDUPE` filled `--ok`/white text · `QUEEN` outlined white. New rows slide in from top, 200ms `var(--ease)`; cap ~10 visible.
- **Side panel (right, ~45%):** "Where are we?" card — the Queen's latest synthesis, mono timestamp, refresh button.

## Motion

One easing (`var(--ease)`), durations 150–250ms, pulses ≤1.2s. The **only continuous animation is live data** (new rows, counter ticks) — stillness everywhere else is what reads as quality. Respect `prefers-reduced-motion` (disable slides/pulses). No scroll-jacking, no parallax, no autoplaying hero video.

## Anti-slop checklist — reject any change that introduces:

- Purple/blue "AI gradients", mesh gradients, glassmorphism, aurora backgrounds
- Emoji or exclamation marks in UI copy
- Stock illustrations, 3D blobs, robot/brain imagery
- A fourth hexagon use (see ration)
- Yellow text on light backgrounds; centered body paragraphs; any fourth font
- Framework-default blue (#3B82F6), default focus rings left unstyled, inconsistent radii
- Lorem ipsum; fake logos/testimonials/metrics presented as real
- Heavy drop shadows — use `--line` borders and spacing; at most one soft shadow on dark-band cards
- Dead links or placeholder nav items ("About", "Blog") that go nowhere — if it doesn't exist, don't render it
