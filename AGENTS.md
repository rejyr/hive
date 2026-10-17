# Hive — agent instructions

(This file mirrors CLAUDE.md for non-Claude agents. If you update one, update both.)

Real-time multiplayer coordination for AI agents. One-liner: **"Your team's agents, finally working as a team."**

Teammates' agents (Claude Code on separate laptops) share one live memory through an MCP server, and a thin orchestrator ("the Queen") synthesizes team status. Hackathon project (c0mpiled-14, UC Berkeley) — due 4:30pm Pacific 2026-10-17: public GitHub repo + public 90-second demo video.

## Hard rules

1. **Never send real emails or messages.** Any "outreach" in demos is simulated drafts stored in the ledger. No SMTP, no Gmail APIs, no exceptions.
2. **Before any UI work:** read `docs/DESIGN.md` and load the `hive-frontend` skill. Follow tokens exactly — especially the yellow rule and the hexagon ration.
3. **Scope discipline:** ship > polish > features. No auth beyond the shared bearer token, no user accounts, no test suite (one smoke script only), no abstractions for hypothetical futures. The deadline is real.
4. **Don't rename the four MCP verbs** (`hive_share`, `hive_recall`, `hive_claim`, `hive_status`) — pitch and demo script depend on them.
5. **Queen failures must never block the core.** share/recall/claim work even if the Queen or her model is down.
6. Simulated/demo data must be plausible but clearly team-internal (our names, this project's tasks) — no invented third parties presented as real.

## Hive etiquette (while building — we use Hive to build Hive)

Once the `hive` MCP server is connected, these are mandatory during the build:

1. **Before starting any shared task:** `hive_claim` with a stable key (`task:dashboard`, `task:readme-setup`). If REJECTED, do not do the work — `hive_recall` the owner's output and build on it.
2. **After finishing anything a teammate could need** (endpoint shape, schema, working command, decision, gotcha): `hive_share` immediately. Title = one line; body = the thing itself, paste-ready. 1–3 shares per task, facts not narration.
3. **When blocked on something a teammate owns:** `hive_recall` first — before reading their code or asking a human.
4. Never share secrets or tokens. Never block on Hive — if a call fails, continue and note it.

## Stack (decided — do not relitigate)

- One Node 20+ process: **Hono** (HTTP + static) + **ws** (WebSocket) + **better-sqlite3** (ledger) + **@modelcontextprotocol/sdk** (MCP over Streamable HTTP at `/mcp`).
- Front-end: static HTML/CSS/vanilla JS served by the same process. **No framework, no build step** (fewer failure modes at 4pm).
- Queen: in-process loop calling an OpenAI-compatible endpoint (RunAnywhere/Wally, model `glm-5.3-flash`); config via env.

## Repo layout

- `server/` — index.js (Hono app), mcp.js (tools), ledger.js (SQLite), queen.js (synthesis loop)
- `public/` — index.html (landing), live.html (dashboard), styles.css, app.js
- `docs/` — DESIGN.md, ARCHITECTURE.md, DEMO.md, PITCH.md, IMPLEMENTATION.md (phased build plan — follow its phase gates)
- `scripts/` — seed.js (demo data), deploy.js (Freestyle), smoke.js

## Commands

- `npm run dev` — local server on :3000
- `node scripts/smoke.js` — share→recall→claim→status round-trip against a URL
- `node scripts/deploy.js` — Freestyle deploy (see docs/ARCHITECTURE.md §Deploy)

## Env

`PORT` (3000) · `HIVE_TOKEN` (shared team bearer token) · `HIVE_DB_PATH` · `QUEEN_BASE_URL` · `QUEEN_API_KEY` · `QUEEN_MODEL` (glm-5.3-flash). Queen env missing → Queen disabled, everything else still works.

## Deployment

Freestyle VM at `https://hive.style.dev` — VM must have `idleTimeoutSeconds: null` (idle pause kills the demo). Details and fallbacks: `docs/ARCHITECTURE.md`.
