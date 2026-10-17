# Implementation Plan — phased, each phase gated by a verification

Clock reality (plan written 12:39pm): submission **4:30pm**. Film by **3:30pm**. Hard build stop **3:15pm**. Every phase ends with a verify gate — do not start the next phase until the gate passes. If a phase overruns its timebox, consult the cut order at the bottom instead of pushing the schedule.

## Pinned wire format (lets server and front-end build in parallel)

Every ledger event, over WS and `/api/events`, is exactly:

```json
{ "id": 1, "hive": "default", "ts": 1760000000000, "agent": "vihaan", "verb": "SHARE|RECALL|CLAIM|DEDUPE|QUEEN", "key": "deploy:server", "title": "Server deployed to hive.style.dev", "body": "..." }
```

WS messages: `{"type":"event","event":{...}}` and `{"type":"counters","hive":"default","agents":[...],"shared":42,"deduped":5}`. Change this shape only by editing this file first.

**Hives (added mid-day):** every event/memory/claim is scoped to a `hive` (default `"default"`). Clients pick theirs with `&hive=<name>` on the MCP URL, `?hive=` on `/ws`, `/live`, and `/api/events`, and a `hive` field on REST POSTs. `POST /api/hives {name, repo}` (auth) links a repo; `GET /api/hives` lists spaces. Claims are atomic per `(hive, key)`.

## Parallel lanes (3 people / 3 Claude sessions)

- **Lane A (server):** Phases 1 → 2 → 4 → 6
- **Lane B (front-end):** Phases 3 → 7 (builds against the pinned wire format + `scripts/mock-feed.js` until Phase 4 is live)
- **Lane C (ops/story):** Phase 0, then README + pitch polish, teammate CLAUDE.md etiquette snippet, Phase 5 coordination, Phase 8 filming/submission

---

## Phase 0 — Unblock (NOW → 1:00pm, Lane C + whoever owns accounts)

Human-only tasks that gate everything else; do them first, in parallel with Phase 1.

1. Freestyle: `npx -y freestyle@latest login` → `npx -y freestyle@latest billing redeem CALCOMPILED` → `npx -y freestyle@latest tokens create "hive" --output json` (save as `FREESTYLE_API_KEY`).
2. RunAnywhere: sign in at console.runanywhere.ai, create a cloud key (`sk-runa-…`), save as `QUEEN_API_KEY`.
3. Repo: **github.com/rejyr/hive**, cloned at `~/hive` — all work happens there. ⚠️ The repo is currently **private**; the owner (rejyr) must flip it to public before the 4:30 submission (Settings → General → Change visibility). No secrets ever committed; tokens live in `.env`, which is in `.gitignore`.

**Verify:** Freestyle dashboard shows credits · `curl -H "Authorization: Bearer $QUEEN_API_KEY" https://inference.runanywhere.ai/v1/models` lists `glm-5.3-flash` · docs committed and pushed to `main`; teammates can pull.

## Phase 1 — Ledger + core server, local (12:45 → 1:15pm, Lane A)

`npm init`, deps (`hono @hono/node-server ws better-sqlite3 @modelcontextprotocol/sdk dotenv`). Build `server/ledger.js` (events + claims tables, share/recall/claim/status functions) and `server/index.js` (`/health`, `/api/events`, temporary POST routes for testing). Write `scripts/smoke.js`.

**Verify (the most important gate of the day):** `node scripts/smoke.js http://localhost:3000` passes: share → recall finds it → claim returns ok → **second claim of the same key returns the deterministic reject with claimed_by** → status counts match. Run it twice; repeat shares with the same key don't duplicate.

## Phase 2 — MCP endpoint, local (1:15 → 1:45pm, Lane A)

`server/mcp.js`: the four tools (`hive_share`, `hive_recall`, `hive_claim`, `hive_status`) over Streamable HTTP at `/mcp`, bearer-token auth, agent name registration.

**Verify:** on ONE laptop, `claude mcp add` the local URL; in a fresh Claude session ask it to share a fact, then recall it. Then ask it to claim a key twice — second comes back rejected. Events visible in `/api/events`.

