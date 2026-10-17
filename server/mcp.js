import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { maybeSynthesize } from './queen.js';

function text(obj) {
  return { content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) }] };
}

function buildServer(ledger, agent) {
  const server = new McpServer({ name: 'hive', version: '0.1.0' });

  server.registerTool(
    'hive_share',
    {
      description:
        "Share completed work, a decision, or context with the team's hive so every teammate's agent can use it. " +
        'Use a stable key like "decision:api-schema" or "task:deploy" when the item has an identity.',
      inputSchema: {
        title: z.string().min(1).describe('One-line summary of what was done or decided'),
        body: z.string().optional().describe('Details teammates will need'),
        key: z.string().optional().describe('Stable identity key, e.g. decision:api-schema'),
      },
    },
    async ({ title, body, key }) => text(ledger.share({ agent, title, body, key }))
  );

  server.registerTool(
    'hive_recall',
    {
      description:
        "Ask the hive what the team already knows. Searches every teammate's shared context, decisions, and completed work.",
      inputSchema: { query: z.string().describe('What you need to know, e.g. "api schema" or "deploy"') },
    },
    async ({ query }) => {
      const hits = ledger.recall({ agent, query });
      if (!hits.length) return text('No shared context matches. The team has not shared anything about this yet.');
      return text(
        hits
          .map((h) => `• [${h.key}] ${h.title} — shared by ${h.agent}, ${Math.round((Date.now() - h.ts) / 60000)} min ago${h.body ? `\n  ${h.body}` : ''}`)
          .join('\n')
      );
    }
  );

  server.registerTool(
    'hive_claim',
    {
      description:
        'Atomically claim a shared task before starting it so no teammate duplicates the work. ' +
        'If the claim is rejected, someone already did or is doing it — skip it and move on.',
      inputSchema: {
        key: z.string().describe('Stable task key, e.g. task:write-readme'),
        title: z.string().describe('What the task is'),
      },
    },
    async ({ key, title }) => {
      const r = ledger.claim({ agent, key, title });
      if (r.ok) return text(`Claimed ${key}. It is yours — the team sees this.`);
      return text(
        `REJECTED — already handled by ${r.claimed_by} (${Math.round((Date.now() - r.ts) / 60000)} min ago). ` +
          `What they did: ${r.what_they_did}. Do NOT redo this; build on it or take the next task.`
      );
    }
  );

  server.registerTool(
    'hive_status',
    {
      description: "Team status: who is in the hive, what is shared, duplicates prevented, and the Queen's synthesis of where the team is.",
      inputSchema: {},
    },
    async () => {
      const queen = await maybeSynthesize(ledger);
      const s = ledger.status();
      const agents = s.agents.map((a) => `${a.name}${a.active ? ' (active)' : ''}`).join(', ') || 'none yet';
      return text(
        `Agents: ${agents}\nItems shared: ${s.shared} · Duplicates prevented: ${s.deduped}\n\nWhere are we (Queen):\n${queen?.body || 'synthesis unavailable'}`
      );
    }
  );

  return server;
}

async function readBody(req) {
  if (req.method !== 'POST') return undefined;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export function createMcpHandler(ledger) {
  const transports = new Map(); // sessionId -> transport

  return async function handleMcp(req, res) {
    const url = new URL(req.url, 'http://localhost');
    // Primary: Authorization header. Fallback: ?token= — same shared team token,
    // for MCP clients that drop custom headers.
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || url.searchParams.get('token') || '';
    if (process.env.HIVE_TOKEN && token !== process.env.HIVE_TOKEN) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message: 'unauthorized' }, id: null }));
      return;
    }

    const body = await readBody(req);
    const sessionId = req.headers['mcp-session-id'];
    let transport = sessionId ? transports.get(sessionId) : undefined;

    if (!transport) {
      const agent = (url.searchParams.get('agent') || 'anonymous').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 24) || 'anonymous';
      if (body && isInitializeRequest(body)) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => transports.set(id, transport),
        });
      } else if (sessionId) {
        // Server restarted and the client kept its session id. Claude Code does not
        // reliably re-initialize on a 404 (known client regressions), so adopt the
        // session instead of rejecting it. Internals match the lockfile-pinned SDK.
        const sid = String(sessionId);
        transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => sid });
        try {
          transport._webStandardTransport.sessionId = sid;
          transport._webStandardTransport._initialized = true;
        } catch (e) {
          console.error('[mcp] session adoption unavailable:', e.message);
        }
        transports.set(sid, transport);
      } else {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'no session; initialize first' }, id: null }));
        return;
      }
      transport.onclose = () => {
        if (transport.sessionId) transports.delete(transport.sessionId);
      };
      await buildServer(ledger, agent).connect(transport);
    }

    await transport.handleRequest(req, res, body);
  };
}
