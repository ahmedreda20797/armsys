// ══════════════════════════════════════════════════════════════
//  i18n-coverage-diagnose — WHY does English mode still receive
//  Arabic? Extract every Arabic-bearing string literal from the
//  client tree, diff against EN_MAP (exact keys), and rank the
//  uncovered strings by spread (files × occurrences).
// ══════════════════════════════════════════════════════════════
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', 'src');
const ARABIC = /[\u0600-\u06FF]/;

// ── Load EN_MAP keys (eval the object literal via regex extraction) ──
const enMapSrc = readFileSync(join(ROOT, 'lib', 'i18n', 'en-map.ts'), 'utf8');
const enMapKeys = new Set<string>();
const entryRe = /'((?:[^'\\]|\\.)*)'\s*:/g;
const bodyStart = enMapSrc.indexOf('{');
const bodyEnd = enMapSrc.lastIndexOf('}');
const body = enMapSrc.slice(bodyStart, bodyEnd + 1);
let m: RegExpExecArray | null;
while ((m = entryRe.exec(body))) {
  try {
    enMapKeys.add(JSON.parse(`"${m[1]}"`).trim());
  } catch { /* skip malformed */ }
}

// Also dictionary ar values (t() keys are already locale-aware — exclude
// them from "residual" since they render per-locale).
const dictSrc = readFileSync(join(ROOT, 'lib', 'i18n', 'dictionary.ts'), 'utf8');
const dictKeys = new Set<string>();
const dictEntryRe = /ar:\s*'((?:[^'\\]|\\.)*)'/g;
while ((m = dictEntryRe.exec(dictSrc))) {
  try { dictKeys.add(JSON.parse(`"${m[1]}"`).trim()); } catch { /* skip */ }
}

// ── Walk the client tree ──
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === '__tests__' || e.name === 'node_modules') continue;
      out.push(...walk(p));
    } else if (/\.(tsx?|ts)$/.test(e.name) && !/\.test\.|\.d\.ts$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

const files = [
  ...walk(join(ROOT, 'components')),
  ...walk(join(ROOT, 'lib')),
  ...walk(join(ROOT, 'contexts')),
  ...walk(join(ROOT, 'hooks')),
  ...walk(join(ROOT, 'config')),
].filter((f) => !f.includes(join('app', 'api')) && !f.includes('i18n'));

interface Hit { s: string; files: Set<string>; n: number; sample: string }
const hits = new Map<string, Hit>();

// String literal extractor — single, double, template (no ${}).
const litRe = /'([^'\\\n]{1,200})'|"([^"\\\n]{1,200})"|`([^`\\$\n]{1,200})`/g;

for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const rel = f.slice(ROOT.length + 1);
  // Strip comments to reduce noise (line + block) — crude but effective.
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, (c) => (ARABIC.test(c) ? ' ' : ' '))
    .replace(/^\s*\/\/.*$/gm, (c) => (ARABIC.test(c) ? ' ' : ' '));
  let mm: RegExpExecArray | null;
  while ((mm = litRe.exec(code))) {
    const raw = (mm[1] ?? mm[2] ?? mm[3] ?? '').trim();
    if (!raw || !ARABIC.test(raw)) continue;
    // Skip lines that are clearly type/annotation noise
    const key = raw;
    const h = hits.get(key) ?? { s: key, files: new Set<string>(), n: 0, sample: rel };
    h.files.add(rel);
    h.n++;
    hits.set(key, h);
  }
}

const uncovered = [...hits.values()].filter((h) => !enMapKeys.has(h.s));
const covered = [...hits.values()].filter((h) => enMapKeys.has(h.s));

function rank(h: Hit): number { return h.files.size * 100 + h.n; }
uncovered.sort((a, b) => rank(b) - rank(a));

console.log(`EN_MAP keys: ${enMapKeys.size}`);
console.log(`Distinct Arabic literals found: ${hits.size}`);
console.log(`Covered (exact in EN_MAP): ${covered.length}`);
console.log(`UNCOVERED: ${uncovered.length}`);
console.log('\n── Top uncovered (by spread) ──');
for (const h of uncovered.slice(0, 120)) {
  console.log(`[${h.files.size}f/${h.n}x] ${h.s}   ← ${h.sample}`);
}
console.log('\n── Uncovered singletons count:', uncovered.filter((h) => h.files.size === 1).length);

// How much of what REMAINS untranslated would be caught at runtime?
// A text node only needs the phrases it CONTAINS to be mapped.
const longTail = uncovered.filter((h) => h.files.size >= 2);
console.log(`\nUncovered strings appearing in ≥2 files: ${longTail.length}`);
