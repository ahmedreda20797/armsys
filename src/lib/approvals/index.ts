// ══════════════════════════════════════════════════════════════
//  Generic approval primitive — barrel export
//
//  Single public entry point for the approvals library. Consumers
//  import from '@/lib/approvals' and never reach into sub-modules.
//
//  Stable public API — see the JSDoc on each export for its contract.
// ══════════════════════════════════════════════════════════════

export type {
  ApprovalAction,
  ApprovalEvent,
  ApprovalStatus,
} from './types';

export {
  makeApprovalEvent,
  appendApprovalEvent,
  projectLatestApprovalStatus,
  isApprovedStatus,
  isPendingStatus,
  isRejectedStatus,
} from './approval-history';

export type { MakeApprovalEventInput } from './approval-history';
