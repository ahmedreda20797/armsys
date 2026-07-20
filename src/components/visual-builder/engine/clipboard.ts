/**
 * Universal Visual Builder — Clipboard (Copy / Cut / Paste)
 *
 * Handles the live React Flow selection → clipboard → re-instantiation cycle.
 * IDs are ALWAYS regenerated on paste to avoid collisions.
 *
 * Pure data helpers — no React, no execution.
 */

import type { VBNode, VBEdge } from './types';

export interface VBClipboardPayload {
  /** Schema version so future designers can migrate old clipboards. */
  v: 1;
  /** "designer" distinguishes from any other app clipboard payloads. */
  source: 'designer';
  /** Offset (in flow coords) applied to pasted nodes so they don't overlap. */
  cut?: boolean;
  nodes: VBNode[];
  edges: VBEdge[];
  copiedAt: number;
}

let inMemory: VBClipboardPayload | null = null;

const LOCAL_KEY = 'wf_designer_clipboard';

function readLocalStorage(): VBClipboardPayload | null {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as VBClipboardPayload;
  } catch {
    return null;
  }
}

function writeLocalStorage(p: VBClipboardPayload): void {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(p));
  } catch {
    /* quota / SSR — ignore */
  }
}

/** Place a copy of the current selection on the clipboard. */
export function copySelection(
  allNodes: VBNode[],
  allEdges: VBEdge[],
  selectedNodeIds: string[],
  cut = false,
): VBClipboardPayload | null {
  if (selectedNodeIds.length === 0) return null;
  const idSet = new Set(selectedNodeIds);
  const nodes = allNodes
    .filter((n) => idSet.has(n.id))
    .map((n) => ({ ...n, selected: undefined, data: { ...n.data } }));
  // Only internal edges (both ends in the selection) are copied.
  const edges = allEdges
    .filter((e) => idSet.has(e.source) && idSet.has(e.target))
    .map((e) => ({ ...e }));

  const payload: VBClipboardPayload = {
    v: 1,
    source: 'designer',
    cut,
    nodes,
    edges,
    copiedAt: Date.now(),
  };
  inMemory = payload;
  writeLocalStorage(payload);
  return payload;
}

export function cutSelection(
  allNodes: VBNode[],
  allEdges: VBEdge[],
  selectedNodeIds: string[],
): VBClipboardPayload | null {
  return copySelection(allNodes, allEdges, selectedNodeIds, true);
}

export interface PasteResult {
  nodes: VBNode[];
  edges: VBEdge[];
}

/** Read the clipboard and regenerate fresh IDs for every pasted element. */
export function pasteSelection(offset = { x: 40, y: 40 }): PasteResult {
  const payload = inMemory ?? readLocalStorage();
  if (!payload || payload.nodes.length === 0) return { nodes: [], edges: [] };

  const idMap = new Map<string, string>();
  let counter = 0;
  const makeId = (type: string): string => {
    counter += 1;
    return `${type}_paste_${Date.now().toString(36)}_${counter}`;
  };

  const nodes: VBNode[] = payload.nodes.map((n) => {
    const newId = makeId(n.data.definition.type);
    idMap.set(n.id, newId);
    return {
      ...n,
      id: newId,
      position: { x: n.position.x + offset.x, y: n.position.y + offset.y },
      selected: true,
      data: { ...n.data },
    } as VBNode;
  });

  const edges: VBEdge[] = payload.edges
    .map((e) => {
      const source = idMap.get(e.source);
      const target = idMap.get(e.target);
      if (!source || !target) return null;
      return {
        ...e,
        id: `edge_paste_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        source,
        target,
      } as VBEdge;
    })
    .filter((e): e is VBEdge => e !== null);

  return { nodes, edges };
}

export function hasClipboard(): boolean {
  const payload = inMemory ?? readLocalStorage();
  return !!payload && payload.nodes.length > 0;
}

export function clearClipboard(): void {
  inMemory = null;
  try { localStorage.removeItem(LOCAL_KEY); } catch { /* ignore */ }
}
