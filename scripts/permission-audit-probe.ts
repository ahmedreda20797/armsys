// ══════════════════════════════════════════════════════════════
//  Permission Visibility Audit — READ-ONLY diagnostic
//
//  Checks whether any real user's STORED permissions map grants
//  restricted Quality-KPI pages against their ROLE preset.
//  Extracts ONLY: role + permission levels for KPI page keys.
//  No emails / names / credentials are printed.
// ══════════════════════════════════════════════════════════════

import { getAll } from '../src/lib/db';
import {
  getPermissionsForRole,
  APP_PAGES,
} from '../src/config/permissions';

const KPI_PAGE_IDS = [
  'observations',
  'observationCategories',
  'observationTemplates',
  'kpiDashboard',
  'qualityAuditLog',
  'monthClose',
  'kpiSettings',
];

type Raw = string | { level?: string } | undefined;

function levelOf(raw: Raw): string {
  if (!raw) return 'MISSING';
  if (typeof raw === 'string') return raw;
  return raw.level || 'MISSING';
}

async function main() {
  const users = await getAll<Record<string, unknown>>('users');
  console.log(`users total: ${users.length}\n`);

  // Header
  console.log(
    'role'.padEnd(10),
    'page'.padEnd(24),
    'stored'.padEnd(8),
    'preset'.padEnd(8),
    'merged(client)',
  );

  let leakCount = 0;
  let missingCount = 0;

  for (const u of users) {
    const role = String(u.role || 'user');
    const preset = getPermissionsForRole(role);
    let stored: Record<string, unknown> = {};
    if (typeof u.permissions === 'string') {
      try { stored = JSON.parse(u.permissions); } catch { stored = {}; }
    } else if (u.permissions && typeof u.permissions === 'object') {
      stored = u.permissions as Record<string, unknown>;
    }

    for (const pid of KPI_PAGE_IDS) {
      const storedLevel = levelOf(stored[pid] as Raw);
      const presetLevel = levelOf(preset[pid] as Raw);
      // Client merge (AuthContext.buildAuthUser): stored overrides preset when present
      const mergedLevel = storedLevel === 'MISSING' ? presetLevel : storedLevel;

      // Leak = merged grants a page the role preset restricts to none,
      // OR admin-clone leak: non-admin role with edit on restricted admin pages
      const presetRestricted = presetLevel === 'none' || presetLevel === 'MISSING';
      const mergedGrants = mergedLevel === 'read' || mergedLevel === 'edit';

      if (presetRestricted && mergedGrants) {
        leakCount++;
        console.log(
          role.padEnd(10),
          pid.padEnd(24),
          storedLevel.padEnd(8),
          presetLevel.padEnd(8),
          mergedLevel,
          '  ← LEAK (visible in UI, violates role preset)',
        );
      } else if (storedLevel === 'MISSING') {
        missingCount++;
        console.log(
          role.padEnd(10),
          pid.padEnd(24),
          storedLevel.padEnd(8),
          presetLevel.padEnd(8),
          mergedLevel,
          '  (falls back to preset — server treats as none)',
        );
      }
    }
  }

  console.log(`\nsummary: ${leakCount} preset-violating grants, ${missingCount} missing-stored keys (fallback to preset)`);
  console.log(`pages in APP_PAGES: ${APP_PAGES.length}`);
}

main().catch((e) => {
  console.error('Probe crashed:', e);
  process.exitCode = 1;
});
