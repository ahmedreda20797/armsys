/**
 * Universal Visual Builder — History Manager (Undo/Redo)
 */

import { useState, useCallback } from 'react';
import type { VBNode, VBEdge } from './types';

const MAX_HISTORY = 50;

export function useHistoryManager(initialNodes: VBNode[], initialEdges: VBEdge[]) {
  const [past, setPast] = useState<Array<{ nodes: VBNode[]; edges: VBEdge[] }>>([]);
  const [future, setFuture] = useState<Array<{ nodes: VBNode[]; edges: VBEdge[] }>>([]);

  const push = useCallback((nodes: VBNode[], edges: VBEdge[]) => {
    setPast((p) => [...p.slice(-MAX_HISTORY + 1), { nodes, edges }]);
    setFuture([]);
  }, []);

  const undo = useCallback(
    (currentNodes: VBNode[], currentEdges: VBEdge[]) => {
      if (past.length === 0) return null;
      const prev = past[past.length - 1];
      setPast((p) => p.slice(0, -1));
      setFuture((f) => [{ nodes: currentNodes, edges: currentEdges }, ...f]);
      return prev;
    },
    [past]
  );

  const redo = useCallback(
    (currentNodes: VBNode[], currentEdges: VBEdge[]) => {
      if (future.length === 0) return null;
      const next = future[0];
      setFuture((f) => f.slice(1));
      setPast((p) => [...p, { nodes: currentNodes, edges: currentEdges }]);
      return next;
    },
    [future]
  );

  return {
    push,
    undo,
    redo,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
  };
}
