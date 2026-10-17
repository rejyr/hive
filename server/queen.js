const SYSTEM_PROMPT =
  'You are the Queen of Hive, synthesizing the work of a team of humans whose AI agents share one ledger. ' +
  'In 4-6 short sentences, plain prose, no markdown, no preamble: what is DONE, what is IN PROGRESS and by whom, ' +
  'what is NEXT, and any conflicts or duplicates prevented.';

// Returns the latest QUEEN event, synthesizing a fresh one when there is news.
// Never throws — Queen failures degrade to the last good synthesis (or null).
export async function maybeSynthesize(ledger, { force = false } = {}) {
  const base = process.env.QUEEN_BASE_URL;
  const key = process.env.QUEEN_API_KEY;
  const model = process.env.QUEEN_MODEL || 'glm-5.3-flash';
  const latest = ledger.latestQueen();
  if (!base || !key) return latest;

  const events = ledger.recentEvents(50);
  const news = events.some((e) => (!latest || e.id > latest.id) && e.verb !== 'RECALL' && e.verb !== 'QUEEN');
  if (!force && latest && (!news || Date.now() - latest.ts < 60_000)) return latest;

  const lines = events
    .filter((e) => e.verb !== 'QUEEN')
    .map((e) => `[${new Date(e.ts).toISOString().slice(11, 19)}] ${e.agent} ${e.verb}${e.key ? ` ${e.key}` : ''} — ${e.title}${e.body ? ` :: ${e.body}` : ''}`)
    .join('\n');
  if (!lines) return latest;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15_000);
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
    return ledger.addEvent({ agent: 'queen', verb: 'QUEEN', title: 'Where are we?', body: text });
  } catch (err) {
    console.error('[queen]', err.message);
    return latest;
  }
}
