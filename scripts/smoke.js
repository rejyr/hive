import 'dotenv/config';

const BASE = (process.argv[2] || 'http://localhost:3000').replace(/\/$/, '');
const TOKEN = process.env.HIVE_TOKEN || 'change-me-team-secret';
const H = { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` };
const run = `${Date.now()}`;

let failed = 0;
function check(name, cond, detail = '') {
  const ok = Boolean(cond);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed++;
}

async function post(path, body) {
  const r = await fetch(`${BASE}${path}`, { method: 'POST', headers: H, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${path} -> ${r.status}: ${await r.text()}`);
  return r.json();
}
async function get(path) {
  const r = await fetch(`${BASE}${path}`);
  if (!r.ok) throw new Error(`${path} -> ${r.status}`);
  return r.json();
}

const health = await get('/health');
check('health', health.ok);

const share = await post('/api/share', {
  agent: 'smoke-a',
  title: `API schema decided (${run})`,
  body: 'events + claims tables; WS at /ws; pinned wire format in docs/IMPLEMENTATION.md',
  key: `decision:api-schema-${run}`,
});
check('share stores and returns event', share.verb === 'SHARE' && share.key === `decision:api-schema-${run}`);

const before = await get('/api/status');
await post('/api/share', { agent: 'smoke-a', title: `API schema decided (${run})`, key: `decision:api-schema-${run}` });
const after = await get('/api/status');
check('share is idempotent on key', after.shared === before.shared, `shared ${before.shared} -> ${after.shared}`);

const hits = await post('/api/recall', { agent: 'smoke-b', query: run });
check('recall finds the shared item', hits.length >= 1 && hits[0].key === `decision:api-schema-${run}`, hits[0]?.key);

const c1 = await post('/api/claim', { agent: 'smoke-a', key: `task:deploy-${run}`, title: 'Deploy the server' });
check('first claim wins', c1.ok === true);

const c2 = await post('/api/claim', { agent: 'smoke-b', key: `task:deploy-${run}`, title: 'Deploy the server' });
check('THE GATE: second claim deterministically rejected', c2.ok === false && c2.claimed_by === 'smoke-a', JSON.stringify(c2));

const status = await get('/api/status');
check('status counts', status.shared >= 1 && status.deduped >= 1, `shared=${status.shared} deduped=${status.deduped}`);
check('status lists agents', status.agents.some((a) => a.name === 'smoke-a') && status.agents.some((a) => a.name === 'smoke-b'));

const events = await get('/api/events?limit=10');
check('events feed has DEDUPE row', events.some((e) => e.verb === 'DEDUPE' && e.key === `task:deploy-${run}`));

console.log(failed === 0 ? '\nSMOKE: ALL PASS' : `\nSMOKE: ${failed} FAILURE(S)`);
process.exit(failed === 0 ? 0 : 1);
