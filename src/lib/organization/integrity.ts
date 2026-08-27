// ══════════════════════════════════════════════════════════════
//  Organization link-integrity classifiers — M0.6-A (PURE functions)
//
//  Read-mostly analysis of the organizational relationship web:
//    Employee.orgNodeId ──► orgNodes            (membership)
//    users.linkedEmployeeId ──► employees       (account identity)
//    OrgNode.parentId ──► OrgNode               (structure)
//    historical tables .employeeId ──► employees (history integrity)
//
//  Every finding is CLASSIFIED, never repaired:
//    VALID             — resolvable and active where required
//    MISSING           — referenced id does not exist
//    INACTIVE_REFERENCE— target exists but is archived
//    ORPHAN            — optional relationship is not established
//    AMBIGUOUS         — several contradicting candidates exist;
//                        resolution requires a human decision
//
//  These functions carry NO database access (same doctrine as the
//  graph engine): the dry-run script feeds them live records and the
//  unit tests feed them fixtures. NOTHING here writes to Firebase —
//  normalization proposals stay proposals until explicitly approved.
// ══════════════════════════════════════════════════════════════

import type { OrgNode } from './types';
import type { OrgIndex } from './graph';

/** The classification vocabulary mandated by the M0.6-A phase spec. */
export type IntegrityStatus =
  | 'VALID'
  | 'MISSING'
  | 'INACTIVE_REFERENCE'
  | 'ORPHAN'
  | 'AMBIGUOUS';

export interface IntegrityFinding {
  /** Subject record id (the holder of the relationship). */
  subjectId: string;
  /** Target id the subject references (null when none was attempted). */
  targetId: string | null;
  status: IntegrityStatus;
  /** Human-readable note for the dry-run report. */
  note?: string;
}

/** Minimal employee slice every classifier needs. */
export interface IntegritableEmployee {
  id: string;
  name?: string | null;
  orgNodeId?: string | null;
  department?: string | null;
}

/**
 * Employee → org-node membership classification. Legacy employees
 * without an assignment surface as ORPHAN (their scope participation
 * is fail-closed-empty today); dangling/archived pointers classify
 * respectively as MISSING / INACTIVE_REFERENCE.
 */
export function classifyEmployeeNodeReferences(
  employees: IntegritableEmployee[],
  nodesById: Map<string, Pick<OrgNode, 'id' | 'status'>>,
): IntegrityFinding[] {
  return employees.map((emp) => {
    if (!emp.orgNodeId) {
      return { subjectId: emp.id, targetId: null, status: 'ORPHAN' as const };
    }
    const node = nodesById.get(emp.orgNodeId);
    if (!node) {
      return {
        subjectId: emp.id,
        targetId: emp.orgNodeId,
        status: 'MISSING' as const,
        note: 'orgNodeId يشير إلى عقدة غير موجودة',
      };
    }
    if (node.status === 'archived') {
      return {
        subjectId: emp.id,
        targetId: emp.orgNodeId,
        status: 'INACTIVE_REFERENCE' as const,
        note: 'الموظف مُسند إلى عقدة مؤرشفة',
      };
    }
    return { subjectId: emp.id, targetId: emp.orgNodeId, status: 'VALID' as const };
  });
}

/**
 * User → employee link integrity: dangling links (employee deleted)
 * report MISSING. Duplicate holders of one employee id are reported
 * SEPARATELY via findDuplicateEmployeeLinks because the contradiction
 * spans two subjects and needs its own bucket.
 */
export function classifyUserEmployeeLinks(
  users: ReadonlyArray<{ id: string; name?: string | null; linkedEmployeeId?: string | null }>,
  employeesById: Set<string>,
): IntegrityFinding[] {
  const out: IntegrityFinding[] = [];
  for (const user of users) {
    if (!user.linkedEmployeeId) continue; // unlinked accounts are legitimate
    if (!employeesById.has(user.linkedEmployeeId)) {
      out.push({
        subjectId: user.id,
        targetId: user.linkedEmployeeId,
        status: 'MISSING',
        note: 'linkedEmployeeId يشير إلى موظف غير موجود',
      });
    }
  }
  return out;
}

/**
 * Enforced 1:1 convention violated ONLY by direct DB edits (the write
 * path already blocks it). Each duplicated employee id → the user ids
 * claiming it → AMBIGUOUS resolution owner.
 */
export function findDuplicateEmployeeLinks(
  users: ReadonlyArray<{ id: string; linkedEmployeeId?: string | null }>,
): Array<{ employeeId: string; holderUserIds: string[] }> {
  const claimants = new Map<string, string[]>();
  for (const user of users) {
    if (!user.linkedEmployeeId) continue;
    const bucket = claimants.get(user.linkedEmployeeId) ?? [];
    bucket.push(user.id);
    claimants.set(user.linkedEmployeeId, bucket);
  }
  return [...claimants.entries()]
    .filter(([, holders]) => holders.length > 1)
    .map(([employeeId, holderUserIds]) => ({ employeeId, holderUserIds }));
}

/**
 * Structure check: parents that do not exist (only reachable through
 * direct DB edits — the move route validates).
 */
