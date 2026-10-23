// Starts the whole app for local development in one terminal:
//   1. embedded PostgreSQL (unless --own-db), 2. the API on :4000, 3. the website on :5173.
// Ctrl+C stops everything.
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ownDb = process.argv.includes('--own-db');
const children = [];

function start(name, cwd, cmd, args, { readyText, color }) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: path.join(root, cwd), shell: true, env: process.env });
    children.push(child);
    const tag = `\x1b[${color}m[${name}]\x1b[0m `;
    let ready = !readyText;
    if (ready) resolve();
    const onData = (buf) => {
      for (const line of String(buf).split(/\r?\n/)) {
        if (!line.trim()) continue;
        process.stdout.write(tag + line + '\n');
        if (!ready && line.includes(readyText)) {
          ready = true;
          resolve();
        }
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => {
      process.stdout.write(`${tag}exited with code ${code}\n`);
      if (!ready) {
        console.error(`\n${name} failed to start. Did you run "npm run setup" first?`);
        shutdown(1);
      }
    });
  });
}

let stopping = false;
function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const c of children.reverse()) c.kill('SIGINT');
  // Ctrl+C in a terminal already reaches every child, letting PostgreSQL stop cleanly. Anything still
  // alive after a grace period is stopped with its whole process tree (on Windows a shell-spawned child
  // does not pass signals on to its own children).
  setTimeout(() => {
    for (const c of children) {
      if (c.exitCode !== null) continue;
      if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(c.pid), '/T', '/F'], { stdio: 'ignore' });
      else c.kill('SIGKILL');
    }
    process.exit(code);
  }, 4000);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

if (!ownDb) await start('db', 'displaceos-backend', 'npm', ['run', 'db:local'], { readyText: 'running on port', color: 33 });
await start('api', 'displaceos-backend', 'npm', ['run', 'dev'], { readyText: 'listening', color: 35 });
await start('web', 'displaceos-frontend', 'npm', ['run', 'dev'], { readyText: 'Local', color: 36 });
console.log('\n  DisplaceOS is running →  http://localhost:5173   (API docs: http://localhost:4000/api/docs)\n  Press Ctrl+C to stop.\n');
