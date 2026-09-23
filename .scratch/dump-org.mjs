import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { createPrivateKey } from 'node:crypto';

// minimal .env parser (quoted values; keeps content otherwise raw)
const env = {};
for (const line of readFileSync('C:/Users/Target/Desktop/arm-erp-project/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/);
  if (m && env[m[1]] === undefined) env[m[1]] = m[2];
}

// normalize the private key: .env stores it with DOUBLED backslashes
let pem = (env.FIREBASE_PRIVATE_KEY || '').trim();
if (pem.startsWith('{')) {
  try { pem = JSON.parse(pem).private_key || pem; } catch {}
}
pem = pem.replace(/^["']|["']$/g, '');
const BS = String.fromCharCode(92); // backslash
pem = pem
  .split(BS + BS + 'n').join('\n')   // \\n -> newline
  .split(BS + 'n').join('\n')        // \n  -> newline
  .split(BS + 'r').join('\n');
if (!pem.endsWith('\n')) pem += '\n';

const key = createPrivateKey(pem);

const app = initializeApp({
  credential: cert({
    projectId: env.FIREBASE_PROJECT_ID,
    clientEmail: env.FIREBASE_CLIENT_EMAIL,
    privateKey: pem,
  }),
  databaseURL: env.FIREBASE_DATABASE_URL,
});
const db = getDatabase();

const snap = await db.ref('arm_erp/orgNodes').get();
const nodes = snap.exists() ? Object.entries(snap.val()).map(([id, v]) => ({ id, ...v })) : [];
console.log('NODE_COUNT=' + nodes.length);
const byParent = new Map();
for (const n of nodes) {
  const p = n.parentId || null;
  if (!byParent.has(p)) byParent.set(p, []);
  byParent.get(p).push(n);
}
const typeCount = {};
for (const n of nodes) typeCount[n.type] = (typeCount[n.type] || 0) + 1;
console.log('TYPES=' + JSON.stringify(typeCount));
function render(pid, depth) {
  const kids = (byParent.get(pid) || []).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  for (const k of kids) {
    const manager = k.managerUserId ? ' MGR:' + k.managerUserId.slice(0, 8) : '';
    console.log('  '.repeat(depth) + '- [' + k.type + '] ' + k.name + ' (' + k.id.slice(0, 10) + ') status=' + k.status + manager);
    render(k.id, depth + 1);
  }
}
render(null, 0);
const ids = new Set(nodes.map((n) => n.id));
const orphans = nodes.filter((n) => n.parentId && !ids.has(n.parentId));
console.log('ORPHANS=' + JSON.stringify(orphans.map((o) => ({ id: o.id.slice(0, 10), name: o.name, parent: o.parentId }))));

const empSnap = await db.ref('arm_erp/employees').get();
const emps = empSnap.exists() ? Object.entries(empSnap.val()).map(([id, v]) => ({ id, orgNodeId: v.orgNodeId, name: v.name })) : [];
console.log('EMP_COUNT=' + emps.length);
const perNode = {};
for (const e of emps) {
  const k = e.orgNodeId || 'NULL';
  perNode[k] = (perNode[k] || 0) + 1;
}
console.log('EMP_PER_NODE=' + JSON.stringify(perNode));
console.log('EMP_WITHOUT_NODE=' + emps.filter((e) => !e.orgNodeId).length);

const uSnap = await db.ref('arm_erp/users').get();
const users = uSnap.exists() ? Object.entries(uSnap.val()).map(([id, v]) => ({
  id: id.slice(0, 8),
  role: v.role,
  hasPosition: !!v.positionId,
  hasLink: !!v.linkedEmployeeId,
  suspended: !!v.isSuspended,
})) : [];
console.log('USER_COUNT=' + users.length);
const roleCount = {};
for (const u of users) roleCount[u.role] = (roleCount[u.role] || 0) + 1;
console.log('USER_ROLES=' + JSON.stringify(roleCount));
console.log('USERS_WITH_LINK=' + users.filter((u) => u.hasLink).length + ' USERS_WITH_POSITION=' + users.filter((u) => u.hasPosition).length);
const mgrIds = new Set(nodes.filter((n) => n.managerUserId).map((n) => n.managerUserId));
console.log('MANAGER_USER_IDS=' + mgrIds.size);
process.exit(0);
