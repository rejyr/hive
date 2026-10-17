/* Hive live-feed client — vanilla JS, no deps.
 * Wire format (docs/IMPLEMENTATION.md, pinned):
 *   event:    {"type":"event","event":{id,ts,agent,verb,key,title,body}}
 *   counters: {"type":"counters","agents":[{"name":"vihaan","active":true}],"shared":42,"deduped":5}
 *             ("agents" may also arrive as a plain number; both are handled)
 * Mock mode: append ?mock=1 to demo without the server.
 */
(function () {
  'use strict';

  var root = document.querySelector('[data-hive-root]') || document.body;
  var COMPACT = root.getAttribute('data-variant') === 'compact';
  var MAX_ROWS = COMPACT ? 6 : 10;
  var MOCK = new URLSearchParams(location.search).get('mock') === '1';
  var HIVE = (new URLSearchParams(location.search).get('hive') || 'default')
    .toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 24) || 'default';
  var reducedMotion = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function $(sel) { return root.querySelector(sel); }

  var el = {
    feed: $('[data-hive="feed"]'),
    empty: $('[data-hive="empty"]'),
    dot: $('[data-hive="dot"]'),
    connLabel: $('[data-hive="conn-label"]'),
    avatars: $('[data-hive="avatars"]'),
    queenBody: $('[data-hive="queen-body"]'),
    queenTs: $('[data-hive="queen-ts"]'),
    refresh: $('[data-hive="refresh"]'),
    hiveTag: $('[data-hive="hivetag"]'),
    counters: {
      agents: $('[data-counter="agents"]'),
      shared: $('[data-counter="shared"]'),
      deduped: $('[data-counter="deduped"]')
    }
  };

  /* ---------- agent ring colors (stable per agent) ---------- */

  var KNOWN_RINGS = { vihaan: '#E0713F', maya: '#4E9BB9', jay: '#C65D8A' };
  var RING_PALETTE = ['#E0713F', '#4E9BB9', '#C65D8A', '#7FA65A', '#B08D3F', '#5F8F7B'];

  function ringColor(name) {
    name = String(name || '?');
    if (KNOWN_RINGS[name]) return KNOWN_RINGS[name];
    var h = 0;
    for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return RING_PALETTE[h % RING_PALETTE.length];
  }

  /* ---------- state ---------- */

  var seen = {};                 // event id -> true
  var agents = {};               // name -> last event ts
  var derived = { shared: 0, deduped: 0 };
  var serverCounters = null;     // latest {"type":"counters"} payload
  var queen = null;              // latest QUEEN event
  var ACTIVE_WINDOW_MS = 150000; // agent "active" if seen in last 2.5 min

  /* ---------- relative time ---------- */

  function relTime(ts) {
    var s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 10) return 'just now';
    if (s < 60) return s + 's ago';
    var m = Math.round(s / 60);
    if (m < 60) return m + ' min ago';
    var h = Math.round(m / 60);
    if (h < 24) return h + ' hr ago';
    return Math.round(h / 24) + 'd ago';
  }

  function rerenderTimes() {
    var nodes = root.querySelectorAll('[data-ts]');
    for (var i = 0; i < nodes.length; i++) {
      var ts = Number(nodes[i].getAttribute('data-ts'));
      if (ts) nodes[i].textContent = relTime(ts);
    }
    if (queen && el.queenTs) {
      el.queenTs.textContent = 'synthesized ' + relTime(queen.ts);
    }
    renderAvatars(); // active/idle rings age out too
  }

  /* ---------- rendering ---------- */

  function hexAvatar(name, active) {
    var av = document.createElement('span');
    av.className = 'hexav' + (active ? '' : ' idle');
    if (active) av.style.setProperty('--ring', ringColor(name));
    av.title = name;
    var inner = document.createElement('span');
    inner.className = 'hexav-in';
    inner.textContent = String(name || '?').charAt(0);
    av.appendChild(inner);
    return av;
  }

  function addEventRow(ev, animate) {
    if (!ev) return;
    var id = ev.id != null ? ev.id
      : (ev.ts || 0) + ':' + ev.agent + ':' + ev.verb + ':' + (ev.key || '');
    if (seen[id]) return;
    seen[id] = true;
    trackEvent(ev);
    if (!el.feed) return;

    var li = document.createElement('li');
    li.className = 'feed-row' + (animate && !reducedMotion ? ' row-in' : '');

    var active = (Date.now() - (ev.ts || 0)) < ACTIVE_WINDOW_MS;
    li.appendChild(hexAvatar(ev.agent, active));

    var verb = String(ev.verb || '').toUpperCase();
    var badge = document.createElement('span');
    badge.className = 'badge badge-' +
      (/^(SHARE|RECALL|CLAIM|DEDUPE|QUEEN)$/.test(verb) ? verb : 'QUEEN');
    badge.textContent = verb || '—';
    li.appendChild(badge);

    var title = document.createElement('span');
    title.className = 'row-title';
    title.textContent = ev.title || '';
    li.appendChild(title);

    if (ev.key) {
      var key = document.createElement('code');
      key.className = 'row-key';
      key.textContent = ev.key;
      li.appendChild(key);
    }

    var time = document.createElement('time');
    time.className = 'row-time';
    time.setAttribute('data-ts', String(ev.ts || Date.now()));
    time.textContent = relTime(ev.ts || Date.now());
    li.appendChild(time);

    el.feed.insertBefore(li, el.feed.firstChild);
    while (el.feed.children.length > MAX_ROWS) {
      el.feed.removeChild(el.feed.lastChild);
    }
    if (el.empty) el.empty.hidden = true;
  }

  function trackEvent(ev) {
    // the queen is the orchestrator, not a teammate agent — keep it out of the stack
    if (ev.agent && ev.agent !== 'queen') {
      agents[ev.agent] = Math.max(agents[ev.agent] || 0, ev.ts || Date.now());
    }
    if (ev.verb === 'SHARE') derived.shared++;
    if (ev.verb === 'DEDUPE') derived.deduped++;
    if (ev.verb === 'QUEEN' && (!queen || (ev.ts || 0) >= (queen.ts || 0))) {
      queen = ev;
      renderQueen();
    }
  }

  function renderQueen() {
    if (!queen || !el.queenBody) return;
    el.queenBody.textContent = queen.body || queen.title || '';
    el.queenBody.classList.remove('empty');
    if (el.queenTs) el.queenTs.textContent = 'synthesized ' + relTime(queen.ts);
  }

  function setCounter(node, value) {
    if (!node) return;
    var text = String(value);
    if (node.textContent === text) return;
    node.textContent = text;
    if (!reducedMotion) {
      node.classList.remove('tick');
      void node.offsetWidth; // restart animation
      node.classList.add('tick');
    }
  }

  function agentList() {
    // Prefer the server's agents array; fall back to what the feed implies.
    if (serverCounters && Array.isArray(serverCounters.agents)) {
      return serverCounters.agents.map(function (a) {
        return { name: a.name, active: !!a.active };
      });
    }
    var now = Date.now();
    return Object.keys(agents).sort().map(function (name) {
      return { name: name, active: now - agents[name] < ACTIVE_WINDOW_MS };
    });
  }

  function renderCounters() {
    var list = agentList();
    var agentCount = list.length;
    if (serverCounters && typeof serverCounters.agents === 'number') {
      agentCount = serverCounters.agents;
    }
    setCounter(el.counters.agents, agentCount);
    setCounter(el.counters.shared,
      serverCounters && serverCounters.shared != null ? serverCounters.shared : derived.shared);
    setCounter(el.counters.deduped,
      serverCounters && serverCounters.deduped != null ? serverCounters.deduped : derived.deduped);
  }

  function renderAvatars() {
    if (!el.avatars) return;
    el.avatars.textContent = '';
    agentList().forEach(function (a) {
      el.avatars.appendChild(hexAvatar(a.name, a.active));
    });
  }

  function setConn(state, label) {
    if (el.dot) {
      el.dot.className = 'dot' +
        (state === 'live' ? ' on' : state === 'connecting' ? ' warn' : '');
    }
    if (el.connLabel) el.connLabel.textContent = label || state;
  }

  function handleMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'event' && msg.event) {
      addEventRow(msg.event, true);
      renderCounters();
      renderAvatars();
    } else if (msg.type === 'counters') {
      serverCounters = msg;
      renderCounters();
      renderAvatars();
    }
  }

  /* ---------- backfill + polling fallback ---------- */

  function backfill() {
    return fetch('/api/events?limit=50&hive=' + HIVE)
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data) return;
        var list = Array.isArray(data) ? data : (data.events || []);
        list = list.slice().sort(function (a, b) {
          return (a.ts || 0) - (b.ts || 0) || (a.id || 0) - (b.id || 0);
        });
        list.forEach(function (ev) { addEventRow(ev, false); });
        renderCounters();
        renderAvatars();
      })
      .catch(function () {});
  }

  var pollTimer = null;
  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(backfill, 5000);
  }
  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  /* ---------- websocket with heartbeat + capped backoff ---------- */

  var ws = null;
  var attempts = 0;
  var pingTimer = null;

  function connect() {
    setConn('connecting');
    var url = (location.protocol === 'https:' ? 'wss' : 'ws') + '://' + location.host + '/ws?hive=' + HIVE;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      wsDown();
      return;
    }
    ws.onopen = function () {
      attempts = 0;
      setConn('live');
      stopPolling();
      backfill(); // catch anything missed while reconnecting
      clearInterval(pingTimer);
      pingTimer = setInterval(function () {
        try { ws.send(JSON.stringify({ type: 'ping' })); } catch (e) {}
      }, 20000);
    };
    ws.onmessage = function (m) {
      var msg;
      try { msg = JSON.parse(m.data); } catch (e) { return; }
      handleMessage(msg);
    };
    ws.onclose = wsDown;
    ws.onerror = function () { try { ws.close(); } catch (e) {} };
  }

  function wsDown() {
    clearInterval(pingTimer);
    setConn('down', 'reconnecting');
    startPolling();
    var delay = Math.min(15000, 1000 * Math.pow(2, attempts++)) + Math.random() * 400;
    setTimeout(connect, delay);
  }

  /* ---------- mock mode (?mock=1) — no network, plausible events ---------- */

  var MOCK_AGENTS = ['vihaan', 'maya', 'jay'];
  var MOCK_POOL = {
    SHARE: [
      ['deploy:server', 'Server deployed to hive.style.dev'],
      ['schema:events', 'Events table schema is final'],
      ['decision:wire-format', 'Wire format pinned in docs/IMPLEMENTATION.md'],
      ['api:events', 'GET /api/events?limit=50 returns newest last'],
      ['design:tokens', 'Design tokens locked — warm paper, honey accent'],
      ['auth:token', 'Team bearer token rotated, value in .env']
    ],
    RECALL: [
      ['deploy:server', 'Recalled the deploy URL shared by vihaan'],
      ['schema:events', 'Recalled the events schema before wiring the feed'],
      ['decision:wire-format', 'Recalled the pinned wire format'],
      ['api:events', 'Recalled the backfill endpoint and limit']
    ],
    CLAIM: [
      ['task:dashboard', 'Claimed the dashboard build'],
      ['task:readme', 'Claimed README and setup docs'],
      ['task:mcp-endpoint', 'Claimed the MCP endpoint'],
      ['task:demo-script', 'Claimed the 90-second demo script']
    ],
    DEDUPE: [
      ['docs:setup', 'Duplicate prevented — already claimed by vihaan'],
      ['task:smoke-test', 'Duplicate prevented — already claimed by maya'],
      ['task:seed-script', 'Duplicate prevented — already claimed by jay']
    ],
    QUEEN: [
      ['status:synthesis', 'Where are we?',
        'Server is live on hive.style.dev with the ledger and MCP endpoint done. ' +
        'Maya is wiring the dashboard feed against the pinned wire format, and jay ' +
        'has the README and demo script claimed. One duplicate was prevented on ' +
        'docs:setup. Next up: the three-laptop integration test.']
    ]
  };

  var mockId = 1;

  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  function makeMockEvent(verb, ts, agent) {
    var row = pick(MOCK_POOL[verb]);
    return {
      id: mockId++,
      ts: ts,
      agent: agent || pick(MOCK_AGENTS),
      verb: verb,
      key: row[0],
      title: row[1],
      body: row[2] || ''
    };
  }

  function mockVerb() {
    var r = Math.random();
    if (r < 0.34) return 'SHARE';
    if (r < 0.60) return 'RECALL';
    if (r < 0.82) return 'CLAIM';
    if (r < 0.94) return 'DEDUPE';
    return 'QUEEN';
  }

  function startMock() {
    setConn('live', 'mock');
    var now = Date.now();
    // seed a believable backfill: every verb visible, one QUEEN for the panel
    var seed = [
      makeMockEvent('SHARE', now - 14 * 60000, 'vihaan'),
      makeMockEvent('CLAIM', now - 12 * 60000, 'maya'),
      makeMockEvent('SHARE', now - 10 * 60000, 'vihaan'),
      makeMockEvent('RECALL', now - 8 * 60000, 'maya'),
      makeMockEvent('CLAIM', now - 6 * 60000, 'jay'),
      makeMockEvent('DEDUPE', now - 4 * 60000, 'jay'),
      makeMockEvent('QUEEN', now - 3 * 60000, 'queen'),
      makeMockEvent('SHARE', now - 60000, 'maya')
    ];
    seed.forEach(function (ev) { addEventRow(ev, false); });
    renderCounters();
    renderAvatars();

    (function loop() {
      setTimeout(function () {
        var verb = mockVerb();
        addEventRow(makeMockEvent(verb, Date.now(), verb === 'QUEEN' ? 'queen' : null), true);
        renderCounters();
        renderAvatars();
        loop();
      }, 2000 + Math.random() * 2000);
    })();
  }

  /* ---------- boot ---------- */

  if (el.refresh) {
    el.refresh.addEventListener('click', function () {
      if (MOCK) {
        addEventRow(makeMockEvent('QUEEN', Date.now(), 'queen'), true);
        renderCounters();
      } else {
        backfill();
      }
    });
  }

  // which hive this page is scoped to (hidden for the default hive)
  if (el.hiveTag && HIVE !== 'default') {
    el.hiveTag.textContent = 'hive: ' + HIVE;
    fetch('/api/hives')
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (list) {
        var h = (list || []).filter(function (x) { return x.name === HIVE; })[0];
        if (h && h.repo) {
          el.hiveTag.textContent = 'hive: ' + HIVE + ' · ';
          var a = document.createElement('a');
          a.href = h.repo;
          a.textContent = 'repo';
          el.hiveTag.appendChild(a);
        }
      })
      .catch(function () {});
  }

  setInterval(rerenderTimes, 30000);

  if (MOCK) {
    startMock();
  } else {
    backfill();
    connect();
  }
})();
