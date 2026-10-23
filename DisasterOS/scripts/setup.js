// One-time local setup: install dependencies, create .env files with fresh secrets, start the
// development database, apply migrations and load the demo seed.
//
//   npm run setup                 # uses the bundled embedded PostgreSQL on port 5433
//   npm run setup -- --own-db     # skip embedded PostgreSQL; you must set DATABASE_URL yourself first
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backend = path.join(root, 'displaceos-backend');
const frontend = path.join(root, 'displaceos-frontend');
const ownDb = process.argv.includes('--own-db');

function run(cmd, args, cwd) {
  console.log(`\n> ${cmd} ${args.join(' ')}   (${path.relative(root, cwd) || '.'})`);
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: true });
  if (r.status !== 0) {
    console.error(`\nSetup stopped: "${cmd} ${args.join(' ')}" failed.`);
    process.exit(r.status ?? 1);
  }
}

// 1. Dependencies
run('npm', ['install'], backend);
run('npm', ['install'], frontend);

// 2. Environment files (never overwrite an existing one)
const backendEnv = path.join(backend, '.env');
if (!existsSync(backendEnv)) {
  const secret = () => randomBytes(48).toString('base64url');
  let env = readFileSync(path.join(backend, '.env.example'), 'utf8')
    .replace('REPLACE_WITH_LONG_RANDOM_STRING', secret())
    .replace('REPLACE_WITH_DIFFERENT_LONG_RANDOM_STRING', secret());
  if (!ownDb) {
    env = env
      .replace('postgresql://USER:PASSWORD@localhost:5433/displaceos?schema=public', 'postgresql://displaceos:displaceos_dev_only@localhost:5433/displaceos?schema=public')
      .replace('postgresql://USER:PASSWORD@localhost:5433/displaceos_test?schema=public', 'postgresql://displaceos:displaceos_dev_only@localhost:5433/displaceos_test?schema=public');
  }
  writeFileSync(backendEnv, env);
  console.log('\nCreated displaceos-backend/.env with new random secrets.');
} else {
  console.log('\ndisplaceos-backend/.env already exists — leaving it unchanged.');
}
const frontendEnv = path.join(frontend, '.env');
if (!existsSync(frontendEnv)) copyFileSync(path.join(frontend, '.env.example'), frontendEnv);

if (ownDb && readFileSync(backendEnv, 'utf8').includes('USER:PASSWORD')) {
  console.error('\nEdit DATABASE_URL and TEST_DATABASE_URL in displaceos-backend/.env, then run "npm run setup -- --own-db" again.');
  process.exit(1);
}

// 3. Database: start the embedded server just long enough to migrate and seed.
let pg = null;
if (!ownDb) {
  console.log('\n> Starting local development PostgreSQL…');
  pg = spawn('node', ['scripts/local-postgres.js'], { cwd: backend, shell: false });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('PostgreSQL did not start within 120 s')), 120000);
    pg.stdout.on('data', (d) => {
      process.stdout.write(d);
      if (String(d).includes('running on port')) {
        clearTimeout(timer);
        resolve();
      }
    });
    pg.stderr.on('data', (d) => process.stderr.write(d));
    pg.on('exit', (code) => reject(new Error(`PostgreSQL exited early (code ${code}). Is port 5433 already in use?`)));
  }).catch((err) => {
    console.error(`\n${err.message}`);
    process.exit(1);
  });
}

try {
  run('npx', ['prisma', 'migrate', 'deploy'], backend);
  run('npm', ['run', 'db:seed'], backend);
} finally {
  if (pg) {
    pg.kill('SIGINT');
    await new Promise((r) => setTimeout(r, 1500));
  }
}

console.log(`
Setup complete.

Start everything with:   npm run dev
Then open:               http://localhost:5173
API docs:                http://localhost:4000/api/docs
Demo password (dev only): DemoPass2026!   e.g. citizen@displaceos.dev, coordinator@displaceos.dev
`);
