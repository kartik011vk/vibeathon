// Runs the automated test suite against a SEPARATE test database (TEST_DATABASE_URL).
// Pending migrations are applied to the test database; each test file then empties its tables (tests/helpers.js).
import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testUrl = process.env.TEST_DATABASE_URL;

if (!testUrl) {
  console.error('TEST_DATABASE_URL is not set. Add it to .env (see .env.example). Tests never run against DATABASE_URL.');
  process.exit(1);
}
if (testUrl === process.env.DATABASE_URL) {
  console.error('TEST_DATABASE_URL must point to a different database than DATABASE_URL.');
  process.exit(1);
}

const env = {
  ...process.env,
  NODE_ENV: 'test',
  DATABASE_URL: testUrl,
  ESCALATION_JOB_ENABLED: 'false',
  EMAIL_PROVIDER: '',
  SMS_PROVIDER: '',
  ROUTING_PROVIDER: '',
};

// Invoke the CLIs' JS entry points with this Node binary (no shell, works the same on Windows/macOS/Linux).
function run(cliPath, args) {
  const result = spawnSync(process.execPath, [path.join(root, cliPath), ...args], { cwd: root, env, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log('Applying migrations to the test database…');
run('node_modules/prisma/build/index.js', ['migrate', 'deploy']);
run('node_modules/vitest/vitest.mjs', ['run', ...process.argv.slice(2)]);
