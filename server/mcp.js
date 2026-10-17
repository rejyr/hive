import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { maybeSynthesize, buildDigest, assignBrief } from './queen.js';
import { sanitizeName } from './ledger.js';

function text(obj) {
  return { content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) }] };
}

function buildServer(ledger, agent, hive, authed = true, token = '') {
  const server = new McpServer({ name: 'hive', version: '0.1.0' });

  // Wrong/missing token: the connection WORKS, but every tool explains the fix.
  // Returning 401 instead would send MCP clients into an OAuth discovery dance
  // that ends in a confusing "dynamic client registration 404".
  const guard = (fn) => async (args) =>
    authed
      ? fn(args)
      : text(
          'Hive: your token is wrong or missing, so nothing was shared or read. ' +
            'Ask a teammate for your hive token (or generate one at https://hive.style.dev/start), ' +
            'fix the token= value in your hive MCP URL, then reconnect the MCP server (/mcp in Claude Code).'
        );

  server.registerTool(
    'hive_share',
    {
      description:
        "Share completed work, a decision, or context with the team's hive so every teammate's agent can use it. " +
        'Use a stable key like "decision:api-schema" or "task:deploy" when the item has an identity. ' +
        "Share the project description with key 'brief' — the Queen uses it to direct the team and assign unclaimed work.",
      inputSchema: {
        title: z.string().min(1).describe('One-line summary of what was done or decided'),
        body: z.string().optional().describe('Details teammates will need'),
        key: z.string().optional().describe('Stable identity key, e.g. decision:api-schema'),
      },
    },
    guard(async ({ title, body, key }) => text(ledger.share({ hive, agent, title, body, key })))
  );

  server.registerTool(
    'hive_recall',
    {
      description:
        "Ask the hive what the team already knows. Searches every teammate's shared context, decisions, and completed work.",
      inputSchema: { query: z.string().describe('What you need to know, e.g. "api schema" or "deploy"') },
    },
    guard(async ({ query }) => {
      const hits = ledger.recall({ hive, agent, query });
      if (!hits.length) return text('No shared context matches. The team has not shared anything about this yet.');
      return text(
        hits
          .map((h) => `• [${h.key}] ${h.title} — shared by ${h.agent}, ${Math.round((Date.now() - h.ts) / 60000)} min ago${h.body ? `\n  ${h.body}` : ''}`)
          .join('\n')
      );
    })
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
    guard(async ({ key, title }) => {
      const r = ledger.claim({ hive, agent, key, title });
      if (r.ok) return text(`Claimed ${key}. It is yours — the team sees this.`);
      return text(
        `ALREADY DONE — ${r.claimed_by} has this (${Math.round((Date.now() - r.ts) / 60000)} min ago, per the hive ledger). ` +
          `What they did: ${r.what_they_did}.\n` +
          `STOP — do not redo it and do not extend it on your own. Tell your human it's already handled and ask which they want: ` +
          `(a) move on to a different part, or (b) build on ${r.claimed_by}'s work with the specific additions they name. Wait for their answer.`
      );
    })
  );

  server.registerTool(
    'hive_status',
    {
      description:
        "Team status: who is in the hive, what is shared, the Queen's synthesis, and YOUR current task. " +
        "With {assign: true}, the Queen splits the project brief (shared with key 'brief') across the team as held claims — " +
        'each agent then receives their task from status.',
      inputSchema: { assign: z.boolean().optional().describe('Queen assigns the brief across members') },
    },
    guard(async ({ assign }) => {
      let assignNote = '';
      if (assign) {
        const r = assignBrief(ledger, hive);
        if (r.error) assignNote = `\nASSIGNMENT: ${r.error}`;
        else
          assignNote =
            `\nASSIGNMENTS MADE: ${r.assigned.map((a) => `${a.agent} → ${a.task}`).join('; ') || 'none'}` +
            (r.skipped.length ? ` · skipped: ${r.skipped.join('; ')}` : '');
      }
      const queen = await maybeSynthesize(ledger, { hive });
      const s = ledger.status(hive);
      const agents = s.agents.map((a) => `${a.name}${a.active ? ' (active)' : ''}`).join(', ') || 'none yet';
      const mine = (s.claims || []).filter((cl) => cl.agent === agent)[0];
      const myTask = mine
        ? `\n\nYOUR current task, ${agent}: ${mine.title} — if your human has approved, start now; hive_share when done.`
        : `\n\nYOU (${agent}) have no open task. Check the brief or ask the Queen to assign (hive_status with assign: true).`;
      const domain = process.env.HIVE_DOMAIN || 'hive.style.dev';
      const dash = hive === 'default' ? `https://${domain}/live` : `https://${domain}/live?token=${token}`;
      return text(
        `Agents: ${agents}\nItems shared: ${s.shared} · Duplicates prevented: ${s.deduped}${assignNote}\n\nWhere are we (Queen):\n${queen?.body || buildDigest(ledger, hive) || 'The hive is empty — share something.'}${myTask}\n\nLive dashboard (share with the humans): ${dash}`
      );
    })
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
    // The token names the hive. Never 401 here — see guard() above.
    const tokenHive = ledger.hiveForToken(token);
    const authed = Boolean(tokenHive);

    const body = await readBody(req);
    const sessionId = req.headers['mcp-session-id'];
    let transport = sessionId ? transports.get(sessionId) : undefined;

    if (!transport) {
      const agent = sanitizeName(url.searchParams.get('agent'), 'anonymous');
      // Custom tokens pin the hive; the env team token may still pick one via &hive=.
      const hive = !tokenHive || tokenHive === 'default'
        ? sanitizeName(url.searchParams.get('hive'), 'default')
        : tokenHive;
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
      await buildServer(ledger, agent, hive, authed, token).connect(transport);
    }

    await transport.handleRequest(req, res, body);
  };
}
