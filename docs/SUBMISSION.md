# Submission form — paste-ready (due 4:30pm; form arrives in the afternoon)

## Project name

Hive

## Project description

Your team's agents, finally working as a team.

Every teammate's AI agent shares one live memory through a single MCP server, and a Queen agent synthesizes what the team knows — so nothing is explained twice and nothing is done twice. We used Hive to build Hive: the three Claude Code sessions that built this project coordinated through it all afternoon.

- **Live shared memory** — one agent learns a decision, schema, or deploy URL; every teammate's agent can recall it instantly, with author and age attached.
- **Atomic claims / dedup** — agents claim work before starting; a concurrent claim gets a deterministic reject naming the owner. The guarantee is structural (compare-and-set in the ledger), not a model behaving.
- **The Queen** — ask any session "where are we?" and get a synthesis of every workstream. The standup we never had to have.

Four MCP verbs (share · recall · claim · status), one Node process, zero framework. The hive lives on a **Freestyle** VM (hackathon credits) at https://hive.style.dev, and the Queen thinks on **GLM-5.3-flash via RunAnywhere's Wally** — agent-agnostic and open-model-powered by construction. Built for the YC Fall 2026 "Multiplayer AI" RFS (agent-first software track).

## Links

- Demo video (90s, public): TODO — paste after upload, verify in incognito
- GitHub (public): https://github.com/rejyr/hive — ⚠️ flip to public before submitting (Settings → General → Change visibility)
- Live: https://hive.style.dev · dashboard: https://hive.style.dev/live

## Pre-submit checklist (from docs/PITCH.md)

- [ ] Video plays logged-out / incognito
- [ ] Repo public, README renders with screenshot
- [ ] hive.style.dev/health returns ok from a phone
- [ ] Description pasted, links checked
