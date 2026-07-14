/**
 * Universal Visual Builder — Auto Layout Engine
 * Topological sort → layered DAG layout (Sugiyama-inspired, no external deps)
 */

import type { VBNode, VBEdge } from './types';

const H_GAP = 220;
const V_GAP = 120;

export function autoLayout(nodes: VBNode[], edges: VBEdge[]): VBNode[] {
  if (nodes.length === 0) return nodes;

  // Build adjacency
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  nodes.forEach((n) => { inDegree.set(n.id, 0); adj.set(n.id, []); });
  edges.forEach((e) => {
    adj.get(e.source)?.push(e.target);
    inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
  });

  // Kahn's topological sort → layers
  const layers: string[][] = [];
  let queue = nodes.filter((n) => (inDegree.get(n.id) ?? 0) === 0).map((n) => n.id);

  while (queue.length > 0) {
    layers.push([...queue]);
    const next: string[] = [];
    queue.forEach((id) => {
      adj.get(id)?.forEach((child) => {
        const deg = (inDegree.get(child) ?? 1) - 1;
        inDegree.set(child, deg);
        if (deg === 0) next.push(child);
      });
    });
    queue = next;
  }

  // Assign positions
  const posMap = new Map<string, { x: number; y: number }>();
  layers.forEach((layer, layerIdx) => {
    const totalH = (layer.length - 1) * V_GAP;
    layer.forEach((id, nodeIdx) => {
      posMap.set(id, {
        x: layerIdx * H_GAP + 60,
        y: nodeIdx * V_GAP - totalH / 2 + 300,
      });
    });
  });

  // Nodes not in any layer (cycles) — place at end
  nodes.forEach((n) => {
    if (!posMap.has(n.id)) posMap.set(n.id, { x: layers.length * H_GAP + 60, y: 300 });
  });

  return nodes.map((n) => ({ ...n, position: posMap.get(n.id) ?? n.position }));
}
