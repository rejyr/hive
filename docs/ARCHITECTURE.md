# Hive Architecture

Three laptops (Claude Code + the `hive` MCP server) ⇄ one Hive server (Freestyle VM: ledger + WebSocket + dashboard + MCP endpoint) ⇠ the Queen (in-process loop thinking on GLM-5.3-flash via RunAnywhere/Wally).

The one-sentence version for judges: "Hive is an MCP server any agent can mount — the shared memory lives on a Freestyle VM, the Queen thinks on an open model via RunAnywhere, and your agents stay whatever they already are."

## Server

One Node process (Hono). Routes:
- `/` landing · `/live` dashboard · `/mcp` MCP Streamable HTTP · `/ws` WebSocket broadcast · `/health` · `/api/events` (REST fallback for the dashboard if WS misbehaves)

### Ledger (SQLite, better-sqlite3, synchronous = naturally atomic per statement)

- `events(id INTEGER PRIMARY KEY, ts INTEGER, agent TEXT, author TEXT, verb TEXT, key TEXT, title TEXT, body TEXT)` — every verb (SHARE/RECALL/CLAIM/DEDUPE/QUEEN) appends here; every append broadcasts over WS.
- `claims(key TEXT PRIMARY KEY, agent TEXT, author TEXT, ts INTEGER, title TEXT)` — **the guarantee**: `INSERT` into a PRIMARY KEY column is an atomic compare-and-set; a concurrent claim gets a deterministic constraint error → returned as `{ok:false, claimed_by, ts}` and logged as a DEDUPE event.
- Recall = `LIKE`/FTS5 query over `events` where verb='SHARE', newest first, top 5.
- Timestamps are **server-side only** (no laptop clock skew).

## MCP tools — the entire surface (4 verbs)

- `hive_share({title, body, key?})` → store context/decision/completed work; idempotent when `key` repeats.
- `hive_recall({query})` → top matching shared items with author + age.
- `hive_claim({key, title})` → `{ok:true}` or `{ok:false, claimed_by, ts, what_they_did}` — callers must treat a reject as "skip and move on".
- `hive_status({})` → counters + latest Queen synthesis (triggers one if stale).

Auth: one shared team token (`Authorization: Bearer $HIVE_TOKEN`). Agent identity: a `name` the client registers (teammate's first name).

Laptop setup (each teammate): add an HTTP MCP server named `hive` pointing at `https://hive.style.dev/mcp` with the bearer header — verify Claude Code's exact `claude mcp add` syntax at build time. A line in each teammate's project CLAUDE.md should instruct the agent to share completed work/decisions and to claim before starting any shared task.

## The Queen

In-process: on `hive_status` (or every N minutes), read the last ~50 events → one prompt → a 4-6 sentence team synthesis ("done / in progress / next / conflicts") → stored as a QUEEN event (broadcasts to dashboard).
- Model: OpenAI-compatible `POST {QUEEN_BASE_URL}/chat/completions`; primary `QUEEN_BASE_URL=https://inference.runanywhere.ai/v1`, `QUEEN_MODEL=glm-5.3-flash` (fast: ~380 tok/s — synthesis lands on camera in ~2s).
- Hard rule: Queen errors degrade to "synthesis unavailable" — never block the four verbs.

## Deploy (Freestyle) — happy path

1. **Human, once:** `npx -y freestyle@latest login` → `npx -y freestyle@latest billing redeem CALCOMPILED` → `npx -y freestyle@latest tokens create "hive" --output json` → export `FREESTYLE_API_KEY`. Claim the `hive.style.dev` subdomain immediately (first account to publish owns it; also grab a backup name).
2. Create VM: default `freestyle/ubuntu` snapshot (Node preinstalled), firewall allowing public egress, **`idleTimeoutSeconds: null`**, slug `hive`.
3. Code onto VM (`freestyle vm scp` a tarball, or git clone from inside), `npm ci`, systemd unit (`Restart=always`, server binds `0.0.0.0:3000`).
4. TLS rule: `hive.style.dev` → vm port 3000.
5. Smoke: `curl https://hive.style.dev/health`, then `node scripts/smoke.js https://hive.style.dev` (share→recall→claim→claim-again-expects-reject→status), then a WS connect test. **Test WS through the domain within the first hour** — edge idle timeouts are undocumented, so clients ping every 20s and auto-reconnect.

Redeploy during the day: `vm scp` + `systemctl restart hive` (seconds). Before 4pm: snapshot the working VM as rollback.

## Risk register

| Risk | Mitigation |
|---|---|
| Freestyle redemption/VM blocked | Fallback by 2:30pm: run the server on one laptop + phone hotspot LAN; dashboard on local IP. The architecture is identical — only the URL changes. |
| WS drops through edge | 20s heartbeat, auto-reconnect, REST polling fallback for the dashboard |
| Open-model flakiness | Queen is server-side only; laptops stay on Anthropic. If GLM fails on stage, status shows last good synthesis |
| Venue Wi-Fi | Phone hotspot; everything reconnects gracefully |
| Demo-day data mess | `scripts/seed.js` can replay a clean believable event history; a `reset` admin route wipes the ledger before filming |