export function findDanglingNodeParents(
  nodesById: Map<string, Pick<OrgNode, 'id' | 'parentId'>>,
): Array<{ nodeId: string; parentId: string }> {
  const out: Array<{ nodeId: string; parentId: string }> = [];
  for (const node of nodesById.values()) {
    if (node.parentId && !nodesById.has(node.parentId)) {
      out.push({ nodeId: node.id, parentId: node.parentId });
    }
  }
  return out;
}

/**
 * Cycle detection REUSES the canonical graph engine's own semantics:
 * buildOrgIndex quarantines cycle members by never assigning them a
 * depth. Any such id is reported as an AMBIGUOUS structural finding —
 * the engine keeps treating them as unreachable (fail-closed), and
 * this phase never repairs data silently.
 */
export function findCycleQuarantinedNodes(
  nodes: OrgNode[],
  index: OrgIndex,
): string[] {
  const quarantined = nodes.map((n) => n.id).filter((id) => !index.depthOf.has(id));
  // Unknown parents are also quarantined as roots — exclude them here
  // by re-testing reachability from the sanitized roots layer. An id
  // with depth IS fine; cycle members AND true-orphans both lack it.
  // Cycles specifically: their member set reaches ITSELF via children.
  const childToParent = new Map<string, string>();
  for (const [parent, kids] of index.childrenOf) {
    if (parent === null) continue;
    for (const kid of kids) childToParent.set(kid, parent);
  }
  return quarantined.filter((id) => {
    let current: string | undefined = id;
    const seen = new Set<string>([id]);
    while ((current = childToParent.get(current ?? ''))) {
      if (seen.has(current)) return true; // walked back to itself → cycle
      seen.add(current);
    }
    return false;
  });
}

export interface LegacyNameMappingReport {
  /** Exact-unique name matches → safe proposed mapping (still requires approval). */
  proposed: Array<{ departmentName: string; nodeId: string; employeeCount: number }>;
  /** Names matching more than one node — DO NOT auto-resolve. */
  ambiguous: Array<{ departmentName: string; candidateNodeIds: string[]; employeeCount: number }>;
  /** Non-empty names with zero nodes — require manual mapping. */
  unresolved: Array<{ departmentName: string; employeeCount: number }>;
  /** Employees whose free-text department is empty/null (nothing to map). */
  blankCount: number;
}

/**
 * DRY-RUN analysis ONLY: how would employee.department free-text map
 * onto typed department nodes by EXACT name equality? Multi-match
 * cases are marked AMBIGUOUS and are NEVER auto-chosen (phase rule
 * §23-24). No field on any record is rewritten by running this.
 */
export function buildLegacyDepartmentNameMapping(
  employees: IntegritableEmployee[],
  departmentNodes: ReadonlyArray<Pick<OrgNode, 'id' | 'name'>>,
): LegacyNameMappingReport {
  const byName = new Map<string, string[]>();
  for (const node of departmentNodes) {
    if (!node.name?.trim()) continue;
    const bucket = byName.get(node.name.trim()) ?? [];
    bucket.push(node.id);
    byName.set(node.name.trim(), bucket);
  }

  const employeeCounts = new Map<string, number>();
  let blankCount = 0;
  for (const emp of employees) {
    const name = typeof emp.department === 'string' ? emp.department.trim() : '';
    if (!name) {
      blankCount++;
      continue;
    }
    employeeCounts.set(name, (employeeCounts.get(name) ?? 0) + 1);
  }

  const proposed: LegacyNameMappingReport['proposed'] = [];
  const ambiguous: LegacyNameMappingReport['ambiguous'] = [];
  const unresolved: LegacyNameMappingReport['unresolved'] = [];
  for (const [name, employeeCount] of employeeCounts) {
    const candidates = byName.get(name) ?? [];
    if (candidates.length === 1) {
      proposed.push({ departmentName: name, nodeId: candidates[0], employeeCount });
    } else if (candidates.length > 1) {
      ambiguous.push({ departmentName: name, candidateNodeIds: candidates, employeeCount });
    } else {
      unresolved.push({ departmentName: name, employeeCount });
    }
  }
  return { proposed, ambiguous, unresolved, blankCount };
}

export interface HistoricalReferenceReport {
  /** Per-table list of referenced-but-nonexistent employee ids (deduplicated). */
  missingByTable: Array<{ table: string; employeeIds: string[] }>;
  totalMissingDistinct: number;
}

/**
 * Historical-record integrity: rows whose employeeId points at no
 * employee record. Reporting does NOT delete them and does NOT invent
 * replacement identities — they stay queryable exactly as stored.
 */
export function classifyHistoricalEmployeeReferences(
  recordsByTable: Record<string, ReadonlyArray<{ employeeId?: string | null }>>,
  employeesById: Set<string>,
): HistoricalReferenceReport {
  const missingByTable: HistoricalReferenceReport['missingByTable'] = [];
  const allMissing = new Set<string>();
  for (const [table, rows] of Object.entries(recordsByTable)) {
    const missing = new Set<string>();
    for (const row of rows) {
      if (!row.employeeId || typeof row.employeeId !== 'string') continue;
      if (!employeesById.has(row.employeeId)) {
        missing.add(row.employeeId);
        allMissing.add(row.employeeId);
      }
    }
    if (missing.size > 0) {
      missingByTable.push({ table, employeeIds: [...missing] });
    }
  }
  return { missingByTable, totalMissingDistinct: allMissing.size };
}
