'use client';

// ═══════════════════════════════════════════════════════════════
//  OrgTreeWorkspace — §17 the REAL organization-tree workspace.
//
//  §ORG-TREE-V2 — ENTERPRISE FLOWING WORKFLOW:
//    • PRECISE LINKING — every connector anchors to the parent card's
//      live bottom edge and the child's top edge; node heights are
//      part of the layout (employee panels grow the card), so lines
//      stay glued to the cards in every state.
//    • EMERGENCE — expanding a card births its children FROM INSIDE
//      it (scale 0.45 + parent-center origin, spring settle); folding
//      absorbs them back into the card. Same grammar for departments
//      out of the company and teams out of departments.
//    • ELASTIC LINKS — connectors draw themselves (pathLength spring)
//      and their bezier `d` interpolates as cards glide, so the lines
//      flex with the motion instead of jumping.
//    • MEMBER REVEAL — every card unfolds its direct employee roster
//      in place (staggered rise), and the whole subtree reflows
//      smoothly around it.
//
//  §VIEW-ENGINE (fluid free viewport):
//    • MIDDLE MOUSE BUTTON (drag) = zoom — exponential response,
//      eased per frame, the grab point stays pinned (design-tool feel).
//    • WHEEL = zoom-to-cursor (same eased engine).
//    • LEFT BUTTON = pan/drag with soft trailing.
//    • FREE RANGE 8%–300% — animated buttons + animated fit.
//    • All view motion runs on ONE rAF easing loop writing the
//      transform imperatively — zero React re-renders while moving.
//
//  Canvas: select · double-click = details. Actions stay owned by the
//  page's dialogs — this workspace renders + selects only. One data
//  model: the same OrgTreeNode[] /api/organization returns, plus a
//  direct-members map for the rosters.
// ═══════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Building2, ChevronLeft, GitBranch, Landmark, Minus, Plus, Users, Maximize2, Network } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { OrgTreeNode } from '@/lib/organization';
import { ORG_NODE_LEVEL_LABELS_AR, ORG_NODE_LEVEL_LABELS_EN, resolveOrgTreeNodeLevel, type OrgNodeLevel } from '@/lib/organization';
import { useLanguage } from '@/lib/i18n/language-context';

// ─── Layout metrics ───────────────────────────────────────────
const NODE_W = 216;
const NODE_H = 74;
const SIBLING_GAP = 18;
const LEVEL_GAP = 96;
const PADDING = 120;

// ─── View engine metrics (§VIEW-ENGINE) ───────────────────────
const MIN_ZOOM = 0.08;  // أقصى تصغير — حر
const MAX_ZOOM = 3;     // أقصى تكبير — حر
const EASE_Z = 0.16;    // zoom easing factor per frame
const EASE_PAN = 0.3;   // pan easing factor per frame
const MID_DRAG_K = 0.012; // middle-drag → zoom exponent
const WHEEL_K = 0.0022;   // wheel → zoom exponent

// Member-roster panel metrics (drives the card height → layout).
const ROSTER_HEAD = 30;
const ROSTER_ROW = 27;
const ROSTER_MAX_ROWS = 4;

export interface OrgMemberRef {
  id: string;
  name: string | null;
  code: string | null;
}

// §ORG-LEVELS — cards are styled by the node's SEMANTIC LEVEL (the
// normalization layer resolves the General Administration root out of
// its legacy company-typed node), so الإدارة العامة / شركة / قسم /
// فريق / فريق فرعي are distinguishable by label + icon + shape —
// never by color alone.
const LEVEL_NODE_STYLES: Record<OrgNodeLevel, string> = {
  general_administration: 'border-violet-500/50 bg-violet-500/[0.09]',
  company: 'border-brand-500/40 bg-brand-500/[0.07]',
  department: 'border-blue-500/40 bg-blue-500/[0.07]',
  team: 'border-emerald-500/40 bg-emerald-500/[0.07]',
  subteam: 'border-cyan-500/40 bg-cyan-500/[0.07]',
};

