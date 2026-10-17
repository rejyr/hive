import 'dotenv/config';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { getRequestListener } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { WebSocketServer } from 'ws';
import { openLedger, sanitizeName } from './ledger.js';
import { createMcpHandler } from './mcp.js';
import { maybeSynthesize, assignBrief } from './queen.js';

const PORT = Number(process.env.PORT || 3000);
const ledger = openLedger();
const app = new Hono();

function tokenOf(c) {
  return (c.req.header('authorization') || '').replace(/^Bearer\s+/i, '') || c.req.query('token') || '';
}
// The hive a request may WRITE to: its token decides. Env team token may name a hive (back-compat).
function writeHive(c, bodyHive) {
  const token = tokenOf(c);
  const hive = ledger.hiveForToken(token);
  if (!hive) return null;
  if (hive === 'default' && bodyHive) return sanitizeName(bodyHive, 'default');
  return hive;
}
// The hive a request may READ: its token's hive; tokenless reads see only the public demo hive.
function readHive(c) {
  const token = tokenOf(c);
  const fromToken = ledger.hiveForToken(token);
  if (fromToken) {
    const q = sanitizeName(c.req.query('hive'), fromToken);
    return fromToken === 'default' ? q : fromToken;
  }
  const q = sanitizeName(c.req.query('hive'), 'default');
  return q === 'default' ? 'default' : null;
}

app.get('/health', (c) => c.json({ ok: true, ts: Date.now() }));

app.get('/api/events', (c) => {
  const hive = readHive(c);
  if (!hive) return c.json({ error: 'token required for this hive' }, 401);
  return c.json(ledger.recentEvents(Number(c.req.query('limit')) || 50, hive));
});
app.get('/api/status', (c) => {
  const hive = readHive(c);
  if (!hive) return c.json({ error: 'token required for this hive' }, 401);
  const info = ledger.hiveInfo(hive);
  return c.json({ ...ledger.status(hive), repo: info?.repo || null, members: ledger.members(hive) });
});

// Create a hive + its token. Public: this is the front door.
app.post('/api/tokens', async (c) => {
  const { name } = await c.req.json().catch(() => ({}));
  const made = ledger.createHive(name, randomUUID);
  return c.json(made);
});
// Reserve your unique member tag in the token's hive.
app.post('/api/agents', async (c) => {
  const { tag } = await c.req.json().catch(() => ({}));
  const hive = writeHive(c);
  if (!hive) return c.json({ error: 'valid token required' }, 401);
  return c.json({ hive, ...ledger.claimTag(hive, tag) });
});
// Link a repo to the token's hive.
app.post('/api/hives', async (c) => {
  const { repo, hive: bodyHive } = await c.req.json().catch(() => ({}));
  const hive = writeHive(c, bodyHive);
  if (!hive) return c.json({ error: 'valid token required' }, 401);
  const repoUrl = typeof repo === 'string' && /^https?:\/\/\S{1,200}$/.test(repo) ? repo : null;
  return c.json(ledger.registerHive(hive, repoUrl));
});

