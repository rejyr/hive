// Deploy Hive to a Freestyle VM at https://$HIVE_DOMAIN (docs/ARCHITECTURE.md §Deploy).
// Needs FREESTYLE_API_KEY in .env (created via: npx freestyle login && freestyle billing redeem && freestyle tokens create).
// Usage: node scripts/deploy.js            — full deploy (create VM if missing, upload, systemd, TLS, health)
//        node scripts/deploy.js --code     — code-only redeploy (upload + restart, seconds)
import 'dotenv/config';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const DOMAIN = process.env.HIVE_DOMAIN || 'hive.style.dev';
const SLUG = 'hive';
const PORT = 3000;
const CODE_ONLY = process.argv.includes('--code');

if (!process.env.FREESTYLE_API_KEY) {
  console.error('FREESTYLE_API_KEY missing from .env — run the login/redeem/token steps in docs/ARCHITECTURE.md first.');
  process.exit(1);
}

function sh(cmd, opts = {}) {
  console.log(`\n$ ${cmd}`);
  return execSync(cmd, { stdio: opts.capture ? 'pipe' : 'inherit', encoding: 'utf8', env: process.env, ...opts });
}
// Everything the VM needs to run the server; .env is NOT uploaded (vm gets its own, below).
function makeTarball() {
  sh(`tar -czf hive.tar.gz --exclude node_modules --exclude .git --exclude .env --exclude '*.db*' server public scripts docs package.json package-lock.json CLAUDE.md AGENTS.md README.md .env.example`);
}

const cli = `npx -y freestyle@latest`;

async function ensureVm() {
  const { Freestyle } = await import('freestyle').catch(() => import('freestyle-sandboxes')).catch(() => ({}));
  if (!Freestyle) {
    console.log('freestyle SDK not installed — trying CLI for VM create (run: npm i -D freestyle)');
    sh(`${cli} vm create --slug ${SLUG}`, { capture: false });
    return null;
  }
  const fs = new Freestyle();
  try {
    const vm = await fs.vms.create({
      slug: SLUG,
      idleTimeoutSeconds: null, // never pause — idle pause kills the demo
      firewall: { rules: [{ action: 'allow', source: {}, destination: { public: true } }] },
    });
    console.log(`VM created: ${vm.id || SLUG}`);
    return { fs, vm };
  } catch (err) {
    console.log(`VM create: ${err.message} (assuming '${SLUG}' already exists — continuing)`);
    return { fs, vm: null };
  }
}

async function ensureTls(ctx) {
  try {
    if (ctx?.fs) {
      await ctx.fs.tls.rules.create({
        action: 'allow',
        domain: DOMAIN,
        source: { public: true },
        destination: { vm: SLUG, port: PORT },
      });
      console.log(`TLS: https://${DOMAIN} -> ${SLUG}:${PORT}`);
      return;
    }
  } catch (err) {
    console.log(`TLS via SDK: ${err.message} — trying CLI`);
  }
  try {
    sh(`${cli} tls create --domain ${DOMAIN} --from public --to vm=${SLUG},port=${PORT}`);
  } catch {
    console.log('TLS rule may already exist — continuing');
  }
}

function uploadAndStart() {
  makeTarball();
  sh(`${cli} vm scp hive.tar.gz ${SLUG}:/root/hive.tar.gz`);
  // Build the VM-side .env from local .env (token + queen config travel; freestyle key does NOT).
  const env = readFileSync('.env', 'utf8')
    .split('\n')
    .filter((l) => /^(PORT|HIVE_TOKEN|HIVE_DB_PATH|QUEEN_BASE_URL|QUEEN_API_KEY|QUEEN_MODEL)=/.test(l))
    .join('\n');
  const setup = [
    `mkdir -p /srv/hive`,
    `tar -xzf /root/hive.tar.gz -C /srv/hive`,
    `cd /srv/hive && npm ci --omit=dev --no-audit --no-fund`,
    `printf '%s\\n' ${JSON.stringify(env)} > /srv/hive/.env`,
    `printf '[Unit]\\nDescription=hive\\nAfter=network.target\\n[Service]\\nWorkingDirectory=/srv/hive\\nExecStart=/usr/bin/env node server/index.js\\nRestart=always\\nEnvironmentFile=/srv/hive/.env\\n[Install]\\nWantedBy=multi-user.target\\n' > /etc/systemd/system/hive.service`,
    `systemctl daemon-reload && systemctl enable --now hive && systemctl restart hive`,
    `sleep 1 && systemctl --no-pager status hive | head -5`,
  ].join(' && ');
  sh(`${cli} vm exec ${SLUG} ${JSON.stringify(setup)}`);
}

async function health() {
  for (let i = 0; i < 20; i++) {
    try {
      const r = await fetch(`https://${DOMAIN}/health`, { signal: AbortSignal.timeout(4000) });
      if (r.ok) {
        console.log(`\nLIVE: https://${DOMAIN}/health ->`, await r.text());
        return true;
      }
    } catch {}
    await new Promise((res) => setTimeout(res, 3000));
  }
  console.error(`\nhttps://${DOMAIN}/health not responding — check: ${cli} vm ssh ${SLUG} then journalctl -u hive -f`);
  return false;
}

if (!existsSync('server/index.js')) {
  console.error('Run from the repo root.');
  process.exit(1);
}
if (CODE_ONLY) {
  uploadAndStart();
} else {
  const ctx = await ensureVm();
  uploadAndStart();
  await ensureTls(ctx);
}
process.exit((await health()) ? 0 : 1);
