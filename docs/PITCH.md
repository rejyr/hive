# Pitch

**One-liner (exact, everywhere):** Your team's agents, finally working as a team.

**Follow-up sentence:** Every teammate's agent shares one live memory through a single MCP server, and a Queen agent synthesizes what the team knows — so nothing is explained twice and nothing is done twice.

## 90-second verbal pitch skeleton

1. Problem (15s): AI agents are single-player. Three people, three Claude sessions, zero shared context — we coordinate our AIs with Slack pings and spreadsheets.
2. What we built (20s): one-liner + follow-up. "It's four MCP verbs: share, recall, claim, status."
3. Demo (40s): the video beats, live if possible.
4. How + vision (15s): "The ledger runs on a Freestyle VM; any MCP agent can mount it — agent-agnostic by construction. Every multiplayer era needed a game server. We built one for agents."

## Judge Q&A (prepared answers)

- **"What if two agents claim the same task simultaneously?"** — Claims are an atomic compare-and-set on a key in the ledger; a concurrent claim gets a deterministic reject. The guarantee doesn't depend on any model behaving.
- **"Isn't the Queen a single point of failure?"** — The ledger is the source of truth and fully peer-shared; the Queen is stateless synthesis on top. Kill her and the agents still share, recall, and claim.
- **"CRMs already dedupe contacts."** — Inside one tool, for one workflow. Hive dedupes across any agents and any tools — today it was a codebase, the same four verbs cover outreach, support, research.
- **"How is this different from existing agent memory products?"** — Memory products remember for one user. Hive coordinates across many people's agents: recall is the memory half; atomic claims — allocating who does what — is the half memory products don't do.
- **"Why not one orchestrator running all the agents?"** — Orchestrators parallelize one person's agents. Hive coordinates agents owned by different people on different machines, with no central owner — the Queen advises, the ledger decides.

## Credits usage (say this out loud)

- "The hive lives on a **Freestyle** VM — redeemed with their hackathon credits, deployed at hive.style.dev."

## Submission checklist (form arrives in the afternoon — due 4:30pm)

- [ ] Project description (one-liner + follow-up + 3 bullets: live shared memory · atomic claims/dedup · Queen synthesis; credits named)
- [ ] 90-second demo video — PUBLIC link (unlisted YouTube ok), test in incognito
- [ ] GitHub repo PUBLIC — README with one-liner, screenshot, setup, architecture sketch
- [ ] Deployed URL in description: https://hive.style.dev