app.post('/api/share', async (c) => {
  const { agent = 'api', hive: bodyHive, title, body, key } = await c.req.json();
  const hive = writeHive(c, bodyHive);
  if (!hive) return c.json({ error: 'valid token required' }, 401);
  if (!title) return c.json({ error: 'title required' }, 400);
  return c.json(ledger.share({ hive, agent, title, body, key }));
});
app.post('/api/recall', async (c) => {
  const { agent = 'api', hive: bodyHive, query } = await c.req.json();
  const hive = writeHive(c, bodyHive);
  if (!hive) return c.json({ error: 'valid token required' }, 401);
  return c.json(ledger.recall({ hive, agent, query }));
});
app.post('/api/claim', async (c) => {
  const { agent = 'api', hive: bodyHive, key, title } = await c.req.json();
  const hive = writeHive(c, bodyHive);
  if (!hive) return c.json({ error: 'valid token required' }, 401);
  if (!key || !title) return c.json({ error: 'key and title required' }, 400);
  return c.json(ledger.claim({ hive, agent, key, title }));
});
// The Queen splits the brief across members as held claims.
app.post('/api/assign', async (c) => {
  const { hive: bodyHive } = await c.req.json().catch(() => ({}));
  const hive = writeHive(c, bodyHive);
  if (!hive) return c.json({ error: 'valid token required' }, 401);
  return c.json(assignBrief(ledger, hive));
});
app.post('/api/queen', async (c) => {
  const { hive: bodyHive } = await c.req.json().catch(() => ({}));
  const hive = writeHive(c, bodyHive);
  if (!hive) return c.json({ error: 'valid token required' }, 401);
  return c.json(await maybeSynthesize(ledger, { force: true, hive }));
});
app.post('/api/reset', async (c) => {
  const { hive: bodyHive } = await c.req.json().catch(() => ({}));
  const hive = writeHive(c, bodyHive);
  if (!hive) return c.json({ error: 'valid token required' }, 401);
  ledger.reset(hive);
  broadcastCounters(hive);
  return c.json({ ok: true, hive });
});

app.get('/live', serveStatic({ path: './public/live.html' }));
app.get('/start', serveStatic({ path: './public/start.html' }));
// Explicit text types — serveStatic ships unknown extensions as octet-stream,
// which agents reading these files reject as "binary data".
app.get('/setup.md', (c) => c.text(readFileSync('./public/setup.md', 'utf8'), 200, { 'content-type': 'text/markdown; charset=utf-8' }));
app.get('/llms.txt', (c) => c.text(readFileSync('./public/llms.txt', 'utf8'), 200, { 'content-type': 'text/plain; charset=utf-8' }));
app.use('/*', serveStatic({ root: './public' }));

const listener = getRequestListener(app.fetch);
const handleMcp = createMcpHandler(ledger);

const server = http.createServer((req, res) => {
  if (req.url && req.url.startsWith('/mcp')) {
    handleMcp(req, res).catch((err) => {
      console.error('[mcp]', err);
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: 'internal error' }, id: null }));
      }
    });
    return;
  }
  listener(req, res);
});

const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('error', (e) => console.error('[wss]', e));

function broadcast(obj, hive = 'default') {
  const s = JSON.stringify(obj);
  // callback form: a failed send surfaces there instead of as an unhandled 'error' that kills the process
  for (const client of wss.clients) {
    if (client.readyState === 1 && (client.hiveName || 'default') === hive) client.send(s, () => {});
  }
}
function broadcastCounters(hive = 'default') {
  broadcast(ledger.counters(hive), hive);
}

wss.on('connection', (ws, req) => {
  ws.on('error', () => {}); // dead clients on hostile wifi must not crash the process
  const url = new URL(req.url || '/ws', 'http://localhost');
  const token = url.searchParams.get('token') || '';
  const fromToken = ledger.hiveForToken(token);
  const asked = sanitizeName(url.searchParams.get('hive'), 'default');
  const hive = fromToken ? (fromToken === 'default' ? asked : fromToken) : asked === 'default' ? 'default' : null;
  if (!hive) {
    ws.send(JSON.stringify({ type: 'locked' }), () => {});
    ws.close();
    return;
  }
  ws.hiveName = hive;
  ws.send(JSON.stringify(ledger.counters(hive)));
  const queen = ledger.latestQueen(hive);
  if (queen) ws.send(JSON.stringify({ type: 'event', event: queen }));
  ws.on('message', (m) => {
    try {
      if (JSON.parse(m).type === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
    } catch {}
  });
});

ledger.setOnEvent((event) => {
  broadcast({ type: 'event', event }, event.hive);
  broadcastCounters(event.hive);
});

server.listen(PORT, '0.0.0.0', () => console.log(`hive listening on 0.0.0.0:${PORT}`));
