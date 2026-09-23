// Dump uncovered Arabic UI strings (client tree) with source references.
import { readFileSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', 'src');
const ARABIC = /[\u0600-\u06FF]/;
const enMapSrc = readFileSync(join(ROOT, 'lib', 'i18n', 'en-map.ts'), 'utf8');
const enMapKeys = new Set<string>();
const entryRe = /'((?:[^'\\]|\\.)*)'\s*:/g;
const body = enMapSrc.slice(enMapSrc.indexOf('{'), enMapSrc.lastIndexOf('}') + 1);
let m: RegExpExecArray | null;
while ((m = entryRe.exec(body))) {
  try { enMapKeys.add(JSON.parse(`"${m[1]}"`).trim()); } catch { /* skip */ }
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === '__tests__' || e.name === 'node_modules') continue;
      out.push(...walk(p));
    } else if (/\.tsx?$/.test(e.name) && !/\.test\.|\.d\.ts$/.test(e.name)) out.push(p);
  }
  return out;
}

const files = [
  ...walk(join(ROOT, 'components')),
  ...walk(join(ROOT, 'lib')),
  ...walk(join(ROOT, 'hooks')),
  ...walk(join(ROOT, 'contexts')),
  ...walk(join(ROOT, 'config')),
].filter((f) => !f.includes(join('app', 'api')) && !f.includes('i18n'));

const litRe = /'([^'\\\n]{1,300})'|"([^"\\\n]{1,300})"|`([^`\\$\n]{1,300})`/g;
const hits = new Map<string, { n: number; files: Set<string> }>();
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const rel = f.slice(ROOT.length + 1).replace(/\\/g, '/');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  let mm: RegExpExecArray | null;
  litRe.lastIndex = 0;
  while ((mm = litRe.exec(code))) {
    const raw = (mm[1] ?? mm[2] ?? mm[3] ?? '').trim();
    if (!raw || !ARABIC.test(raw) || raw.length < 2) continue;
    const h = hits.get(raw) ?? { n: 0, files: new Set<string>() };
    h.n++; h.files.add(rel); hits.set(raw, h);
  }
}
const uncovered = [...hits.entries()].filter(([s]) => !enMapKeys.has(s));
let out = '';
for (const [s, h] of uncovered.sort((a, b) => (b[1].files.size * 100 + b[1].n) - (a[1].files.size * 100 + a[1].n))) {
  out += s + '\t[' + [...h.files].slice(0, 3).join(', ') + ']\n';
}
writeFileSync(join(__dirname, '..', 'uncovered-strings.txt'), out, 'utf8');
console.log('uncovered:', uncovered.length);
