/**
 * Universal Visual Builder — V2 Validation Engine
 * Extends V1 validateGraph with 16 checks + workflow scoring + metrics.
 * Pure stateless functions. No side effects. No execution.
 */

import type { VBNode, VBEdge } from './types';
import type {
  VBValidationIssue,
  VBValidationReport,
  VBValidationCode,
  VBValidationSeverity,
  VBWorkflowMetrics,
  VBNodeConfig,
  VBExprNode,
} from './v2-types';
import { isExprGroup, isExprCondition } from './v2-types';
import { validateGraph } from './validationEngine';

let issueCounter = 0;
function issue(
  severity: VBValidationSeverity,
  code: VBValidationCode,
  message: string,
  messageAr: string,
  category: VBValidationIssue['category'],
  fixable: boolean,
  nodeId?: string,
  edgeId?: string
): VBValidationIssue {
  issueCounter += 1;
  return { id: `issue_${issueCounter}`, severity, code, message, messageAr, category, fixable, nodeId, edgeId };
}

/* ─── Metrics ────────────────────────────────────────────────────────────── */

export function computeMetrics(nodes: VBNode[]): VBWorkflowMetrics {
  const nodeCount = nodes.length;
  const decisionCount = nodes.filter(
    (n) => ['condition', 'switch', 'compare'].includes(n.data.definition.type)
  ).length;
  const actionCount = nodes.filter((n) => n.data.definition.category === 'actions').length;
  const variableCount = nodes.filter(
    (n) => ['set_variable', 'get_variable'].includes(n.data.definition.type)
  ).length;

  // Complexity heuristic
  let complexity: VBWorkflowMetrics['estimatedComplexity'] = 'low';
  const complexityScore = nodeCount + decisionCount * 3 + actionCount * 2;
  if (complexityScore > 40) complexity = 'very_high';
  else if (complexityScore > 20) complexity = 'high';
  else if (complexityScore > 8) complexity = 'medium';

  return {
    nodeCount,
    edgeCount: 0, // filled by caller
    depth: 0,     // filled by caller
    decisionCount,
    variableCount,
    actionCount,
    estimatedComplexity: complexity,
    estimatedExecutionMs: nodeCount * 350 + decisionCount * 500,
    validationScore: 100,
  };
}

/* ─── Longest-path depth (BFS layering) ──────────────────────────────────── */

export function computeDepth(nodes: VBNode[], edges: VBEdge[]): number {
  if (nodes.length === 0) return 0;
  const inDeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  nodes.forEach((n) => { inDeg.set(n.id, 0); adj.set(n.id, []); });
  edges.forEach((e) => {
    adj.get(e.source)?.push(e.target);
    inDeg.set(e.target, (inDeg.get(e.target) ?? 0) + 1);
  });
  const depth = new Map<string, number>();
  const queue = nodes.filter((n) => (inDeg.get(n.id) ?? 0) === 0).map((n) => ({ id: n.id, d: 1 }));
  queue.forEach((q) => depth.set(q.id, q.d));
  while (queue.length) {
    const cur = queue.shift()!;
    adj.get(cur.id)?.forEach((child) => {
      const nd = Math.max(depth.get(child) ?? 0, cur.d + 1);
      depth.set(child, nd);
      queue.push({ id: child, d: nd });
    });
  }
  let max = 0;
  depth.forEach((d) => { if (d > max) max = d; });
  return max;
}

/* ─── Reachability from Start (DFS) ──────────────────────────────────────── */

function reachableFromStart(nodes: VBNode[], edges: VBEdge[]): Set<string> {
  const startNodes = nodes.filter((n) => n.data.definition.type === 'start');
  const adj = new Map<string, string[]>();
  nodes.forEach((n) => adj.set(n.id, []));
  edges.forEach((e) => adj.get(e.source)?.push(e.target));
  const visited = new Set<string>();
  const stack = [...startNodes.map((n) => n.id)];
  while (stack.length) {
    const cur = stack.pop()!;
    if (visited.has(cur)) continue;
    visited.add(cur);
    adj.get(cur)?.forEach((c) => stack.push(c));
  }
  return visited;
}

/* ─── Expression validation (recursive) ──────────────────────────────────── */

