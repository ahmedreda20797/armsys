// ══════════════════════════════════════════════════════════════
//  §EVIDENCE-ITEMS — module registry
//
//  Single shared mapping for every record type that carries
//  normalized evidenceItems:
//    • canonical RTDB table (records live inline — no shadow tables)
//    • the sidebar permissionKey that guards the SOURCE records
//      (§13: evidence authorization == parent-record authorization,
//      reusing the canonical verifyPermission + employee-scope
//      gates — never a second permission system)
//    • the module's legacy evidence shape (read adapter / write
//      projection — see evidence-items.ts)
//
//  Client-safe: pure data, no server imports.
// ══════════════════════════════════════════════════════════════

import type { LegacyEvidenceKind } from '@/lib/evidence-items';

export type EvidenceModuleKey =
  | 'qualityObservations'
  | 'qualityDeductions'
  | 'hrDeductions'
  | 'followUps'
  | 'capaCases'
  | 'complaints';

export interface EvidenceModuleDescriptor {
  /** Canonical RTDB table (identical name — no shadow collections). */
  table: string;
  /** Sidebar permissionKey guarding the source records. */
  permissionKey: string;
  /** Legacy evidence shape carried on the records. */
  legacy: LegacyEvidenceKind;
}

export const EVIDENCE_MODULES: Record<EvidenceModuleKey, EvidenceModuleDescriptor> = {
  qualityObservations: { table: 'qualityObservations', permissionKey: 'observations', legacy: 'required-string' },
  qualityDeductions: { table: 'qualityDeductions', permissionKey: 'quality', legacy: 'nullable-string' },
  hrDeductions: { table: 'hrDeductions', permissionKey: 'hrDeductions', legacy: 'none' },
  followUps: { table: 'followUps', permissionKey: 'followUps', legacy: 'followup' },
  capaCases: { table: 'capaCases', permissionKey: 'capa', legacy: 'none' },
  complaints: { table: 'complaints', permissionKey: 'complaints', legacy: 'none' },
};

export function isEvidenceModuleKey(value: unknown): value is EvidenceModuleKey {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(EVIDENCE_MODULES, value);
}

/** Reverse lookup: canonical table → module key (image serve route). */
export function evidenceModuleOfTable(table: string): EvidenceModuleKey | null {
  for (const [key, descriptor] of Object.entries(EVIDENCE_MODULES)) {
    if (descriptor.table === table) return key as EvidenceModuleKey;
  }
  return null;
}
