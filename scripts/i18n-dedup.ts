// De-duplicate en-map.ts entries — keep the FIRST occurrence of each key
// (the original curated entries), drop later duplicate lines.
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const path = join(__dirname, '..', 'src', 'lib', 'i18n', 'en-map.ts');
const lines = readFileSync(path, 'utf8').split('\n');
const entryRe = /^(\s*)'((?:[^'\\]|\\.)*)'\s*:/;
const seen = new Set<string>();
const out: string[] = [];
let removed = 0;
for (const line of lines) {
  const m = entryRe.exec(line);
  if (m) {
    const key = m[2];
    if (seen.has(key)) { removed++; continue; }
    seen.add(key);
  }
  out.push(line);
}
writeFileSync(path, out.join('\n'), 'utf8');
console.log('kept:', seen.size, '| removed duplicate lines:', removed);
