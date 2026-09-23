// Duplicate-key checker for en-map.ts
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(join(__dirname, '..', 'src', 'lib', 'i18n', 'en-map.ts'), 'utf8');
const body = src.slice(src.indexOf('{'), src.lastIndexOf('}') + 1);
const re = /'((?:[^'\\]|\\.)*)'\s*:/g;
const seen = new Map<string, number>();
let m: RegExpExecArray | null;
let count = 0;
while ((m = re.exec(body))) {
  count++;
  seen.set(m[1], (seen.get(m[1]) ?? 0) + 1);
}
const dups = [...seen.entries()].filter(([, v]) => v > 1);
console.log('total keys:', count, '| duplicates:', dups.length);
for (const [k] of dups.slice(0, 40)) console.log('DUP:', k);
