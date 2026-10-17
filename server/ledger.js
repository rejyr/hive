import Database from 'better-sqlite3';

const VERBS = new Set(['SHARE', 'RECALL', 'CLAIM', 'DEDUPE', 'QUEEN', 'JOIN']);

// Hive names and agent names share the same shape: short kebab/word tokens.
export function sanitizeName(s, fallback) {
  return (String(s || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 24)) || fallback;
}

export function openLedger(dbPath = process.env.HIVE_DB_PATH || './hive.db') {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  const CREATE = `
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hive TEXT NOT NULL DEFAULT 'default',
      ts INTEGER NOT NULL,
      agent TEXT NOT NULL,
      verb TEXT NOT NULL,
      key TEXT,
      title TEXT NOT NULL,
      body TEXT
    );
    CREATE INDEX IF NOT EXISTS events_hive ON events (hive, id);
    CREATE TABLE IF NOT EXISTS memories (
      hive TEXT NOT NULL DEFAULT 'default',
      key TEXT NOT NULL,
      agent TEXT NOT NULL,
      ts INTEGER NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      PRIMARY KEY (hive, key)
    );
    CREATE TABLE IF NOT EXISTS claims (
      hive TEXT NOT NULL DEFAULT 'default',
      key TEXT NOT NULL,
      agent TEXT NOT NULL,
      ts INTEGER NOT NULL,
      title TEXT NOT NULL,
      PRIMARY KEY (hive, key)
    );
    CREATE TABLE IF NOT EXISTS hives (
      name TEXT PRIMARY KEY,
      repo TEXT,
      token TEXT,
      ts INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS hives_token ON hives (token) WHERE token IS NOT NULL;
    CREATE TABLE IF NOT EXISTS members (
      hive TEXT NOT NULL,
      tag TEXT NOT NULL,
      ts INTEGER NOT NULL,
      PRIMARY KEY (hive, tag)
    );
  `;
  // Pre-multi-hive databases lack the hive column; rebuild BEFORE creating the
  // hive index, or that create fails (data was pre-demo noise).
  const eventsExists = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='events'").get().n > 0;
  if (eventsExists) {
    const hasHive = db.prepare("SELECT COUNT(*) AS n FROM pragma_table_info('events') WHERE name = 'hive'").get().n > 0;
    if (!hasHive) {
      console.warn('[ledger] migrating to multi-hive schema (old tables dropped)');
      db.exec('DROP TABLE IF EXISTS events; DROP TABLE IF EXISTS memories; DROP TABLE IF EXISTS claims;');
    }
  }
  // hives table predates per-hive tokens; add the column in place.
  const hivesExists = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='hives'").get().n > 0;
  if (hivesExists) {
    const hasToken = db.prepare("SELECT COUNT(*) AS n FROM pragma_table_info('hives') WHERE name = 'token'").get().n > 0;
    if (!hasToken) db.exec('ALTER TABLE hives ADD COLUMN token TEXT;');
  }
  db.exec(CREATE);

  const insertEvent = db.prepare(
    'INSERT INTO events (hive, ts, agent, verb, key, title, body) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const getEvent = db.prepare('SELECT * FROM events WHERE id = ?');

  let onEvent = () => {};

  function addEvent({ hive = 'default', agent, verb, key = null, title, body = null }) {
    if (!VERBS.has(verb)) throw new Error(`unknown verb: ${verb}`);
    const ts = Date.now();
    const info = insertEvent.run(hive, ts, agent, verb, key, title, body);
    const event = getEvent.get(info.lastInsertRowid);
    onEvent(event);
    return event;
  }

  const upsertMemory = db.prepare(`
    INSERT INTO memories (hive, key, agent, ts, title, body) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(hive, key) DO UPDATE SET agent=excluded.agent, ts=excluded.ts, title=excluded.title, body=excluded.body
  `);

  function share({ hive = 'default', agent, title, body = null, key = null }) {
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
    const memKey = key || `note:${slug || Date.now()}`;
    upsertMemory.run(hive, memKey, agent, Date.now(), title, body);
    return addEvent({ hive, agent, verb: 'SHARE', key: memKey, title, body });
  }

  const searchMemories = db.prepare(`
    SELECT * FROM memories
    WHERE hive = ? AND (key LIKE '%' || ? || '%' OR title LIKE '%' || ? || '%' OR body LIKE '%' || ? || '%')
    ORDER BY ts DESC LIMIT 5
  `);
  const recentMemories = db.prepare('SELECT * FROM memories WHERE hive = ? ORDER BY ts DESC LIMIT 5');

  function recall({ hive = 'default', agent, query }) {
    const q = (query || '').trim();
    const hits = q ? searchMemories.all(hive, q, q, q) : recentMemories.all(hive);
    addEvent({
      hive,
      agent,
      verb: 'RECALL',
      key: hits[0]?.key || null,
      title: q ? `recalled "${q}"` : 'recalled recent context',
      body: hits.length ? `${hits.length} hit(s); top: ${hits[0].title} (${hits[0].agent})` : 'no matches',
    });
    return hits;
  }

  const insertClaim = db.prepare('INSERT INTO claims (hive, key, agent, ts, title) VALUES (?, ?, ?, ?, ?)');
  const getClaim = db.prepare('SELECT * FROM claims WHERE hive = ? AND key = ?');
  const getMemory = db.prepare('SELECT * FROM memories WHERE hive = ? AND key = ?');

  function claim({ hive = 'default', agent, key, title }) {
    try {
      insertClaim.run(hive, key, agent, Date.now(), title);
      addEvent({ hive, agent, verb: 'CLAIM', key, title: `claimed: ${title}` });
      return { ok: true, key };
    } catch (err) {
      if (!String(err.message).includes('UNIQUE')) throw err;
      const existing = getClaim.get(hive, key);
      const mem = getMemory.get(hive, key);
      addEvent({
        hive,
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

  const countMemories = db.prepare('SELECT COUNT(*) AS n FROM memories WHERE hive = ?');
  const countDedupes = db.prepare("SELECT COUNT(*) AS n FROM events WHERE hive = ? AND verb = 'DEDUPE'");
  const agentsSeen = db.prepare(
    "SELECT agent, MAX(ts) AS last_ts FROM events WHERE hive = ? AND agent != 'queen' GROUP BY agent ORDER BY last_ts DESC LIMIT 12"
  );
  const latestQueenStmt = db.prepare("SELECT * FROM events WHERE hive = ? AND verb = 'QUEEN' ORDER BY id DESC LIMIT 1");
  const recentEventsStmt = db.prepare('SELECT * FROM events WHERE hive = ? ORDER BY id DESC LIMIT ?');
  const eventsBeforeStmt = db.prepare('SELECT * FROM events WHERE hive = ? AND id < ? ORDER BY id DESC LIMIT ?');
  const upsertHive = db.prepare(`
    INSERT INTO hives (name, repo, ts) VALUES (?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET repo=COALESCE(excluded.repo, hives.repo)
  `);
  const hiveByToken = db.prepare('SELECT * FROM hives WHERE token = ?');
  const hiveByName = db.prepare('SELECT * FROM hives WHERE name = ?');
  const insertHive = db.prepare('INSERT INTO hives (name, repo, token, ts) VALUES (?, ?, ?, ?)');
  const insertMember = db.prepare('INSERT INTO members (hive, tag, ts) VALUES (?, ?, ?)');
  const membersOf = db.prepare('SELECT tag FROM members WHERE hive = ? ORDER BY ts');
  const openClaims = db.prepare('SELECT key, agent, title, ts FROM claims WHERE hive = ? ORDER BY ts DESC LIMIT 10');

  function counters(hive = 'default') {
    const ACTIVE_MS = 5 * 60 * 1000;
    const now = Date.now();
    // Presence = everyone who claimed a tag, plus anyone seen in events —
    // a freshly joined member shows up before their agent does anything.
    const seen = new Map(
      agentsSeen.all(hive).map((a) => [a.agent, { name: a.agent, active: now - a.last_ts < ACTIVE_MS }])
    );
    for (const m of membersOf.all(hive)) {
      if (!seen.has(m.tag)) seen.set(m.tag, { name: m.tag, active: false });
    }
    return {
      type: 'counters',
      hive,
      agents: [...seen.values()],
      shared: countMemories.get(hive).n,
      deduped: countDedupes.get(hive).n,
      claims: openClaims.all(hive),
    };
  }

  function status(hive = 'default') {
    const queen = latestQueenStmt.get(hive) || null;
    return { ...counters(hive), queen };
  }

  return {
    db,
    addEvent,
    share,
    recall,
    claim,
    counters,
    status,
    registerHive: (name, repo = null) => {
      upsertHive.run(name, repo, Date.now());
      return { name, repo };
    },
    // Create a hive with its own token. Optional name; collisions get a short suffix.
    createHive: (wantedName, randomUUID) => {
      const base = sanitizeName(wantedName, '') || `hive-${randomUUID().slice(0, 4)}`;
      let name = base;
      for (let i = 2; hiveByName.get(name) && i < 50; i++) name = `${base}-${i}`.slice(0, 24);
      const token = `hv_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
      insertHive.run(name, null, token, Date.now());
      return { name, token };
    },
    // null when unknown; the env HIVE_TOKEN maps to the default hive.
    hiveForToken: (token) => {
      if (!token) return null;
      if (process.env.HIVE_TOKEN && token === process.env.HIVE_TOKEN) return 'default';
      const row = hiveByToken.get(token);
      return row ? row.name : null;
    },
    hiveInfo: (name) => hiveByName.get(name) || null,
    // Reserve a unique member tag within a hive; suggests alternatives on collision.
    claimTag: (hive, tag) => {
      const t = sanitizeName(tag, '');
      if (!t) return { ok: false, error: 'tag required' };
      try {
        insertMember.run(hive, t, Date.now());
        addEvent({ hive, agent: t, verb: 'JOIN', title: `${t} joined the hive` });
        return { ok: true, tag: t };
      } catch {
        const taken = membersOf.all(hive).map((m) => m.tag);
        const suggestions = [];
        for (let i = 2; suggestions.length < 3 && i < 30; i++) {
          const s = `${t}-${i}`.slice(0, 24);
          if (!taken.includes(s)) suggestions.push(s);
        }
        return { ok: false, taken: true, suggestions };
      }
    },
    members: (hive) => membersOf.all(hive).map((m) => m.tag),
    latestQueen: (hive = 'default') => latestQueenStmt.get(hive) || null,
    recentEvents: (limit = 50, hive = 'default', before = 0) =>
      (before > 0
        ? eventsBeforeStmt.all(hive, before, Math.min(limit, 200))
        : recentEventsStmt.all(hive, Math.min(limit, 200))
      ).reverse(),
    // Rename a hive everywhere; the token stays the stable key.
    renameHive: (oldName, newName) => {
      const n = sanitizeName(newName, '');
      if (!n) return { error: 'name required' };
      if (n === oldName) return { name: n };
      if (hiveByName.get(n)) return { error: `"${n}" is taken` };
      db.transaction(() => {
        db.prepare('UPDATE hives SET name = ? WHERE name = ?').run(n, oldName);
        for (const t of ['events', 'memories', 'claims', 'members']) {
          db.prepare(`UPDATE ${t} SET hive = ? WHERE hive = ?`).run(n, oldName);
        }
      })();
      return { name: n };
    },
    setOnEvent: (fn) => { onEvent = fn; },
    reset: (hive = 'default') => {
      db.prepare('DELETE FROM events WHERE hive = ?').run(hive);
      db.prepare('DELETE FROM memories WHERE hive = ?').run(hive);
      db.prepare('DELETE FROM claims WHERE hive = ?').run(hive);
    },
  };
}
