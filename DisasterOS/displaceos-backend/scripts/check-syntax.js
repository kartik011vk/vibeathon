// Lightweight lint step: parses every project .js file with `node --check`.
import { readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dirs = ['src', 'prisma', 'scripts', 'tests'];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith('.js')) out.push(full);
  }
  return out;
}

const files = dirs.flatMap((d) => walk(path.join(root, d)));
let failed = 0;
for (const file of files) {
  const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (r.status !== 0) {
    failed += 1;
    console.error(`✗ ${path.relative(root, file)}\n${r.stderr}`);
  }
}
console.log(`Checked ${files.length} files, ${failed} with syntax errors.`);
process.exit(failed ? 1 : 0);
