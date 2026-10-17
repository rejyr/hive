# Hive

**Your team's agents, finally working as a team.**

Every teammate's AI agent shares one live memory through a single MCP server, and a Queen agent synthesizes what the team knows — so nothing is explained twice and nothing is done twice.

Built in one afternoon at c0mpiled-14 (UC Berkeley), using Hive itself to coordinate the three Claude Code sessions that built it. Live at **[hive.style.dev](https://hive.style.dev)** · dashboard at **[/live](https://hive.style.dev/live)**.

![The live dashboard](docs/dashboard.jpg)

## The entire surface: four verbs

| Tool | What it does |
|---|---|
| `hive_share` | Push a decision, endpoint, or completed work into the team's shared memory |
| `hive_recall` | Ask what the team already knows — answers carry author + age |
| `hive_claim` | Atomically claim a task. A concurrent claim gets a deterministic reject: "already handled by A — build on it instead" |
| `hive_status` | Counters, open claims, and the Queen's synthesis of where the team is |

The guarantee is structural, not behavioral: claims are an atomic compare-and-set on a key in the ledger. Two agents racing for the same task — exactly one wins, every time, regardless of which models they run on.

## Join in three steps

1. **Generate a token** at [hive.style.dev/start](https://hive.style.dev/start) — one click, one token per project; the token *is* the hive. One person generates, the whole team uses the same token.
2. **Claim your tag** (unique per hive — first name or initials) and connect any agent:
   ```
   claude mcp add --transport http hive "https://hive.style.dev/mcp?agent=<tag>&token=<token>"
   ```
   Codex, Cursor, Windsurf, and raw REST all work — see [/start](https://hive.style.dev/start). Or one-prompt install: tell your agent *"Join my hive: follow hive.style.dev/setup.md with token … as …"*.
3. **Watch it live** at `hive.style.dev/live?token=<token>` — presence, every share and claim as it happens, click any row for the full story, and the Queen's "where are we?".

Share the project description with key `brief` and the Queen directs the team toward unclaimed work.

## Run it yourself

```
git clone https://github.com/rejyr/hive && cd hive
npm ci
cp .env.example .env   # set HIVE_TOKEN; Queen vars optional
npm run dev            # http://localhost:3000, dashboard at /live
node scripts/smoke.js  # share → recall → claim → claim-again-rejected → status
```

## Architecture

```
laptop A (Claude Code) ─┐
laptop B (Claude Code) ─┼─ MCP /mcp ─→ one Node process ── SQLite ledger (events + claims)
laptop C (any agent)   ─┘               (Freestyle VM)   ├─ WebSocket /ws → live dashboard
                                                         └─ the Queen: ledger synthesis
                                                            (deterministic; any OpenAI-
                                                            compatible model slots in via env)
```

- One process: Hono + ws + better-sqlite3 + `@modelcontextprotocol/sdk` (Streamable HTTP). No framework, no build step.
- Hosted on a **Freestyle** VM (hackathon credits — thanks!), `idleTimeoutSeconds: null`.
- The Queen answers "where are we?" from the ledger itself — deterministic, zero dependencies. Set `QUEEN_BASE_URL`/`QUEEN_API_KEY` to any OpenAI-compatible endpoint and she upgrades to prose. Either way, share/recall/claim never depend on her.
- Docs: [architecture](docs/ARCHITECTURE.md) · [design system](docs/DESIGN.md) · [demo script](docs/DEMO.md) · [pitch](docs/PITCH.md)

Built for the YC Fall 2026 "Multiplayer AI" RFS, agent-first software track.
