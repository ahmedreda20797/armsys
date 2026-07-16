/**
 * Universal Visual Builder — Simulation Engine
 * Deterministic step-by-step walk of the graph. NEVER executes business logic.
 * Only simulates the PATH a workflow would take given literal test variables.
 */

import type { VBNode, VBEdge } from './types';
import type {
  VBSimulationState, VBSimulationFrame, VBSimulationStatus,
  VBExprNode, VBExprCondition,
} from './v2-types';
import { isExprGroup, isExprCondition } from './v2-types';
import { computeExecutionOrder } from './v2-validation';

/* ─── Expression evaluation against test variables ───────────────────────── */

function lookup(path: string, vars: Record<string, unknown>): unknown {
  if (!path) return undefined;
  const parts = path.split('.');
  let cur: unknown = vars;
  for (const p of parts) {
    if (cur && typeof cur === 'object' && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return undefined;
    }
  }
  return cur;
}

function compare(op: string, left: unknown, right: unknown, valueTo?: unknown): boolean {
  switch (op) {
    case 'equals': return String(left) === String(right);
    case 'not_equals': return String(left) !== String(right);
    case 'greater_than': return Number(left) > Number(right);
    case 'less_than': return Number(left) < Number(right);
    case 'contains': return String(left ?? '').includes(String(right));
    case 'starts_with': return String(left ?? '').startsWith(String(right));
    case 'ends_with': return String(left ?? '').endsWith(String(right));
    case 'in_list': {
      const arr = Array.isArray(right) ? right : String(right).split(',');
      return arr.some((x) => String(x) === String(left));
    }
    case 'not_in_list': {
      const arr = Array.isArray(right) ? right : String(right).split(',');
      return !arr.some((x) => String(x) === String(left));
    }
    case 'empty': return left === undefined || left === null || left === '';
    case 'not_empty': return !(left === undefined || left === null || left === '');
    case 'between': return Number(left) >= Number(right) && Number(left) <= Number(valueTo ?? right);
    default: return false;
  }
}

export function evalExpression(node: VBExprNode | undefined, vars: Record<string, unknown>): boolean {
  if (!node) return true;
  if (isExprCondition(node)) {
    const left = lookup(node.field, vars);
    return compare(node.operator, left, node.value, node.valueTo);
  }
  if (isExprGroup(node)) {
    if (node.children.length === 0) return true;
    if (node.logic === 'and') return node.children.every((c) => evalExpression(c, vars));
    if (node.logic === 'or') return node.children.some((c) => evalExpression(c, vars));
    if (node.logic === 'not') return !evalExpression(node.children[0], vars);
  }
  return true;
}

/* ─── Build full simulation frames by walking the graph ──────────────────── */

export function buildSimulation(
  nodes: VBNode[],
  edges: VBEdge[],
  testVariables: Record<string, unknown> = {}
): VBSimulationState {
  const adj = new Map<string, VBEdge[]>();
  nodes.forEach((n) => adj.set(n.id, []));
  edges.forEach((e) => adj.get(e.source)?.push(e));

  const startNode = nodes.find((n) => n.data.definition.type === 'start')
    ?? nodes.find((n) => !edges.some((e) => e.target === n.id))
    ?? nodes[0];

  if (!startNode) {
    return { status: 'idle', frames: [], currentFrame: -1, executionPath: [], variables: testVariables, startedAt: null, finishedAt: null };
  }

  const frames: VBSimulationFrame[] = [];
  const visited = new Set<string>();
  const path: string[] = [];
  const vars = { ...testVariables };
  const MAX_STEPS = 200; // safety guard

  function walk(nodeId: string, depth: number) {
    if (depth > MAX_STEPS || visited.size > MAX_STEPS) return;
    const node = nodes.find((n) => n.id === nodeId);
    if (!node || visited.has(nodeId)) return;
    visited.add(nodeId);
    path.push(nodeId);

    const out = adj.get(nodeId) ?? [];

    // For decision nodes, evaluate branches in priority order
    const decision = ['condition', 'switch', 'compare'].includes(node.data.definition.type);
    let edgeTaken: VBEdge | undefined;
    let decisionNote: string | undefined;

    if (decision && out.length > 0) {
      // Sort by priority then execution order
      const sorted = [...out].sort((a, b) => {
        const pa = ((a.data as any)?.priority ?? 0) as number;
        const pb = ((b.data as any)?.priority ?? 0) as number;
        return pb - pa;
      });
      for (const edge of sorted) {
        const cond = (edge.data as any)?.condition as VBExprNode | undefined;
        if (evalExpression(cond, vars)) {
          edgeTaken = edge;
          decisionNote = `→ ${edge.label || edge.sourceHandle || 'branch'}`;
          break;
        }
      }
      if (!edgeTaken && sorted.length > 0) {
        edgeTaken = sorted[sorted.length - 1]; // default fallback
        decisionNote = '→ default';
      }
    } else if (out.length > 0) {
      edgeTaken = out[0];
    }

    frames.push({
      stepIndex: frames.length,
      nodeId,
      nodeName: node.data.label,
      nodeType: node.data.definition.type,
      status: 'completed',
      edgeTaken: edgeTaken?.id,
      variablesSnapshot: { ...vars },
      decision: decisionNote,
      timestamp: Date.now() + frames.length,
      notes: decision ? `Decision evaluated (${decisionNote ?? 'no branch'})` : `${node.data.definition.type} executed`,
    });

    if (edgeTaken) {
      walk(edgeTaken.target, depth + 1);
    } else if (node.data.definition.type !== 'end') {
      // dead end
    }
  }

  walk(startNode.id, 0);

  return {
    status: frames.length > 0 ? 'completed' : 'idle',
    frames,
    currentFrame: -1,
    executionPath: path,
    variables: vars,
    startedAt: Date.now(),
    finishedAt: Date.now(),
  };
}

/* ─── Controller helpers (for step-by-step UI) ───────────────────────────── */

export function initialSimState(): VBSimulationState {
  return {
    status: 'idle',
    frames: [],
    currentFrame: -1,
    executionPath: [],
    variables: {},
    startedAt: null,
    finishedAt: null,
  };
}

export function stepForward(state: VBSimulationState): VBSimulationState {
  if (state.currentFrame >= state.frames.length - 1) return state;
  const next = state.currentFrame + 1;
  return {
    ...state,
    status: next === state.frames.length - 1 ? 'completed' : 'stepping',
    currentFrame: next,
    variables: state.frames[next]?.variablesSnapshot ?? state.variables,
  };
}

export function stepBack(state: VBSimulationState): VBSimulationState {
  if (state.currentFrame <= 0) {
    return { ...state, currentFrame: -1, status: 'idle', variables: state.frames[0]?.variablesSnapshot ?? {} };
  }
  const prev = state.currentFrame - 1;
  return {
    ...state,
    status: 'paused',
    currentFrame: prev,
    variables: state.frames[prev]?.variablesSnapshot ?? state.variables,
  };
}

export function restartSim(state: VBSimulationState): VBSimulationState {
  return { ...state, currentFrame: -1, status: 'idle', variables: state.frames[0]?.variablesSnapshot ?? {} };
}

export function runSim(state: VBSimulationState): VBSimulationState {
  return { ...state, status: 'running', currentFrame: state.frames.length - 1, variables: state.frames[state.frames.length - 1]?.variablesSnapshot ?? state.variables };
}

export function pauseSim(state: VBSimulationState): VBSimulationState {
  return { ...state, status: 'paused' };
}
