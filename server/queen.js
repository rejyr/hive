const SYSTEM_PROMPT =
  'You are the Queen of Hive, coordinating a team of humans whose AI agents share one ledger. ' +
  'In 4-6 short sentences, plain prose, no markdown, no preamble: what is DONE, what is IN PROGRESS and by whom, ' +
  "and any conflicts or duplicates prevented. If a project brief (key 'brief') is in the ledger, direct the team: " +
  'name who should take which unclaimed piece next so no work is duplicated.';

// Deterministic synthesis straight from the ledger — the Queen's model-free voice.
// Real data only: active agents, freshest share per agent, open claims, counters.
export function buildDigest(ledger, hive = 'default') {
  const s = ledger.status(hive);
  // recentEvents returns oldest-first; reverse so "last shared" finds the newest
  const events = ledger.recentEvents(50, hive).filter((e) => e.verb !== 'QUEEN').reverse();
  if (!events.length) return null;
  const mins = (ts) => Math.max(0, Math.round((Date.now() - ts) / 60000));
  const parts = [];
  // A shared item keyed 'brief' is the project definition — the Queen leads with it.
  const brief = ledger.db
    .prepare("SELECT * FROM memories WHERE hive = ? AND key LIKE 'brief%' ORDER BY ts DESC LIMIT 1")
    .get(hive);
  if (brief) parts.push(`Project: ${brief.title}${brief.body ? ` — ${String(brief.body).slice(0, 220)}` : ''}`);
  const active = s.agents.filter((a) => a.active).map((a) => a.name);
  parts.push(
    `${active.length || s.agents.length} agent${active.length === 1 ? '' : 's'} in the hive` +
      (active.length ? ` (${active.join(', ')})` : '') +
      `. ${s.shared} item${s.shared === 1 ? '' : 's'} shared, ${s.deduped} duplicate${s.deduped === 1 ? '' : 's'} prevented.`
  );
  for (const a of s.agents.slice(0, 4)) {
    const last = events.find((e) => e.agent === a.name && e.verb === 'SHARE');
    if (last) parts.push(`${a.name} last shared: ${last.title} (${mins(last.ts)} min ago).`);
  }
  const claims = ledger.db
    .prepare('SELECT * FROM claims WHERE hive = ? ORDER BY ts DESC LIMIT 5')
    .all(hive)
    .map((c) => `${c.title} (${c.agent})`);
  if (claims.length) parts.push(`In progress: ${claims.join('; ')}.`);
  if (brief) parts.push('Anything in the brief nobody has claimed is up for grabs — claim before starting.');
  return parts.join(' ');
}

// Returns the latest QUEEN event, synthesizing a fresh one when there is news.
// Never throws — Queen failures degrade to the last good synthesis, then the digest.
export async function maybeSynthesize(ledger, { force = false, hive = 'default' } = {}) {
  const base = process.env.QUEEN_BASE_URL;
  const key = process.env.QUEEN_API_KEY;
  const model = process.env.QUEEN_MODEL || 'glm-5.3-flash';
  const latest = ledger.latestQueen(hive);
  if (!base || !key) {
    // No model configured: publish a fresh deterministic digest whenever asked and
    // something changed, so "where are we?" from any agent updates every dashboard.
    const evs = ledger.recentEvents(50, hive);
    const changed = evs.some((e) => (!latest || e.id > latest.id) && e.verb !== 'RECALL' && e.verb !== 'QUEEN');
    if (latest && !changed && !force) return latest;
    const text = buildDigest(ledger, hive);
    if (!text) return latest;
    if (latest && text === latest.body) return latest; // nothing new to say
    return ledger.addEvent({ hive, agent: 'queen', verb: 'QUEEN', title: 'Where are we?', body: text });
  }

  const events = ledger.recentEvents(50, hive);
  const news = events.some((e) => (!latest || e.id > latest.id) && e.verb !== 'RECALL' && e.verb !== 'QUEEN');
  if (!force && latest && (!news || Date.now() - latest.ts < 60_000)) return latest;

  const lines = events
    .filter((e) => e.verb !== 'QUEEN')
    .map((e) => `[${new Date(e.ts).toISOString().slice(11, 19)}] ${e.agent} ${e.verb}${e.key ? ` ${e.key}` : ''} — ${e.title}${e.body ? ` :: ${e.body}` : ''}`)
    .join('\n');
  if (!lines) return latest;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6_000); // demo gate is <5s; degrade fast to the last synthesis
    const r = await fetch(`${base.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `Ledger events, oldest first:\n${lines}` },
        ],
        max_tokens: 300,
        temperature: 0.3,
      }),
    });
    clearTimeout(timer);
    if (!r.ok) throw new Error(`queen http ${r.status}`);
    const data = await r.json();
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('queen returned empty content');
    return ledger.addEvent({ hive, agent: 'queen', verb: 'QUEEN', title: 'Where are we?', body: text });
  } catch (err) {
    console.error('[queen]', err.message);
    return latest;
  }
}