const LEVEL_TEXT_STYLES: Record<OrgNodeLevel, string> = {
  general_administration: 'text-violet-300',
  company: 'text-brand-300',
  department: 'text-blue-300',
  team: 'text-emerald-300',
  subteam: 'text-cyan-300',
};

const LEVEL_EDGE_STROKES: Record<OrgNodeLevel, string> = {
  general_administration: 'rgba(167,139,250,0.6)',
  company: 'rgba(225,29,72,0.55)',
  department: 'rgba(96,165,250,0.5)',
  team: 'rgba(52,211,153,0.5)',
  subteam: 'rgba(34,211,238,0.5)',
};

/** Card height in the CURRENT state (roster panel included). When the
 *  roster scrolls, a small count line sits under it — part of the
 *  height so the connectors stay glued to the card's bottom edge. */
const ROSTER_NOTE = 14;

function cardHeight(
  node: OrgTreeNode,
  openRosters: Set<string>,
  membersOf: (id: string) => OrgMemberRef[],
): number {
  if (!openRosters.has(node.id)) return NODE_H;
  const count = membersOf(node.id).length;
  if (count === 0) return NODE_H;
  const note = count > ROSTER_MAX_ROWS ? ROSTER_NOTE : 0;
  return NODE_H + ROSTER_HEAD + Math.min(count, ROSTER_MAX_ROWS) * ROSTER_ROW + note + 10;
}

interface LaidOutNode {
  node: OrgTreeNode;
  x: number; // center x (data space — rendered right-anchored)
  y: number; // top y
  h: number; // current card height
  depth: number;
  parentId: string | null;
}

interface Edge {
  id: string;
  parentId: string;
  childLevel: OrgNodeLevel | null;
  x1: number; y1: number; x2: number; y2: number;
}

/**
 * Tidy-tree layout with LIVE card heights: children stack under their
 * parent, parent centers over their children, and every y accounts
 * for the parent's roster panel so connectors never float.
 */
function layoutTree(
  roots: OrgTreeNode[],
  collapsed: Set<string>,
  openRosters: Set<string>,
  membersOf: (id: string) => OrgMemberRef[],
): { nodes: LaidOutNode[]; edges: Edge[]; width: number; height: number } {
  const nodes: LaidOutNode[] = [];
  let cursorX = 0;

  const widthOf = (node: OrgTreeNode): number => {
    const kids = collapsed.has(node.id) ? [] : node.children;
    if (kids.length === 0) return NODE_W;
    return kids.reduce((sum, c) => sum + widthOf(c), 0) + SIBLING_GAP * (kids.length - 1);
  };

  const place = (
    node: OrgTreeNode,
    depth: number,
    left: number,
    yTop: number,
    parentId: string | null,
  ): number => {
    const kids = collapsed.has(node.id) ? [] : node.children;
    const h = cardHeight(node, openRosters, membersOf);
    let cx: number;
    if (kids.length === 0) {
      cx = left + NODE_W / 2;
    } else {
      let childLeft = left;
      const childCenters: number[] = [];
      for (const child of kids) {
        childCenters.push(place(child, depth + 1, childLeft, yTop + h + LEVEL_GAP, node.id));
        childLeft += widthOf(child) + SIBLING_GAP;
      }
      cx = (childCenters[0] + childCenters[childCenters.length - 1]) / 2;
    }
    nodes.push({ node, x: cx, y: yTop, h, depth, parentId });
    return cx;
  };

  for (const root of roots) {
    place(root, 0, cursorX, 0, null);
    cursorX += widthOf(root) + SIBLING_GAP * 2;
  }

  // Edges — parent's LIVE bottom edge → child's top edge.
  const byId = new Map(nodes.map((n) => [n.node.id, n]));
  const edges: Edge[] = [];
  for (const n of nodes) {
    if (collapsed.has(n.node.id)) continue;
    for (const child of n.node.children) {
      const c = byId.get(child.id);
      if (!c) continue;
      edges.push({
        id: `${n.node.id}->${child.id}`,
        parentId: n.node.id,
        childLevel: resolveOrgTreeNodeLevel(child),
        x1: n.x,
        y1: n.y + n.h,
        x2: c.x,
        y2: c.y,
      });
    }
  }

  const maxX = Math.max(...nodes.map((n) => n.x + NODE_W / 2), 0);
  const maxY = Math.max(...nodes.map((n) => n.y + n.h), 0);
  return { nodes, edges, width: maxX + PADDING, height: maxY + PADDING };
}

