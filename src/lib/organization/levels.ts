// ══════════════════════════════════════════════════════════════
//  §ORG-LEVELS — Organization node LEVEL normalization layer
//
//  The authorization engine (and the tree UI) reason about the
//  SEMANTIC level of an organization node:
//
//    general_administration → company → department → team → subteam
//
//  The stored `type` alone is NOT the level: legacy trees store the
//  General Administration root as type 'company' (production does —
//  الادارة العامة is a company-typed node whose subtree contains the
//  real company nodes). Renaming production data is forbidden
//  (§no-silent-mutation), so the level is DERIVED here:
//
//    • subteam / team / department → their own level.
//    • 'general_administration' (explicit stored type) → itself.
//    • company → 'general_administration' when its subtree contains
//      another company-typed node, otherwise 'company'.
//    • unknown/custom stored types → null (callers fail closed).
//
//  The Organization Tree remains the ONLY hierarchy; nothing here
//  reads or writes Firebase and no second org model is introduced.
// ══════════════════════════════════════════════════════════════

import type { OrgIndex } from './graph';
import type { OrgNodeLevel } from './level-types';
import type { OrgTreeNode } from './types';

export type { OrgNodeLevel } from './level-types';

export const ORG_NODE_LEVEL_LABELS_AR: Record<OrgNodeLevel, string> = {
  general_administration: 'الإدارة العامة',
  company: 'شركة',
  department: 'قسم',
  team: 'فريق',
  subteam: 'فريق فرعي',
};

export const ORG_NODE_LEVEL_LABELS_EN: Record<OrgNodeLevel, string> = {
  general_administration: 'General Administration',
  company: 'Company',
  department: 'Department',
  team: 'Team',
  subteam: 'Sub-team',
};

/** True when the node's subtree contains another company-typed node. */
function hasCompanyDescendant(index: OrgIndex, nodeId: string): boolean {
  const stack = [...(index.childrenOf.get(nodeId) ?? [])];
  while (stack.length > 0) {
    const current = stack.pop()!;
    const node = index.byId.get(current);
    if (!node) continue;
    if (node.type === 'company' || node.type === 'general_administration') return true;
    stack.push(...(index.childrenOf.get(current) ?? []));
  }
  return false;
}

/**
 * Semantic LEVEL of one node, or null when the node is missing or of
 * an unknown stored type (fail-closed consumers decide themselves).
 */
export function resolveOrgNodeLevel(index: OrgIndex, nodeId: string): OrgNodeLevel | null {
  const node = index.byId.get(nodeId);
  if (!node) return null;
  switch (node.type) {
    case 'subteam':
      return 'subteam';
    case 'team':
      return 'team';
    case 'department':
      return 'department';
    case 'general_administration':
      return 'general_administration';
    case 'company':
      return hasCompanyDescendant(index, nodeId) ? 'general_administration' : 'company';
    default:
      return null;
  }
}

/**
 * Level of a nested read-model node (OrgTreeNode) — the UI variant
 * that recurses over `children` instead of an OrgIndex. Same rules.
 */
export function resolveOrgTreeNodeLevel(node: OrgTreeNode): OrgNodeLevel | null {
  switch (node.type) {
    case 'subteam':
      return 'subteam';
    case 'team':
      return 'team';
    case 'department':
      return 'department';
    case 'general_administration':
      return 'general_administration';
    case 'company':
      return node.children.some(
        (c) => c.type === 'company' || c.type === 'general_administration' || resolveOrgTreeNodeLevel(c) === 'general_administration',
      )
        ? 'general_administration'
        : 'company';
    default:
      return null;
  }
}
