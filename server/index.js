import 'dotenv/config';
import http from 'node:http';
import { Hono } from 'hono';
import { getRequestListener } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { WebSocketServer } from 'ws';
import { openLedger } from './ledger.js';
import { createMcpHandler } from './mcp.js';
import { maybeSynthesize } from './queen.js';

const PORT = Number(process.env.PORT || 3000);
const ledger = openLedger();
const app = new Hono();

const auth = async (c, next) => {
  const t = (c.req.header('authorization') || '').replace(/^Bearer\s+/i, '');
  if (process.env.HIVE_TOKEN && t !== process.env.HIVE_TOKEN) return c.json({ error: 'unauthorized' }, 401);
  await next();
};

app.get('/health', (c) => c.json({ ok: true, ts: Date.now() }));
app.get('/api/events', (c) => c.json(ledger.recentEvents(Number(c.req.query('limit')) || 50)));
app.get('/api/status', (c) => c.json(ledger.status()));

app.post('/api/share', auth, async (c) => {
  const { agent = 'api', title, body, key } = await c.req.json();
  if (!title) return c.json({ error: 'title required' }, 400);
  return c.json(ledger.share({ agent, title, body, key }));
});
app.post('/api/recall', auth, async (c) => {
  const { agent = 'api', query } = await c.req.json();
  return c.json(ledger.recall({ agent, query }));
});
app.post('/api/claim', auth, async (c) => {
  const { agent = 'api', key, title } = await c.req.json();
  if (!key || !title) return c.json({ error: 'key and title required' }, 400);
  return c.json(ledger.claim({ agent, key, title }));
});
app.post('/api/queen', auth, async (c) => c.json(await maybeSynthesize(ledger, { force: true })));
app.post('/api/reset', auth, (c) => {
  ledger.reset();
  broadcastCounters();
  return c.json({ ok: true });
});

app.get('/live', serveStatic({ path: './public/live.html' }));
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

function broadcast(obj) {
  const s = JSON.stringify(obj);
  // callback form: a failed send surfaces there instead of as an unhandled 'error' that kills the process
  for (const client of wss.clients) if (client.readyState === 1) client.send(s, () => {});
}
function broadcastCounters() {
  broadcast(ledger.counters());
}

wss.on('connection', (ws) => {
  ws.on('error', () => {}); // dead clients on hostile wifi must not crash the process
  ws.send(JSON.stringify(ledger.counters()));
  const queen = ledger.latestQueen();
  if (queen) ws.send(JSON.stringify({ type: 'event', event: queen }));
  ws.on('message', (m) => {
    try {
      if (JSON.parse(m).type === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
    } catch {}
  });
});

ledger.setOnEvent((event) => {
  broadcast({ type: 'event', event });
  broadcastCounters();
});

server.listen(PORT, '0.0.0.0', () => console.log(`hive listening on 0.0.0.0:${PORT}`));
