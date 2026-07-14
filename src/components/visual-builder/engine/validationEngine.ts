/**
 * Universal Visual Builder — Validation Engine
 * Stateless pure functions. No side effects.
 */

import type { VBNode, VBEdge, VBValidationResult, VBValidationError, VBValidationWarning } from './types';

export function validateGraph(nodes: VBNode[], edges: VBEdge[]): VBValidationResult {
  const errors: VBValidationError[] = [];
  const warnings: VBValidationWarning[] = [];

  const startNodes = nodes.filter((n) => n.type === 'start');
  const endNodes = nodes.filter((n) => n.type === 'end');

  if (startNodes.length === 0) errors.push({ code: 'NO_START', message: 'يجب أن يحتوي المسار على عقدة بداية' });
  if (startNodes.length > 1) errors.push({ code: 'MULTI_START', message: 'لا يمكن أن يكون هناك أكثر من عقدة بداية' });
  if (endNodes.length === 0) errors.push({ code: 'NO_END', message: 'يجب أن يحتوي المسار على عقدة نهاية' });

  const connectedNodeIds = new Set<string>();
  edges.forEach((e) => { connectedNodeIds.add(e.source); connectedNodeIds.add(e.target); });

  nodes.forEach((node) => {
    if (node.type === 'start' || node.type === 'end') return;
    if (!connectedNodeIds.has(node.id)) {
      warnings.push({ nodeId: node.id, code: 'DISCONNECTED', message: `العقدة "${node.data.label}" غير متصلة` });
    }
  });

  // Dead-end detection: non-end nodes with no outgoing edges
  const nodesWithOutgoing = new Set(edges.map((e) => e.source));
  nodes.forEach((node) => {
    if (node.type === 'end') return;
    if (!nodesWithOutgoing.has(node.id) && connectedNodeIds.has(node.id)) {
      errors.push({ nodeId: node.id, code: 'DEAD_END', message: `العقدة "${node.data.label}" لا تؤدي إلى أي عقدة` });
    }
  });

  // Circular reference detection (simple DFS)
  const adjList = new Map<string, string[]>();
  nodes.forEach((n) => adjList.set(n.id, []));
  edges.forEach((e) => adjList.get(e.source)?.push(e.target));

  const visited = new Set<string>();
  const inStack = new Set<string>();
  let hasCycle = false;

  function dfs(nodeId: string) {
    if (inStack.has(nodeId)) { hasCycle = true; return; }
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    inStack.add(nodeId);
    adjList.get(nodeId)?.forEach(dfs);
    inStack.delete(nodeId);
  }

  nodes.forEach((n) => { if (!visited.has(n.id)) dfs(n.id); });
  if (hasCycle) warnings.push({ code: 'CYCLE', message: 'تم اكتشاف مرجع دائري في المسار' });

  return { valid: errors.length === 0, errors, warnings };
}

export function getNodeValidationErrors(nodeId: string, result: VBValidationResult): string[] {
  return [
    ...result.errors.filter((e) => e.nodeId === nodeId).map((e) => e.message),
    ...result.warnings.filter((w) => w.nodeId === nodeId).map((w) => w.message),
  ];
}
