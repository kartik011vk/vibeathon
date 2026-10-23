// Development helper: runs a real PostgreSQL server from the `embedded-postgres` npm package
// for machines without a system PostgreSQL install. Not for production use.
//
//   npm run db:local          # keeps running until Ctrl+C
//
// Creates the databases `displaceos` and `displaceos_test` on first run.
import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, '.local-postgres');
const port = Number(process.env.LOCAL_PG_PORT ?? 5433);
const user = process.env.LOCAL_PG_USER ?? 'displaceos';
const password = process.env.LOCAL_PG_PASSWORD ?? 'displaceos_dev_only';

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user,
  password,
  port,
  persistent: true,
  // Windows otherwise defaults to WIN1252, which cannot store characters such as "→" or Devanagari text.
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
  onLog: () => {},
});

const firstRun = !existsSync(path.join(dataDir, 'PG_VERSION'));
if (firstRun) {
  console.log('Initialising local PostgreSQL data directory…');
  await pg.initialise();
}
await pg.start();

const client = pg.getPgClient();
await client.connect();
for (const db of ['displaceos', 'displaceos_test']) {
  const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [db]);
  if (rowCount === 0) {
    await pg.createDatabase(db);
    console.log(`Created database "${db}"`);
  }
}
await client.end();

console.log(`Local PostgreSQL running on port ${port} (development only).`);
console.log(`DATABASE_URL=postgresql://${user}:${password}@localhost:${port}/displaceos?schema=public`);
console.log('Press Ctrl+C to stop.');

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  console.log('\nStopping local PostgreSQL…');
  await pg.stop();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
// Keep the process alive.
setInterval(() => {}, 1 << 30);
