// ══════════════════════════════════════════════════════════════
//  Generic audit primitive — barrel export
//
//  Single public entry point for the audit library. Consumers import
//  from '@/lib/audit' and never reach into sub-modules.
//
//  Stable public API — see the JSDoc on each export for its contract.
// ══════════════════════════════════════════════════════════════

export type {
  AuditEvent,
  TimelinePoint,
  TimelineTone,
  TimelineApprovalEvent,
  AuditEntityType,
} from './types';

export {
  writeAudit,
  makeAuditEvent,
} from './server-audit-logger';

export type { WriteAuditInput, MakeAuditEventInput } from './server-audit-logger';

export { buildTimeline } from './timeline-builder';
