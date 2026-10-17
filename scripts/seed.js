// Reset the ledger and replay a clean, believable history of TODAY's real build.
// Backup for filming only — live data is preferred (docs/DEMO.md: never fake an event on camera).
// Usage: node scripts/seed.js [url] [nameA] [nameB] [nameC]
import 'dotenv/config';

const BASE = (process.argv[2] || 'http://localhost:3000').replace(/\/$/, '');
const [A = 'vihaan', B = 'sriram', C = 'jerry'] = process.argv.slice(3);
const TOKEN = process.env.HIVE_TOKEN || 'change-me-team-secret';
const H = { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` };

async function post(path, body) {
  const r = await fetch(`${BASE}${path}`, { method: 'POST', headers: H, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${path} -> ${r.status}: ${await r.text()}`);
  return r.json();
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

console.log(`Seeding ${BASE} with agents ${A}, ${B}, ${C} (resets the ledger)`);
await post('/api/reset', {});

// The day's real workstream, oldest first. Small pauses keep timestamps ordered.
const steps = [
  ['share', { agent: A, key: 'decision:wire-format', title: 'Pinned the event wire format', body: 'Every event: {id, ts, agent, verb, key, title, body}. WS: {type:"event"|"counters"}. Changing it means editing docs/IMPLEMENTATION.md first.' }],
  ['claim', { agent: A, key: 'task:server-core', title: 'Build ledger + server core' }],
  ['claim', { agent: B, key: 'task:dashboard', title: 'Build the live dashboard' }],
  ['share', { agent: A, key: 'howto:laptop-setup', title: 'Laptop setup steps that work', body: 'git clone github.com/rejyr/hive && npm ci && cp .env.example .env (team token in the group chat) && npm run dev. MCP: claude mcp add --transport http hive "<server>/mcp?agent=<yourname>" --header "Authorization: Bearer <token>"' }],
  ['share', { agent: A, key: 'endpoint:api', title: 'Server API is live', body: 'GET /health, /api/events?limit=50, /api/status; POST /api/share|recall|claim (bearer auth). WS at /ws broadcasts every event + counters.' }],
  ['recall', { agent: B, query: 'API' }],
  ['share', { agent: B, key: 'decision:dashboard-tokens', title: 'Dashboard uses the DESIGN.md tokens verbatim', body: 'Dark band #141310, feed mono >=14px, verb badges: SHARE filled honey, DEDUPE filled green. No fourth hexagon.' }],
  ['claim', { agent: C, key: 'task:demo-video', title: 'Film and cut the 90s demo' }],
  ['share', { agent: C, key: 'howto:filming', title: 'Filming plan locked', body: 'Phone wide shot + QuickTime screen recordings; beats in docs/DEMO.md; shoot by 3:30pm.' }],
  ['recall', { agent: C, query: 'setup' }],
  // The dedup beat's target: C claims what A already did.
  ['claim', { agent: C, key: 'task:server-core', title: 'Build ledger + server core' }],
];

for (const [kind, body] of steps) {
  if (kind === 'share') await post('/api/share', body);
  else if (kind === 'claim') await post('/api/claim', body);
  else if (kind === 'recall') await post('/api/recall', body);
  await pause(120);
}

// Fresh synthesis over the seeded history: fills the Queen panel for filming and
// overwrites any stale in-flight synthesis from before the reset. No-op without Queen creds.
await post('/api/queen', {}).catch(() => {});

const status = await fetch(`${BASE}/api/status`).then((r) => r.json());
console.log(`Seeded. shared=${status.shared} deduped=${status.deduped} agents=${status.agents.map((a) => a.name).join(',')}`);
console.log('Hard-refresh /live before filming so the feed shows only the seeded history.');