/** Physical translateX that right-anchors a card at data-x. */
const xOff = (x: number): number => NODE_W / 2 - x;

interface OrgTreeWorkspaceProps {
  tree: OrgTreeNode[];
  /** Direct employees per node id — powers the in-card rosters. */
  employeesByNode: Map<string, OrgMemberRef[]>;
  canUpdate: boolean;
  canCreate: boolean;
  onSelectNode: (node: OrgTreeNode | null) => void;
  onNodeAction: (action: 'details' | 'members' | 'move' | 'edit' | 'addChild', node: OrgTreeNode) => void;
}

export function OrgTreeWorkspace({
  tree,
  employeesByNode,
  canUpdate: _canUpdate,
  canCreate: _canCreate,
  onSelectNode,
  onNodeAction,
}: OrgTreeWorkspaceProps) {
  const { dir, locale, t } = useLanguage();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [openRosters, setOpenRosters] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const membersOf = useCallback(
    (id: string): OrgMemberRef[] => employeesByNode.get(id) ?? [],
    [employeesByNode],
  );

  const layout = useMemo(
    () => layoutTree(tree, collapsed, openRosters, membersOf),
    [tree, collapsed, openRosters, membersOf],
  );

  // Current positions — the emergence/absorption targets (derived, no refs).
  const positionsById = useMemo(
    () => new Map(layout.nodes.map((n) => [n.node.id, { xOff: xOff(n.x), y: n.y, h: n.h }])),
    [layout],
  );

  // ── §VIEW-ENGINE — imperative eased viewport (no React churn) ──
  const containerRef = useRef<HTMLDivElement>(null);
  const viewBoxRef = useRef<HTMLDivElement>(null);
  const zoomLabelRef = useRef<HTMLSpanElement>(null);
  const viewRef = useRef({
    z: 0.85, zT: 0.85,
    px: 0, py: 0, pxT: 0, pyT: 0,
    raf: 0,
    // gestures
    mode: 'none' as 'none' | 'pan' | 'zoom',
    startClient: { x: 0, y: 0 },
    startPan: { x: 0, y: 0 },
    startZ: 1,
    // zoom anchor: A = cursor (container coords), (xd, yd) = the DATA
    // point under it. Screen mapping (§ZOOM-ORIGIN): the data box is
    // anchored explicitly per direction (RTL → right edge, LTR → left
    // edge), so its top-right corner — the transform origin — sits at
    // container-X = ORIGIN X, which is direction-dependent:
    //   RTL: the box right-hugs the container →  O = container width
    //   LTR: the box left-hugs  the container →  O = box width
    //   screen_x = O + px − z·x  ·  screen_y = py + z·y
    // ONE geometric zoom implementation; direction enters ONLY as this
    // origin X — never as different math (§13 direction-independence).
    anchor: null as { ax: number; ay: number; xd: number; yd: number } | null,
  });
  const fittedRef = useRef(false);

  /** Container-X of the data box's transform-origin corner (top-right).
   *  RTL static/explicit anchoring right-hugs the container (O = cw);
   *  LTR left-hugs it (O = the box's own width). offsetWidth is
   *  transform-immune, so this is exact in every zoom state. */
  const originX = useCallback((): number => {
    const container = containerRef.current;
    const box = viewBoxRef.current;
    if (!container || !box) return 0;
    return dir === 'rtl' ? container.clientWidth : box.offsetWidth;
  }, [dir]);

  /** Pan X that right-aligns the fitted tree to the container edge —
   *  the RTL fit (px = 0) generalized to both directions. */
  const fitPanX = useCallback((): number => {
    const container = containerRef.current;
    return container ? container.clientWidth - originX() : 0;
  }, [originX]);

  const applyTransform = useCallback(() => {
    const box = viewBoxRef.current;
    const label = zoomLabelRef.current;
    const v = viewRef.current;
    if (box) {
      box.style.transform = `translate(${v.px}px, ${v.py}px) scale(${v.z})`;
    }
    if (label) {
      label.textContent = `${Math.round(v.z * 100)}%`;
    }
  }, []);

  const ensureLoop = useCallback(() => {
    const v = viewRef.current;
    if (v.raf) return;
    const tick = () => {
      // Ease toward targets…
      v.z += (v.zT - v.z) * EASE_Z;
      v.px += (v.pxT - v.px) * EASE_PAN;
      v.py += (v.pyT - v.py) * EASE_PAN;
      // …and whenever an anchor is set (wheel OR middle-drag), pan pins
      // the cursor's data point EXACTLY while z eases toward zT:
      //   screen_x = O + px − z·x  →  px = A.x − O + z·x_d
      //   screen_y = py + z·y      →  py = A.y − z·y_d
      if (v.anchor) {
        v.px = v.anchor.ax - originX() + v.z * v.anchor.xd;
        v.py = v.anchor.ay - v.z * v.anchor.yd;
      }
      v.pxT = v.px;
      v.pyT = v.py;
      applyTransform();
      const settled =
        Math.abs(v.zT - v.z) < 0.0004 &&
        v.mode !== 'zoom';
      if (settled) {
        v.raf = 0;
        v.anchor = null;
        return;
      }
      v.raf = requestAnimationFrame(tick);
    };
    v.raf = requestAnimationFrame(tick);
  }, [applyTransform, originX]);

  const zoomAround = useCallback(
    (nextZRaw: number, cursor: { x: number; y: number } | null) => {
      const v = viewRef.current;
      const zNew = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZRaw));
      if (cursor) {
        // Data point under the cursor with the CURRENT state:
        //   x_d = (O + px − A.x) / z  ·  y_d = (A.y − py) / z
        v.anchor = {
          ax: cursor.x,
          ay: cursor.y,
          xd: (originX() + v.px - cursor.x) / v.z,
          yd: (cursor.y - v.py) / v.z,
        };
      } else {
        v.anchor = null;
      }
      v.zT = zNew;
      ensureLoop();
    },
    [ensureLoop, originX],
  );

  // Re-assert the transform after React re-renders (tree changes).
  useEffect(() => {
    applyTransform();
  }, [layout, applyTransform]);

  // Fit the view once on first layout (animated).
  useEffect(() => {
    if (fittedRef.current || layout.width === 0) return;
    fittedRef.current = true;
    const container = containerRef.current;
    if (!container) return;
    const z = Math.min(
      1.1,
      Math.max(MIN_ZOOM, Math.min(container.clientWidth / layout.width, container.clientHeight / layout.height)),
    );
    const v = viewRef.current;
    v.zT = z;
    v.pxT = fitPanX();
    v.pyT = 0;
    ensureLoop();
  }, [layout.width, layout.height, ensureLoop, fitPanX]);

  const fitView = useCallback(() => {
    const container = containerRef.current;
    if (!container || layout.width === 0) return;
    const z = Math.min(
      1.1,
      Math.max(MIN_ZOOM, Math.min(container.clientWidth / layout.width, container.clientHeight / layout.height)),
    );
    const v = viewRef.current;
    v.zT = z;
    v.pxT = fitPanX();
    v.pyT = 0;
    v.anchor = null;
    ensureLoop();
  }, [layout.width, layout.height, ensureLoop, fitPanX]);

  const zoomBy = useCallback(
    (factor: number) => {
      const container = containerRef.current;
      const c = container
        ? { x: container.clientWidth / 2, y: container.clientHeight / 2 }
        : null;
      const v = viewRef.current;
      zoomAround(v.zT * factor, c);
    },
    [zoomAround],
  );

  // Wheel zoom-to-cursor.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey && Math.abs(e.deltaY) < 2) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const v = viewRef.current;
      zoomAround(
        v.zT * Math.exp(-e.deltaY * WHEEL_K),
        { x: e.clientX - rect.left, y: e.clientY - rect.top },
      );
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAround]);

  // Block the browser's middle-click autoscroll inside the canvas.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const prevent = (e: Event) => {
      if ((e as MouseEvent).button === 1) e.preventDefault();
    };
    el.addEventListener('mousedown', prevent);
    el.addEventListener('auxclick', prevent);
    return () => {
      el.removeEventListener('mousedown', prevent);
      el.removeEventListener('auxclick', prevent);
    };
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    const v = viewRef.current;
    // ── MIDDLE BUTTON (البكره) → fluid zoom gesture ──
    if (e.button === 1) {
      e.preventDefault();
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const cursor = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      // Pin the data point under the grab for the whole gesture.
      v.anchor = {
        ax: cursor.x,
        ay: cursor.y,
        xd: (originX() + v.px - cursor.x) / v.z,
        yd: (cursor.y - v.py) / v.z,
      };
      v.mode = 'zoom';
      v.startClient = { x: e.clientX, y: e.clientY };
      v.startZ = v.zT;
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      ensureLoop();
      return;
    }
    // ── LEFT BUTTON → pan/drag ──
    if (e.button !== 0) return;
    v.mode = 'pan';
    v.startClient = { x: e.clientX, y: e.clientY };
    v.startPan = { x: v.px, y: v.py };
    v.anchor = null;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    ensureLoop();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const v = viewRef.current;
    if (v.mode === 'zoom') {
      // Drag up = zoom in, down = out — exponential, free, eased.
      const dy = v.startClient.y - e.clientY;
      zoomAround(v.startZ * Math.exp(dy * MID_DRAG_K), null);
      return;
    }
    if (v.mode !== 'pan') return;
    // Zoom-aware pan: translate() applies AFTER scale (screen px).
    const dx = e.clientX - v.startClient.x;
    const dy = e.clientY - v.startClient.y;
    v.pxT = v.startPan.x + dx;
    v.pyT = v.startPan.y + dy;
    ensureLoop();
  };

  const endGesture = useCallback(() => {
    const v = viewRef.current;
    v.mode = 'none';
    // Keep the anchor: if z is still easing toward zT, the pin keeps
    // working until the loop settles (which clears it). Pan mode has
    // no anchor by definition.
    if (!v.anchor) {
      v.pxT = v.px;
      v.pyT = v.py;
    }
    ensureLoop();
  }, [ensureLoop]);

  const toggleCollapse = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleRoster = useCallback((id: string) => {
    setOpenRosters((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleSelect = useCallback(
    (node: OrgTreeNode) => {
      setSelectedId(node.id);
      onSelectNode(node);
    },
    [onSelectNode],
  );

  if (tree.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Network className="size-12 text-slate-600 mb-3" />
        <p className="text-slate-400 text-sm">{t('org.tree.empty')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Toolbar */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[10px] text-slate-500 me-1">
          {t('org.tree.hint')}
        </span>
        <div className="flex items-center gap-1 ms-auto">
          <Button variant="outline" size="icon" className="size-7 border-slate-700/50 text-slate-300 hover:bg-slate-800" onClick={() => zoomBy(1 / 1.25)} aria-label={t('org.tree.zoomOut')}>
            <Minus className="size-3.5" />
          </Button>
          <span ref={zoomLabelRef} className="text-[10px] text-slate-400 tabular-nums w-10 text-center">85%</span>
          <Button variant="outline" size="icon" className="size-7 border-slate-700/50 text-slate-300 hover:bg-slate-800" onClick={() => zoomBy(1.25)} aria-label={t('org.tree.zoomIn')}>
            <Plus className="size-3.5" />
          </Button>
          <Button variant="outline" size="icon" className="size-7 border-slate-700/50 text-slate-300 hover:bg-slate-800" onClick={fitView} aria-label={t('org.tree.fit')} title={t('org.tree.fit')}>
            <Maximize2 className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* Canvas — fills the viewport down to the page bottom
          (§LAYOUT-EXPAND): 100dvh minus the chrome stack above it
          (app header + page identity + tabs + toolbar + paddings). */}
      <div
        ref={containerRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
        onPointerLeave={endGesture}
        className={cn(
          'relative h-[calc(100dvh-270px)] min-h-[560px] rounded-xl border border-slate-700/40 bg-slate-950/60 overflow-hidden select-none touch-none',
        )}
      >
        <div
          ref={viewBoxRef}
          className="absolute"
          style={{
            transform: 'translate(0px, 0px) scale(0.85)',
            transformOrigin: 'top right',
            width: layout.width,
            height: layout.height,
            // §ZOOM-ORIGIN — explicit direction anchoring: the box hugs
            // the container edge the sidebar layout puts it on, so the
            // origin-corner X is deterministic in BOTH languages
            // (RTL → right edge, LTR → left edge; same as the static
            // positioning, now guaranteed).
            ...(dir === 'rtl' ? { right: 0 } : { left: 0 }),
          }}
        >
          {/* ── Connectors — elastic bezier links ──
              The <g> mirrors the x-axis so path coordinates live in the
              same data space as the right-anchored cards. `d` animates
              (lines flex as cards glide); pathLength draws/absorbs on
              expand/collapse. */}
          <svg className="absolute inset-0 pointer-events-none" width={layout.width} height={layout.height}>
            <g transform={`translate(${layout.width} 0) scale(-1 1)`}>
              <AnimatePresence initial={false}>
                {layout.edges.map((e) => {
                  const midY = (e.y1 + e.y2) / 2;
                  const d = `M ${e.x1} ${e.y1} C ${e.x1} ${midY}, ${e.x2} ${midY}, ${e.x2} ${e.y2}`;
                  return (
                    <motion.path
                      key={e.id}
                      initial={{ pathLength: 0, opacity: 0 }}
                      animate={{ pathLength: 1, opacity: 1, d }}
                      exit={{ pathLength: 0, opacity: 0, transition: { duration: 0.24, ease: 'easeIn' } }}
                      transition={{
                        pathLength: { duration: 0.45, ease: [0.22, 1, 0.36, 1] },
                        opacity: { duration: 0.2 },
                        // SAME spring as the cards (§LINE-SYNC) — the link
                        // travels glued to its endpoints instead of lagging
                        // behind them and detaching mid-flight.
                        d: { type: 'spring', stiffness: 320, damping: 30 },
                      }}
                      fill="none"
                      stroke={(e.childLevel && LEVEL_EDGE_STROKES[e.childLevel]) || 'rgba(148,163,184,0.35)'}
                      strokeWidth={1.75}
                      strokeLinecap="round"
                      vectorEffect="non-scaling-stroke"
                    />
                  );
                })}
              </AnimatePresence>
            </g>
          </svg>

          {/* ── Cards — emergence / absorption ── */}
          <AnimatePresence initial={false}>
            {layout.nodes.map(({ node, x, y, depth, parentId }) => {
              const isCollapsed = collapsed.has(node.id);
              const isSelected = selectedId === node.id;
              // §ORG-LEVELS — semantic level drives style/icon/label.
              const level = resolveOrgTreeNodeLevel(node) ?? 'department';
              const style = LEVEL_NODE_STYLES[level];
              const textStyle = LEVEL_TEXT_STYLES[level];
              const LevelIcon = level === 'general_administration'
                ? Landmark
                : level === 'subteam'
                  ? GitBranch
                  : level === 'team'
                    ? Users
                    : Building2;
              const levelLabel = (locale === 'en' ? ORG_NODE_LEVEL_LABELS_EN[level] : ORG_NODE_LEVEL_LABELS_AR[level]);
              const members = membersOf(node.id);
              const rosterOpen = openRosters.has(node.id) && members.length > 0;
              const parentPos = parentId ? positionsById.get(parentId) : null;
              // Emerge from (and absorb into) the parent card's center.
              const emerge = parentPos
                ? { xOff: parentPos.xOff, y: parentPos.y + parentPos.h / 2 - NODE_H / 2 }
                : { xOff: xOff(x), y: y - 14 };

              return (
                <motion.div
                  key={node.id}
                  custom={emerge}
                  initial="emerge"
                  animate="idle"
                  exit="emerge"
                  variants={{
                    emerge: (c: { xOff: number; y: number }) => ({
                      x: c.xOff,
                      y: c.y,
                      scale: 0.45,
                      opacity: 0,
                      transition: { duration: 0.26, ease: [0.4, 0, 0.2, 1] },
                    }),
                    idle: {
                      x: xOff(x),
                      y,
                      scale: 1,
                      opacity: 1,
                      transition: { type: 'spring', stiffness: 320, damping: 30 },
                    },
                  }}
                  className={cn(
                    'absolute top-0 rounded-xl border px-3 py-2 shadow-sm',
                    style,
                    isSelected ? 'ring-2 ring-brand-500/70 border-brand-500/50' : '',
                  )}
                  style={{
                    right: 0,
                    width: NODE_W,
                    zIndex: 10 + depth,
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSelect(node);
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    onNodeAction('details', node);
                  }}
                >
                  <div className="flex items-start gap-2">
                    <LevelIcon className={cn('size-4 mt-0.5 shrink-0', textStyle)} />
                    <div className="min-w-0 flex-1">
                      {/* Long node names truncate at the END (inline-end
                          ellipsis — natural for Arabic RTL and English
                          LTR alike); the full name stays reachable via
                          the title tooltip / double-click details.
                          min-w-0 lets the column shrink so the
                          collapse/roster buttons can never be pushed
                          out of the card. */}
                      <p className="text-xs font-bold text-slate-100 truncate min-w-0" title={node.name}>{node.name}</p>
                      <p className={cn('text-[9px] font-semibold mt-0.5', textStyle)}>{levelLabel}</p>
                      <p className="text-[9px] text-slate-500 mt-0.5 flex items-center gap-1 min-w-0">
                        <Users className="size-2.5 shrink-0" />
                        <span className="shrink-0">{node.subtreeEmployeeCount} {t('org.tree.employees')}</span>
                        {node.managerUserName ? (
                          <span className="truncate min-w-0" title={`${t('org.tree.manager')}: ${node.managerUserName}`}>· {node.managerUserName}</span>
                        ) : null}
                      </p>
                    </div>
                    <div className="flex flex-col items-center gap-1 shrink-0">
                      {node.children.length > 0 && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleCollapse(node.id);
                          }}
                          aria-label={isCollapsed ? t('org.tree.expand') : t('org.tree.collapse')}
                          className="shrink-0 size-5 flex items-center justify-center rounded-md bg-slate-900/70 border border-slate-700/60 text-slate-400 hover:text-white"
                        >
                          <ChevronLeft className={cn('size-3 transition-transform duration-200', isCollapsed ? '-rotate-90' : 'rotate-0')} />
                        </button>
                      )}
                      {members.length > 0 && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleRoster(node.id);
                          }}
                          aria-label={rosterOpen ? t('org.tree.hideEmployees') : t('org.tree.showEmployees')}
                          aria-expanded={rosterOpen}
                          title={t('org.tree.showEmployees')}
                          className={cn(
                            'shrink-0 size-5 flex items-center justify-center rounded-md border transition-colors',
                            rosterOpen
                              ? 'bg-brand-500/20 border-brand-500/40 text-brand-300'
                              : 'bg-slate-900/70 border-slate-700/60 text-slate-400 hover:text-white',
                          )}
                        >
                          <Users className="size-2.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* ── Member roster — unfolds from inside the card.
                          ALL direct members are listed; the panel keeps
                          a compact 4-row height and scrolls for the rest
                          (§ROSTER-SCROLL). data-no-i18n sits on each
                          member NAME only (user data the runtime
                          translator must never touch) — the scroll note
                          below is application UI and stays translatable. ── */}
                  <AnimatePresence initial={false}>
                    {rosterOpen && (
                      <motion.div
                        key="roster"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1, transition: { duration: 0.26, ease: [0.22, 1, 0.36, 1] } }}
                        exit={{ height: 0, opacity: 0, transition: { duration: 0.18, ease: 'easeIn' } }}
                        className="overflow-hidden"
                      >
                        <div className="mt-2 pt-2 border-t border-slate-700/40">
                          <div
                            className="arm-scroll space-y-1 overflow-y-auto"
                            style={{ maxHeight: ROSTER_MAX_ROWS * ROSTER_ROW }}
                          >
                            {members.map((member) => (
                              <div
                                key={member.id}
                                className="flex items-center gap-1.5 min-w-0"
                              >
                                <span className="shrink-0 size-4 rounded-full bg-slate-700/80 border border-slate-600/60 grid place-items-center text-[7px] font-bold text-slate-300">
                                  {(member.name ?? t('org.tree.unknownInitial')).trim().charAt(0)}
                                </span>
                                <span
                                  className="text-[10px] text-slate-300 truncate flex-1"
                                  data-no-i18n
                                  title={member.name ?? undefined}
                                >
                                  {member.name ?? '—'}
                                </span>
                                {member.code && (
                                  <span className="text-[8px] font-mono text-slate-500 shrink-0">{member.code}</span>
                                )}
                              </div>
                            ))}
                          </div>
                          {members.length > ROSTER_MAX_ROWS && (
                            <p className="text-[8px] text-slate-500 pt-1">
                              {members.length} {t('org.tree.employees')} — {t('org.tree.rosterMore')}
                            </p>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>

        {/* Legend — semantic LEVELS (label + icon + color together) */}
        <div className="absolute bottom-2 end-2 flex items-center gap-2 rounded-lg bg-slate-900/80 border border-slate-700/50 px-2.5 py-1.5 text-[9px] text-slate-400 backdrop-blur flex-wrap">
          <span className="flex items-center gap-1"><Landmark className="size-2.5 text-violet-300" />{ORG_NODE_LEVEL_LABELS_AR.general_administration}</span>
          <span className="flex items-center gap-1"><span className="size-2 rounded-sm bg-brand-500/60" />{ORG_NODE_LEVEL_LABELS_AR.company}</span>
          <span className="flex items-center gap-1"><span className="size-2 rounded-sm bg-blue-500/60" />{ORG_NODE_LEVEL_LABELS_AR.department}</span>
          <span className="flex items-center gap-1"><Users className="size-2.5 text-emerald-300" />{ORG_NODE_LEVEL_LABELS_AR.team}</span>
          <span className="flex items-center gap-1"><GitBranch className="size-2.5 text-cyan-300" />{ORG_NODE_LEVEL_LABELS_AR.subteam}</span>
        </div>
      </div>
    </div>
  );
}

export default OrgTreeWorkspace;
