// scripts/run-tests.mjs
// ══════════════════════════════════════════════════════════════
//  Cross-platform test runner (Windows cmd / Linux sh / macOS).
//
//  Why: the previous npm script relied on shell glob expansion of
//    src/lib/**/__tests__/*.test.ts
//  which, without bash globstar, expands to a SINGLE level and
//  silently excluded src/lib/__tests__/*.test.ts (22 files, incl.
//  the security-alignment and scoped-write regression suites).
//  cmd.exe on Windows expands nothing at all. This runner walks
//  the tree itself and passes every test file to tsx --test.
//
//  Usage:  node scripts/run-tests.mjs [extra tsx --test args...]
// ══════════════════════════════════════════════════════════════

import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');

const collected = [];

function walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
    } else if (
      entry.isFile() &&
      // .test.ts runs as CJS (no "type": "module"); .test.mts runs as ESM
      // and is the convention for tests needing node:test mock.module().
      (entry.name.endsWith('.test.ts') || entry.name.endsWith('.test.mts')) &&
      relative(ROOT, full).split(sep).includes('__tests__')
    ) {
      collected.push(full);
    }
  }
}

walk(SRC);

if (process.argv.includes('--list')) {
  for (const f of collected) console.log(relative(ROOT, f));
  console.error(`\n${collected.length} test file(s)`);
  process.exit(0);
}

if (collected.length === 0) {
  console.error('No test files found under src/**/__tests__/*.test.ts');
  process.exit(1);
}

console.error(`Running ${collected.length} test file(s) via tsx --test ...\n`);

const extraArgs = process.argv.slice(2);
const tsFiles = collected.filter((f) => f.endsWith('.test.ts'));
const mtsFiles = collected.filter((f) => f.endsWith('.test.mts'));
let status = 0;

// Test-only tsconfig: maps the 'server-only' boundary package to a
// no-op stub. The REAL package throws under Node's default export
// condition, which would fail every suite importing db/auth — its
// tripwire semantics only apply inside the Next client bundle, and
// the production build keeps resolving the real package.
const TSCONFIG = '--tsconfig', TSCONFIG_FILE = 'tsconfig.test.json';

// CJS test files — the default tsx path.
if (tsFiles.length > 0) {
  const result = spawnSync(
    process.execPath,
    ['node_modules/tsx/dist/cli.mjs', TSCONFIG, TSCONFIG_FILE, '--test', ...tsFiles, ...extraArgs],
    { stdio: 'inherit', env: process.env }
  );
  status = result.status ?? 1;
}

// ESM test files (.test.mts) — module mocking (node:test mock.module)
// only exists in ESM mode and requires the experimental flag.
if (mtsFiles.length > 0) {
  const result = spawnSync(
    process.execPath,
    [
      '--experimental-test-module-mocks',
      '--import', 'tsx',
      '--test', ...mtsFiles,
      ...extraArgs,
      TSCONFIG, TSCONFIG_FILE,
    ],
    { stdio: 'inherit', env: process.env }
  );
  if ((result.status ?? 1) !== 0) status = result.status ?? 1;
}

process.exit(status);
