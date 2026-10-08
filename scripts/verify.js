// One command that proves the project works:  npm run verify
//   1. unit tests          2. production build of the website
//   3. starts the API against the local Docker database, loads demo data, runs ~100 end-to-end checks
// Exit code 0 = safe to deploy. Anything else prints which step failed.
// Options: --quick (skip step 3, no database needed)
const { spawn, spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), net = require('net');
const root = path.join(__dirname, '..'), apiDir = path.join(root, 'apps/api');
const win = process.platform === 'win32';
const quick = process.argv.includes('--quick');
const step = (n, t) => console.log(`\n\x1b[1m[${n}] ${t}\x1b[0m`);
const fail = (msg) => { console.error(`\n\x1b[31m✗ ${msg}\x1b[0m\n`); process.exit(1); };
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: win, ...opts }).status === 0;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const portOpen = (port) => new Promise(res => { const s = net.connect(port, '127.0.0.1').once('connect', () => { s.destroy(); res(true); }).once('error', () => res(false)); });
const envValue = (key, fallback) => { try { return (fs.readFileSync(path.join(apiDir, '.env'), 'utf8').match(new RegExp(`^${key}=(.*)$`, 'm')) || [])[1]?.trim() || fallback; } catch { return fallback; } };

async function main() {
  if (!fs.existsSync(path.join(apiDir, '.env'))) { step(0, 'First run: creating .env files'); run('node', ['scripts/setup.js']); }
  step(1, 'Unit tests');
  if (!run('npm', ['test'])) fail('Unit tests failed (scroll up to see which).');
  step(2, 'Website production build');
  if (!run('npm', ['run', 'build'])) fail('The website does not build (scroll up for the error).');
  if (quick) return console.log('\n\x1b[32m✓ Quick check passed (tests + build). Run "npm run verify" without --quick for the full end-to-end test.\x1b[0m\n');

  step(3, 'Database');
  if (!(await portOpen(27017))) {
    console.log('MongoDB is not running. Starting it with Docker...');
    if (!run('npm', ['run', 'db:up'])) fail('Could not start MongoDB. Is Docker Desktop open? (Or start MongoDB yourself on port 27017.)');
    for (let i = 0; i < 30 && !(await portOpen(27017)); i++) await sleep(2000);
    await sleep(8000); // lets the single-node replica set finish initialising
  }

  step(4, 'Start the API');
  const port = envValue('API_PORT', '4000'), base = `http://127.0.0.1:${port}`;
  let api, ready = false;
  for (let attempt = 1; attempt <= 6 && !ready; attempt++) {
    api = spawn('node', ['src/index.js'], { cwd: apiDir, stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, LOG_LEVEL: 'warn' } });
    let exited = false; api.once('exit', () => { exited = true; });
    for (let i = 0; i < 30 && !exited && !ready; i++) {
      await sleep(1000);
      ready = await fetch(`${base}/ready`).then(r => r.status === 200).catch(() => false);
    }
    if (!ready) { api.kill(); console.log(`API not ready (attempt ${attempt}/6), retrying...`); await sleep(5000); }
  }
  if (!ready) fail('The API did not become ready. Check MONGO_URI in apps/api/.env and that Docker is running.');

  step(5, 'Demo data + end-to-end checks');
  const env = { ...process.env, SMOKE_API_URL: base };
  const ok = run('node', ['scripts/seed-demo.js'], { cwd: apiDir, env }) && run('node', ['scripts/smoke.js'], { cwd: apiDir, env });
  api.kill();
  if (!ok) fail('End-to-end checks failed (scroll up: lines starting with ✗ show exactly what broke).');
  console.log('\n\x1b[32m✓ Everything passed. This version is safe to deploy.\x1b[0m\n');
}
main().catch(e => fail(e.message));
