import 'dotenv/config';

const BASE = (process.argv[2] || 'http://localhost:3000').replace(/\/$/, '');
const TOKEN = process.env.HIVE_TOKEN || 'change-me-team-secret';
const run = `${Date.now()}`;

let failed = 0;
function check(name, cond, detail = '') {
  const ok = Boolean(cond);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed++;
}

let sessionId = null;
let nextId = 1;

async function rpc(method, params, { notification = false } = {}) {
  const body = notification
    ? { jsonrpc: '2.0', method, params }
    : { jsonrpc: '2.0', id: nextId++, method, params };
  const r = await fetch(`${BASE}/mcp?agent=mcp-smoke`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${TOKEN}`,
      ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
    },
    body: JSON.stringify(body),
  });
  const sid = r.headers.get('mcp-session-id');
  if (sid) sessionId = sid;
  if (notification) return { status: r.status };
  const ct = r.headers.get('content-type') || '';
  const raw = await r.text();
  if (ct.includes('text/event-stream')) {
    const lines = raw.split('\n').filter((l) => l.startsWith('data: '));
    const last = lines[lines.length - 1];
    return { status: r.status, json: last ? JSON.parse(last.slice(6)) : null };
  }
  return { status: r.status, json: raw ? JSON.parse(raw) : null };
}

const init = await rpc('initialize', {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'hive-mcp-smoke', version: '0.1.0' },
});
check('initialize', init.json?.result?.serverInfo?.name === 'hive', `session=${sessionId}`);

await rpc('notifications/initialized', {}, { notification: true });

const tools = await rpc('tools/list', {});
const names = (tools.json?.result?.tools || []).map((t) => t.name).sort();
check('tools/list has the 4 verbs', JSON.stringify(names) === JSON.stringify(['hive_claim', 'hive_recall', 'hive_share', 'hive_status']), names.join(','));

const share = await rpc('tools/call', {
  name: 'hive_share',
  arguments: { title: `MCP smoke share (${run})`, body: 'written through the MCP endpoint', key: `mcp:smoke-${run}` },
});
check('hive_share via MCP', JSON.stringify(share.json?.result?.content || '').includes('SHARE'));

const recall = await rpc('tools/call', { name: 'hive_recall', arguments: { query: `smoke-${run}` } });
check('hive_recall via MCP finds it', JSON.stringify(recall.json?.result?.content || '').includes(`mcp:smoke-${run}`));

const claim1 = await rpc('tools/call', { name: 'hive_claim', arguments: { key: `mcp:task-${run}`, title: 'MCP smoke task' } });
check('hive_claim ok', JSON.stringify(claim1.json?.result?.content || '').includes('Claimed'));

const claim2 = await rpc('tools/call', { name: 'hive_claim', arguments: { key: `mcp:task-${run}`, title: 'MCP smoke task' } });
check('hive_claim duplicate REJECTED', JSON.stringify(claim2.json?.result?.content || '').includes('REJECTED'));

const status = await rpc('tools/call', { name: 'hive_status', arguments: {} });
check('hive_status', JSON.stringify(status.json?.result?.content || '').includes('Items shared'));

console.log(failed === 0 ? '\nMCP SMOKE: ALL PASS' : `\nMCP SMOKE: ${failed} FAILURE(S)`);
process.exit(failed === 0 ? 0 : 1);