function validateExpression(
  node: VBExprNode,
  knownFields: Set<string>,
  issues: VBValidationIssue[],
  nodeId?: string
): void {
  if (isExprCondition(node)) {
    if (!node.field) {
      issues.push(issue('warning', 'MISSING_REQUIRED_CONFIG',
        'Condition has no field selected',
        'الشرط لا يحتوي على حقل محدد', 'conditions', true, nodeId));
    } else if (!knownFields.has(node.field) && !node.field.startsWith('system.') && !node.field.startsWith('literal.')) {
      issues.push(issue('warning', 'BROKEN_REFERENCE',
        `Condition references unknown variable "${node.field}"`,
        `الشرط يشير إلى متغير غير معروف "${node.field}"`, 'conditions', false, nodeId));
    }
    if (node.operator === 'between' && (node.value === undefined || node.valueTo === undefined)) {
      issues.push(issue('error', 'MISSING_REQUIRED_CONFIG',
        'Between operator requires two values',
        'عامل "بين" يتطلب قيمتين', 'conditions', true, nodeId));
    }
    return;
  }
  if (isExprGroup(node)) {
    if (node.children.length === 0) {
      issues.push(issue('warning', 'MISSING_REQUIRED_CONFIG',
        'Empty condition group',
        'مجموعة شروط فارغة', 'conditions', true, nodeId));
    }
    node.children.forEach((c) => validateExpression(c, knownFields, issues, nodeId));
  }
}

/* ─── Main V2 validator ──────────────────────────────────────────────────── */

export function validateGraphV2(
  nodes: VBNode[],
  edges: VBEdge[],
  variables: { name: string }[] = []
): VBValidationReport {
  issueCounter = 0;
  const issues: VBValidationIssue[] = [];

  // 1. Delegate structural checks to V1 engine
  const v1 = validateGraph(nodes, edges);
  v1.errors.forEach((e) => {
    const code = (e.code as VBValidationCode) ?? 'DISCONNECTED';
    issues.push(issue('error', code, e.message, e.message, 'structure', true, e.nodeId, e.edgeId));
  });
  v1.warnings.forEach((w) => {
    const code = (w.code as VBValidationCode) ?? 'DISCONNECTED';
    issues.push(issue('warning', code, w.message, w.message, 'structure', true, w.nodeId));
  });

  // 2. Reachability — orphan / unreachable nodes
  const reachable = reachableFromStart(nodes, edges);
  nodes.forEach((n) => {
    if (n.data.definition.type === 'start') return;
    if (!reachable.has(n.id)) {
      issues.push(issue('warning', 'ORPHAN_NODE',
        `Node "${n.data.label}" is unreachable from Start`,
        `العقدة "${n.data.label}" لا يمكن الوصول إليها من البداية`, 'structure', false, n.id));
    }
  });

  // 3. Unreachable branches (switch/condition output ports with no edges)
  const sourceEdgeCount = new Map<string, number>();
  edges.forEach((e) => sourceEdgeCount.set(e.source, (sourceEdgeCount.get(e.source) ?? 0) + 1));
  nodes.forEach((n) => {
    const outputs = n.data.definition.ports.filter((p) => p.type === 'output');
    if (outputs.length > 1 && (sourceEdgeCount.get(n.id) ?? 0) < outputs.length) {
      // not every branch is connected — info level only
      issues.push(issue('info', 'UNREACHABLE_BRANCH',
        `Node "${n.data.label}" has unconnected branches`,
        `العقدة "${n.data.label}" لها فروع غير متصلة`, 'structure', false, n.id));
    }
  });

  // 4. Infinite loop detection (cycle through loop nodes without exit)
  const loopNodes = nodes.filter((n) => n.data.definition.type === 'loop');
  loopNodes.forEach((loop) => {
    const hasDoneEdge = edges.some((e) => e.source === loop.id && e.sourceHandle === 'done');
    if (!hasDoneEdge) {
      issues.push(issue('error', 'INFINITE_LOOP',
        `Loop "${loop.data.label}" has no exit (done) path`,
        `الحلقة "${loop.data.label}" ليس لها مسار خروج`, 'structure', true, loop.id));
    }
  });

  // 5. Retry without timeout
  nodes.forEach((n) => {
    const cfg = n.data.config as Partial<VBNodeConfig> | undefined;
    if (cfg?.onError === 'retry' && (cfg.timeoutMs === undefined || cfg.timeoutMs <= 0)) {
      issues.push(issue('warning', 'RETRY_WITHOUT_TIMEOUT',
        `Node "${n.data.label}" uses retry without a timeout`,
        `العقدة "${n.data.label}" تستخدم إعادة المحاولة بدون مهلة`, 'configuration', true, n.id));
    }
  });

  // 6. Missing required configuration for action nodes
  nodes.forEach((n) => {
    const def = n.data.definition;
    if (def.category === 'actions' || def.category === 'requests') {
      const cfg = n.data.config as Record<string, unknown> | undefined;
      const hasConfig = cfg && Object.keys(cfg).length > 0;
      if (!hasConfig) {
        issues.push(issue('info', 'MISSING_REQUIRED_CONFIG',
          `Node "${n.data.label}" has no configuration`,
          `العقدة "${n.data.label}" ليس لها إعداد`, 'configuration', true, n.id));
      }
    }
  });

  // 7. Variable issues
  const knownFields = new Set<string>(variables.map((v) => v.name));
  // 7a. Duplicate variables
  const seen = new Map<string, number>();
  variables.forEach((v) => seen.set(v.name, (seen.get(v.name) ?? 0) + 1));
  seen.forEach((count, name) => {
    if (count > 1) {
      issues.push(issue('error', 'DUPLICATE_VARIABLE',
        `Variable "${name}" is defined ${count} times`,
        `المتغير "${name}" معرّف ${count} مرات`, 'variables', true));
    }
  });
  // 7b. Unused variables (info)
  const allLabels = nodes.map((n) => `${n.data.label} ${JSON.stringify(n.data.config)}`).join(' ');
  variables.forEach((v) => {
    if (!allLabels.includes(v.name) && !v.name.startsWith('system.')) {
      issues.push(issue('info', 'UNUSED_VARIABLE',
        `Variable "${v.name}" is not referenced by any node`,
        `المتغير "${v.name}" غير مستخدم`, 'variables', false));
    }
  });

  // 8. Validate expressions on nodes/edges
  nodes.forEach((n) => {
    const cfg = n.data.config as Partial<VBNodeConfig> | undefined;
    if (cfg?.condition) validateExpression(cfg.condition, knownFields, issues, n.id);
    cfg?.inputs?.forEach((inp) => {
      if (inp.source === 'expression' && inp.expression) {
        validateExpression(inp.expression, knownFields, issues, n.id);
      }
    });
  });
  edges.forEach((e) => {
    const data = (e.data ?? {}) as { condition?: VBExprNode };
    if (data.condition) validateExpression(data.condition, knownFields, issues);
  });

  // 9. Missing trigger (info)
  const hasTrigger = nodes.some((n) => n.data.definition.type === 'trigger' || n.data.definition.type === 'start');
  if (!hasTrigger && nodes.length > 0) {
    issues.push(issue('info', 'MISSING_TRIGGER',
      'Workflow has no trigger node',
      'المسار لا يحتوي على محفز', 'configuration', true));
  }

  // 10. Overcomplex (performance)
  const metrics = computeMetrics(nodes);
  metrics.edgeCount = edges.length;
  metrics.depth = computeDepth(nodes, edges);
  if (metrics.nodeCount > 50) {
    issues.push(issue('warning', 'OVERCOMPLEX',
      `Workflow is large (${metrics.nodeCount} nodes) — consider splitting`,
      `المسار كبير (${metrics.nodeCount} عقدة) — يُفضل تقسيمه`, 'performance', false));
  }

  // ── Score (0-100) ───────────────────────────────────────────────────────
  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warningCount = issues.filter((i) => i.severity === 'warning').length;
  const infoCount = issues.filter((i) => i.severity === 'info').length;
  let score = 100;
  score -= errorCount * 15;
  score -= warningCount * 5;
  score -= infoCount * 1;
  metrics.validationScore = Math.max(0, score);

  return {
    valid: errorCount === 0,
    errors: issues.filter((i) => i.severity === 'error').map((i) => ({ code: i.code, message: i.messageAr, nodeId: i.nodeId, edgeId: i.edgeId })),
    warnings: issues.filter((i) => i.severity !== 'error').map((i) => ({ code: i.code, message: i.messageAr, nodeId: i.nodeId })),
    issues,
    score: metrics.validationScore,
    metrics,
  };
}

