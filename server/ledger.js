import Database from 'better-sqlite3';

const VERBS = new Set(['SHARE', 'RECALL', 'CLAIM', 'DEDUPE', 'QUEEN']);

export function openLedger(dbPath = process.env.HIVE_DB_PATH || './hive.db') {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      agent TEXT NOT NULL,
      verb TEXT NOT NULL,
      key TEXT,
      title TEXT NOT NULL,
      body TEXT
    );
    CREATE TABLE IF NOT EXISTS memories (
      key TEXT PRIMARY KEY,
      agent TEXT NOT NULL,
      ts INTEGER NOT NULL,
      title TEXT NOT NULL,
      body TEXT
    );
    CREATE TABLE IF NOT EXISTS claims (
      key TEXT PRIMARY KEY,
      agent TEXT NOT NULL,
      ts INTEGER NOT NULL,
      title TEXT NOT NULL
    );
  `);

  const insertEvent = db.prepare(
    'INSERT INTO events (ts, agent, verb, key, title, body) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const getEvent = db.prepare('SELECT * FROM events WHERE id = ?');

  let onEvent = () => {};

  function addEvent({ agent, verb, key = null, title, body = null }) {
    if (!VERBS.has(verb)) throw new Error(`unknown verb: ${verb}`);
    const ts = Date.now();
    const info = insertEvent.run(ts, agent, verb, key, title, body);
    const event = getEvent.get(info.lastInsertRowid);
    onEvent(event);
    return event;
  }

  const upsertMemory = db.prepare(`
    INSERT INTO memories (key, agent, ts, title, body) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET agent=excluded.agent, ts=excluded.ts, title=excluded.title, body=excluded.body
  `);

  function share({ agent, title, body = null, key = null }) {
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
    const memKey = key || `note:${slug || Date.now()}`;
    upsertMemory.run(memKey, agent, Date.now(), title, body);
    return addEvent({ agent, verb: 'SHARE', key: memKey, title, body });
  }

  const searchMemories = db.prepare(`
    SELECT * FROM memories
    WHERE key LIKE '%' || ? || '%' OR title LIKE '%' || ? || '%' OR body LIKE '%' || ? || '%'
    ORDER BY ts DESC LIMIT 5
  `);
  const recentMemories = db.prepare('SELECT * FROM memories ORDER BY ts DESC LIMIT 5');

  function recall({ agent, query }) {
    const q = (query || '').trim();
    const hits = q ? searchMemories.all(q, q, q) : recentMemories.all();
    addEvent({
      agent,
      verb: 'RECALL',
      key: hits[0]?.key || null,
      title: q ? `recalled "${q}"` : 'recalled recent context',
      body: hits.length ? `${hits.length} hit(s); top: ${hits[0].title} (${hits[0].agent})` : 'no matches',
    });
    return hits;
  }

  const insertClaim = db.prepare('INSERT INTO claims (key, agent, ts, title) VALUES (?, ?, ?, ?)');
  const getClaim = db.prepare('SELECT * FROM claims WHERE key = ?');
  const getMemory = db.prepare('SELECT * FROM memories WHERE key = ?');

  function claim({ agent, key, title }) {
    try {
      insertClaim.run(key, agent, Date.now(), title);
      addEvent({ agent, verb: 'CLAIM', key, title: `claimed: ${title}` });
      return { ok: true, key };
    } catch (err) {
      if (!String(err.message).includes('UNIQUE')) throw err;
      const existing = getClaim.get(key);
      const mem = getMemory.get(key);
      addEvent({
        agent,
        verb: 'DEDUPE',
        key,
        title: `duplicate prevented: already handled by ${existing.agent}`,
        body: mem ? mem.title : existing.title,
      });
      return {
        ok: false,
        key,
        claimed_by: existing.agent,
        ts: existing.ts,
        what_they_did: mem ? `${mem.title}${mem.body ? ` — ${mem.body}` : ''}` : existing.title,
      };
    }
  }

  const countMemories = db.prepare('SELECT COUNT(*) AS n FROM memories');
  const countDedupes = db.prepare("SELECT COUNT(*) AS n FROM events WHERE verb = 'DEDUPE'");
  const agentsSeen = db.prepare(
    "SELECT agent, MAX(ts) AS last_ts FROM events WHERE agent != 'queen' GROUP BY agent ORDER BY last_ts DESC LIMIT 12"
  );
  const latestQueen = db.prepare("SELECT * FROM events WHERE verb = 'QUEEN' ORDER BY id DESC LIMIT 1");
  const recentEvents = db.prepare('SELECT * FROM events ORDER BY id DESC LIMIT ?');

  function counters() {
    const ACTIVE_MS = 5 * 60 * 1000;
    const now = Date.now();
    return {
      type: 'counters',
      agents: agentsSeen.all().map((a) => ({ name: a.agent, active: now - a.last_ts < ACTIVE_MS })),
      shared: countMemories.get().n,
      deduped: countDedupes.get().n,
    };
  }

  function status() {
    const queen = latestQueen.get() || null;
    return { ...counters(), queen };
  }

  return {
    db,
    addEvent,
    share,
    recall,
    claim,
    counters,
    status,
    latestQueen: () => latestQueen.get() || null,
    recentEvents: (limit = 50) => recentEvents.all(Math.min(limit, 200)).reverse(),
    setOnEvent: (fn) => { onEvent = fn; },
    reset: () => db.exec('DELETE FROM events; DELETE FROM memories; DELETE FROM claims;'),
  };
}