## Phase 3 — Dashboard + WebSocket (1:00 → 1:45pm, Lane B, parallel)

WS broadcast on every ledger append (Lane A exposes it in Phase 1; until then Lane B develops against `scripts/mock-feed.js` emitting the pinned format). Build `public/live.html` per docs/DESIGN.md (load the `hive-frontend` skill first): top bar (hex avatars, connection dot, counters), feed with verb badges, Queen side panel.

**Verify:** open `/live`, run the smoke script — rows appear live without refresh, counter ticks, DEDUPE row renders green. Kill and restart the server — the page auto-reconnects (20s heartbeat). Looks right at phone width and from 3 meters.

## Phase 4 — Deploy to Freestyle (1:45 → 2:15pm, Lane A) — ⏰ HARD GATE 2:30pm

Per docs/ARCHITECTURE.md §Deploy: VM (`idleTimeoutSeconds: null`, public egress), scp code, `npm ci`, systemd, TLS rule `hive.style.dev` → :3000.

**Verify:** `curl https://hive.style.dev/health` · `node scripts/smoke.js https://hive.style.dev` passes · `/live` opens from a DIFFERENT device (phone) · WS connection survives 2+ idle minutes.

**2:30pm decision:** not green → abandon Freestyle without sentiment, run the server on one laptop + phone hotspot, dashboard on local IP. Identical architecture, only the URL changes. (Still name Freestyle credits in the pitch as the deploy target.)

## Phase 5 — Multi-laptop integration (2:15 → 2:45pm, all three)

All three laptops add the `hive` MCP server (prod URL + team token). Lane C adds the etiquette snippet to each teammate's CLAUDE.md: share completed work and decisions (with keys), claim before starting any shared task, recall when blocked.

**Verify = the demo beats, run as tests:**
1. A shares a decision → B's agent recalls it on a different laptop, correct answer with author + age.
2. B and C claim the same key near-simultaneously → exactly one ok, one reject.
3. Every one of those events appeared on the dashboard in real time.

## Phase 6 — The Queen (2:30 → 3:00pm, Lane A, parallel with 5/7)

`server/queen.js`: on `hive_status` (or stale), last ~50 events → one GLM-5.3-flash call → 4–6 sentence synthesis stored as a QUEEN event.

**Verify:** "where are we?" in any Claude session returns a synthesis naming all three workstreams in <5s, and it lands in the dashboard side panel. Then unset `QUEEN_API_KEY` and confirm the four verbs still work (graceful degradation) — re-set it after.

## Phase 7 — Landing page (1:45 → 3:00pm, Lane B)

`public/index.html` per docs/DESIGN.md: hero (exact H1), dark dashboard band (live, not a screenshot), three feature rows, how-it-works, footer with GitHub link.

**Verify:** anti-slop checklist pass (DESIGN.md), phone width clean, hexagon count = 3, yellow-as-text count = 0.

## Phase 8 — Demo + submission (3:00 → 4:30pm, all three — clock-gated, not optional)

- 3:00–3:15 clean/seed ledger, rehearse the 90s beats twice (docs/DEMO.md)
- 3:15–3:30 build freeze; snapshot the VM as rollback
- 3:30–3:50 film (phone wide + screen recordings)
- 3:50–4:20 cut, upload (unlisted YouTube), test link in incognito; README gets one-liner + screenshot + setup; confirm repo is public
- 4:20–4:30 submit the form

## Cut order if behind schedule (cut top-first, never cut a verify gate)

1. Landing page polish → ship hero + dark band only (Phase 7 shrinks to 20 min)
2. The Queen → demo's final beat becomes `hive_status` counters instead of synthesis (drop Phase 6)
3. Freestyle → hotspot LAN fallback (the 2:30 gate decides this automatically)
4. **Never cut:** Phase 1's claim-reject gate, Phase 5's three-laptop verification, or the 3:30 filming start. A worse-looking working demo beats a better-looking broken one.

## Definition of done

Three laptops' agents sharing/recalling/claiming through `hive.style.dev` with the dashboard live on a fourth screen; 90s public video uploaded; public repo with README; form submitted — all before 4:30pm.