/* ─── Execution order (topological) for preview ──────────────────────────── */

import type { VBExecutionStep } from './v2-types';

export function computeExecutionOrder(nodes: VBNode[], edges: VBEdge[]): VBExecutionStep[] {
  const inDeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  nodes.forEach((n) => { inDeg.set(n.id, 0); adj.set(n.id, []); });
  edges.forEach((e) => {
    adj.get(e.source)?.push(e.target);
    inDeg.set(e.target, (inDeg.get(e.target) ?? 0) + 1);
  });

  const startNodes = nodes.filter((n) => n.data.definition.type === 'start' || (inDeg.get(n.id) ?? 0) === 0);
  const visited = new Set<string>();
  const order: VBExecutionStep[] = [];
  let idx = 0;
  const queue = [...startNodes];

  while (queue.length) {
    const node = queue.shift()!;
    if (visited.has(node.id)) continue;
    visited.add(node.id);
    idx += 1;
    const branchEdge = edges.find((e) => e.target === node.id);
    order.push({
      order: idx,
      nodeId: node.id,
      nodeName: node.data.label,
      nodeType: node.data.definition.type,
      branchLabel: branchEdge?.label,
      isDecision: ['condition', 'switch', 'compare'].includes(node.data.definition.type),
    });
    adj.get(node.id)?.forEach((childId) => {
      const d = nodes.find((n) => n.id === childId);
      if (d) queue.push(d);
    });
  }
  // Append any unvisited (cycles)
  nodes.forEach((n) => {
    if (!visited.has(n.id)) {
      idx += 1;
      order.push({
        order: idx, nodeId: n.id, nodeName: n.data.label,
        nodeType: n.data.definition.type, isDecision: false,
      });
    }
  });
  return order;
}
