// ══════════════════════════════════════════════════════════════
//  Organization model — Milestone 10 (+ §ORG-BOUNDARY canonical levels)
//
//  A configurable parent/child hierarchy of organization nodes:
//
//    General Administration → Company → Department → Team →
//    Sub-Team → Employee
//
//  The DEPTH is generic — any node may nest to MAX_ORG_DEPTH. The
//  canonical types below are vocabulary, not structure: the graph
//  engine is type-agnostic and unknown future types degrade
//  gracefully (they resolve like their nearest typed ancestor).
//
//  §ORG-LEVELS — the semantic LEVEL of a node (what the authorization
//  engine reasons about) is resolved by the normalization layer in
//  ./levels — NEVER assumed from the stored type alone: legacy trees
//  store the General Administration root as type 'company' (it is the
//  company-typed node whose subtree contains other company nodes).
//  Stored data is never renamed; the level is DERIVED.
//
//  IMPORTANT — USER vs EMPLOYEE:
//    • Employees are DATA records (personnel), NOT system users.
//    • managerUserId references a USER (application operator) who
//      manages the node. It is the ONLY user reference on the org
//      side; employees are linked to nodes via Employee.orgNodeId.
//    • No user accounts are ever created for employees here.
// ══════════════════════════════════════════════════════════════

/** RTDB table for organization nodes (arm_erp/orgNodes/{id}). */
export const ORG_NODES_TABLE = 'orgNodes';

/** RTDB table for positions (arm_erp/positions/{id}). */
export const POSITIONS_TABLE = 'positions';

export type OrgNodeType = 'general_administration' | 'company' | 'department' | 'team' | 'subteam';
export type OrgNodeStatus = 'active' | 'archived';

// §I18N-ENUM — display labels are locale-aware; the stored type/status
// values never change (company stays company; a status stays its enum).
// 'general_administration' is the explicit stored vocabulary for NEW
// trees; legacy trees keep their company-typed GA root and the level
// normalization layer resolves its semantic level without a rename.
export const ORG_NODE_TYPE_LABELS_AR: Record<OrgNodeType, string> = {
  general_administration: 'الإدارة العامة',
  company: 'شركة',
  department: 'قسم',
  team: 'فريق',
  subteam: 'فريق فرعي',
};

export const ORG_NODE_TYPE_LABELS_EN: Record<OrgNodeType, string> = {
  general_administration: 'General Administration',
  company: 'Company',
  department: 'Department',
  team: 'Team',
  subteam: 'Sub-team',
};

export const ORG_NODE_STATUS_LABELS_AR: Record<OrgNodeStatus, string> = {
  active: 'نشط',
  archived: 'مؤرشف',
};

export const ORG_NODE_STATUS_LABELS_EN: Record<OrgNodeStatus, string> = {
  active: 'Active',
  archived: 'Archived',
};

export type OrgLabelLocale = 'ar' | 'en';

export function orgNodeTypeLabel(type: OrgNodeType, locale: OrgLabelLocale = 'ar'): string {
  return locale === 'en' ? ORG_NODE_TYPE_LABELS_EN[type] : ORG_NODE_TYPE_LABELS_AR[type];
}

export function orgNodeStatusLabel(status: OrgNodeStatus, locale: OrgLabelLocale = 'ar'): string {
  return locale === 'en' ? ORG_NODE_STATUS_LABELS_EN[status] : ORG_NODE_STATUS_LABELS_AR[status];
}

export interface OrgNode {
  id: string;
  name: string;
  type: OrgNodeType;
  /** Parent node id. null = root (e.g. the company node). */
  parentId: string | null;
  /** USER id of the node's manager (application operator), if any. */
  managerUserId: string | null;
  /** Display snapshot of the manager (denormalized for lists). */
  managerUserName?: string | null;
  status: OrgNodeStatus;
  /** Manual ordering among siblings (stable UI + tree building). */
  order: number;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Node enriched with children + membership counts (read models). */
export interface OrgTreeNode extends OrgNode {
  children: OrgTreeNode[];
  /** Employees assigned DIRECTLY to this node. */
  employeeCount: number;
  /** Employees in this node's entire subtree. */
  subtreeEmployeeCount: number;
}

/** Employee slice the org engine needs (keeps the module decoupled). */
export interface OrgEmployeeRef {
  id: string;
  name?: string | null;
  orgNodeId?: string | null;
}

/**
 * Impact preview BEFORE a reorganization (distinctive ARM feature:
 * never mutate structure blindly). Pure computation over the graph.
 */
export interface OrgImpactPreview {
  nodeId: string;
  nodeName: string;
  /** Nodes inside the subtree, including the node itself. */
  subtreeNodeCount: number;
  /** Employees inside the subtree (they inherit a different scope). */
  employeeCount: number;
  /** Managers assigned within the subtree (their managed scope moves). */
  managerUserIds: string[];
}
