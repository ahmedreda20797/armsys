// scripts/migrate-quality-deduction-approval.ts
// §WORKFLOW one-time migration for EXISTING quality discount records.
// Run with: npx tsx scripts/migrate-quality-deduction-approval.ts
//
// What it does (idempotent — safe to re-run):
//   1. approvalStatus: legacy records (no approvalStatus) were all
//      live/effective at creation → stamped 'approved' with an
//      approvalHistory submit+approve pair attributed to the SYSTEM
//      actor (historical fact: they took effect without a workflow).
//   2. createdByUserId: backfilled from the legacy createdById field.
//
// NOTE: correctness does NOT depend on this script — the runtime gate
// (isEffectiveDeduction in src/lib/quality-deductions/domain.ts)
// treats a missing approvalStatus as 'approved'. The backfill simply
// makes the stored data match the projected semantics.
// Records already carrying approvalStatus are left untouched.

import { getAdminDb } from '../src/lib/firebase-server';

interface LegacyDeduction {
  id?: string;
  createdById?: string | null;
  createdByUserId?: string | null;
  approvalStatus?: string;
  approvalHistory?: unknown[];
  [k: string]: unknown;
}

const SYSTEM_ACTOR_ID = 'system';
const SYSTEM_ACTOR_NAME = 'النظام (ترحيل سجلات تاريخية)';

async function migrate() {
  console.log('═══════════════════════════════════════════');
  console.log('  Quality Discounts — approval backfill');
  console.log('═══════════════════════════════════════════\n');

  const db = getAdminDb();
  const ref = db.ref('arm_erp/qualityDeductions');
  const snapshot = await ref.get();

  if (!snapshot.exists()) {
    console.log('No qualityDeductions records found — nothing to do.');
    return;
  }

  const raw = snapshot.val() as Record<string, LegacyDeduction>;
  const entries = Object.entries(raw);

  let statusFixed = 0;
  let userKeyFixed = 0;
  let skipped = 0;

  const now = new Date().toISOString();

  for (const [id, rec] of entries) {
    const updates: Record<string, unknown> = {};

    if (!rec.approvalStatus) {
      updates.approvalStatus = 'approved';
      updates.approvalHistory = [
        {
          action: 'submit',
          actorId: rec.createdById ?? rec.createdByUserId ?? SYSTEM_ACTOR_ID,
          actorName: 'سجل تاريخي',
          notes: 'ترحيل: سجل أُنشئ قبل نظام الاعتماد',
          timestamp: now,
        },
        {
          action: 'approve',
          actorId: SYSTEM_ACTOR_ID,
          actorName: SYSTEM_ACTOR_NAME,
          notes: 'ترحيل: كان ساري المفعول قبل نظام الاعتماد',
          timestamp: now,
        },
      ];
      statusFixed += 1;
    }

    if (!rec.createdByUserId && rec.createdById) {
      updates.createdByUserId = rec.createdById;
      userKeyFixed += 1;
    }

    if (Object.keys(updates).length === 0) {
      skipped += 1;
      continue;
    }
    updates.updatedAt = now;
    await db.ref(`arm_erp/qualityDeductions/${id}`).update(updates);
  }

  console.log(`Total records:   ${entries.length}`);
  console.log(`Status backfill: ${statusFixed}`);
  console.log(`UserKey backfill:${userKeyFixed}`);
  console.log(`Already migrated:${skipped}`);
  console.log('\n✅ Migration complete.');
}

migrate()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  });
