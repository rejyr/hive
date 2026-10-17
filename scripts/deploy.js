// Deploy Hive to a Freestyle VM at https://$HIVE_DOMAIN (docs/ARCHITECTURE.md §Deploy).
// Needs FREESTYLE_API_KEY in .env (npx freestyle login → billing redeem → tokens create).
// Usage: node scripts/deploy.js          — full deploy (VM if missing, upload, systemd, TLS, health)
//        node scripts/deploy.js --code   — code-only redeploy (upload + restart, seconds)
import 'dotenv/config';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';

const DOMAIN = process.env.HIVE_DOMAIN || 'hive.style.dev';
const SLUG = process.env.HIVE_VM || 'hive'; // HIVE_VM: id or slug of an existing VM to deploy onto
const PORT = 3000;
const CODE_ONLY = process.argv.includes('--code');
const cli = 'npx -y freestyle@0.2.20'; // pinned: 'latest' re-resolves per call and could change mid-demo

if (!process.env.FREESTYLE_API_KEY) {
  console.error('FREESTYLE_API_KEY missing from .env — run the login/redeem/token steps in docs/ARCHITECTURE.md first.');
  process.exit(1);
}
if (!existsSync('server/index.js')) {
  console.error('Run from the repo root.');
  process.exit(1);
}

function sh(cmd, opts = {}) {
  console.log(`\n$ ${cmd}`);
  return execSync(cmd, { stdio: opts.capture ? 'pipe' : 'inherit', encoding: 'utf8', env: process.env, ...opts });
}

async function ensureVm() {
  if (process.env.HIVE_VM) {
    console.log(`Using existing VM ${SLUG} (HIVE_VM set — skipping create)`);
  } else try {
    const { Freestyle } = await import('freestyle');
    const fs = new Freestyle();
    try {
      const created = await fs.vms.create({
        slug: SLUG,
        firewall: { rules: [{ action: 'allow', source: {}, destination: { public: true } }] },
      });
      console.log(`VM created: ${created.vmId || SLUG}`);
    } catch (err) {
      console.log(`VM create: ${err.message} (assuming '${SLUG}' exists — continuing)`);
    }
  } catch {
    console.log('freestyle SDK unavailable — creating via CLI (--no-ssh avoids the interactive shell)');
    try {
      sh(`${cli} vm create --slug ${SLUG} --no-ssh`);
    } catch {
      console.log(`VM create via CLI failed (may already exist) — continuing`);
    }
  }
  // Never idle-pause: -1 disables the timeout (documented on vm update; '=' so -1 isn't read as a flag).
  try {
    sh(`${cli} vm update ${SLUG} --idle-timeout-seconds=-1`);
  } catch {
    console.log('idle-timeout update failed — VERIFY in dash.freestyle.sh that the VM cannot pause');
  }
}

function uploadAndStart() {
  sh(`tar -czf hive.tar.gz --exclude node_modules --exclude .git --exclude .env --exclude '*.db*' server public scripts docs package.json package-lock.json CLAUDE.md AGENTS.md README.md .env.example`);
  sh(`${cli} vm scp hive.tar.gz ${SLUG}:/home/ubuntu/hive.tar.gz`);

  // VM-side .env: write locally, scp it — never printf env through two shells.
  const env = readFileSync('.env', 'utf8')
    .split('\n')
    .filter((l) => /^(PORT|HIVE_TOKEN|HIVE_DB_PATH|QUEEN_BASE_URL|QUEEN_API_KEY|QUEEN_MODEL)=/.test(l))
    .join('\n') + '\n';
  writeFileSync('.env.vm', env);
  sh(`${cli} vm scp .env.vm ${SLUG}:/home/ubuntu/hive.env`);

  // Provisioning runs as a real script on the VM: `vm exec <vm> -- <cmd>` is the documented form.
  writeFileSync('vm-setup.sh', `#!/bin/bash
set -euo pipefail
mkdir -p /srv/hive
tar -xzf /home/ubuntu/hive.tar.gz -C /srv/hive
mv /home/ubuntu/hive.env /srv/hive/.env
cd /srv/hive && npm ci --omit=dev --no-audit --no-fund
cat > /etc/systemd/system/hive.service <<'UNIT'
[Unit]
Description=hive
After=network.target
[Service]
WorkingDirectory=/srv/hive
EnvironmentFile=/srv/hive/.env
ExecStart=/usr/local/bin/node server/index.js
Restart=always
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable hive
systemctl restart hive
sleep 1
systemctl --no-pager status hive | head -5
wc -l /srv/hive/.env
`);
  sh(`${cli} vm scp vm-setup.sh ${SLUG}:/home/ubuntu/vm-setup.sh`);
  sh(`${cli} vm exec ${SLUG} -- sudo bash /home/ubuntu/vm-setup.sh`);
  rmSync('.env.vm', { force: true });
  rmSync('vm-setup.sh', { force: true });
}

function ensureTls() {
  // CLI form verified against docs; the SDK call shape is easy to get wrong, so CLI only.
  try {
    sh(`${cli} tls create --domain ${DOMAIN} --from public --to vm=${SLUG},port=${PORT}`);
  } catch {
    console.log('TLS rule create failed (may already exist) — continuing');
  }
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
  console.error(`\nhttps://${DOMAIN}/health not responding — debug: ${cli} vm ssh ${SLUG} ; journalctl -u hive -f`);
  return false;
}

if (CODE_ONLY) {
  uploadAndStart();
} else {
  await ensureVm();
  uploadAndStart();
  ensureTls();
}
process.exit((await health()) ? 0 : 1);
