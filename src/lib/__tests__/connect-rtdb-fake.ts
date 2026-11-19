// src/lib/__tests__/connect-rtdb-fake.ts
// ══════════════════════════════════════════════════════════════
//  In-memory RTDB fake for the Connect test suites.
//
//  Implements EXACTLY the Admin-SDK surface lib/connect/rtdb.ts uses:
//    ref(path).get() / .set() / .update(multiPathMap) / .remove()
//    ref(path).push() → { key }
//    ref(path).transaction(fn) → { committed, snapshot }
//    ref(path).orderByKey()|orderByChild(f)
//           .startAt(v).endAt(v).limitToFirst(n).limitToLast(n).get()
//
//  FIDELITY NOTES (what the tests rely on):
//    • update() is ATOMIC over the whole map, shallow per path, and
//      a null value deletes the target — the §RTDB-PATCH-SEMANTICS
//      the real SDK guarantees.
//    • transaction() serializes per path through a promise chain —
//      concurrent same-path transactions behave like the real SDK
//      (the second application sees the first's committed value);
//      fn returning undefined ABORTS.
//    • push keys are time-ordered lexicographically (monotonic
//      generator with a bumped-timestamp guard, mirroring the real
//      collision behavior). Ordering-by-key therefore matches
//      creation order exactly — the property §ORDERING stands on.
//    • Queries materialize children sorted by the chosen order.
// ══════════════════════════════════════════════════════════════

export interface FakeSnapshot {
  exists(): boolean;
  val(): unknown;
  key: string | null;
  forEach(cb: (child: { key: string; val: () => unknown }) => boolean | void): void;
}

/** A tree node: any object-shaped value (children accessed by key). */
interface TreeNode {
  [key: string]: unknown;
}

export class FakeRtdb {
  private root: TreeNode = {};
  private lastPushMs = 0;
  private pushCounter = 0;
  private txQueues = new Map<string, Promise<unknown>>();

  // ─── Path helpers ──────────────────────────────────────────────

  private segments(path: string): string[] {
    return path.split('/').filter((s) => s.length > 0);
  }

  private nodeAt(path: string): { parent: TreeNode | null; key: string | null; value: unknown } {
    const segs = this.segments(path);
    if (segs.length === 0) return { parent: null, key: null, value: this.root };
    let current: TreeNode = this.root;
    for (let i = 0; i < segs.length - 1; i++) {
      const next = current[segs[i]];
      if (next === null || typeof next !== 'object') {
        // Missing intermediate — materialize lazily like the real DB.
        const created: TreeNode = {};
        current[segs[i]] = created;
        current = created;
      } else {
        current = next as TreeNode;
      }
    }
    const key = segs[segs.length - 1];
    const value = current[key];
    return { parent: current, key, value };
  }

  private readValue(path: string): unknown {
    const { value } = this.nodeAt(path);
    return value === undefined ? null : value;
  }

  /** Deep-set a plain value at a path (creates intermediates). */
  private writeValue(path: string, value: unknown): void {
    const { parent, key } = this.nodeAt(path);
    if (!parent || key === null) {
      if (value !== null && value !== undefined && typeof value === 'object' && !Array.isArray(value)) {
        this.root = { ...(value as TreeNode) };
      } else {
        this.root = {} as TreeNode;
      }
      return;
    }
    if (value === null || value === undefined) {
      delete parent[key];
    } else {
      parent[key] = value;
    }
    this.pruneEmptyParents(path);
  }

  /**
   * RTDB prunes EMPTY object nodes (an object with no children is
   * nonexistent). After a delete, empty ancestors vanish too — the
   * fake mirrors this so "node gone" assertions behave like the real
   * database (e.g. an unpinned conversation leaves NO pinned node).
   */
  private pruneEmptyParents(path: string): void {
    const segs = this.segments(path);
    for (let i = segs.length - 1; i >= 1; i--) {
      const parentPath = segs.slice(0, i).join('/');
      const value = this.readValue(parentPath);
      if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) {
        const { parent, key } = this.nodeAt(parentPath);
        if (parent && key !== null) delete parent[key];
      } else {
        break;
      }
    }
  }

  // ─── Push keys (time-ordered, monotonic) ───────────────────────

  private nextPushKey(): string {
    let now = Date.now();
    if (now <= this.lastPushMs) now = this.lastPushMs + 1;
    this.lastPushMs = now;
    this.pushCounter += 1;
    // '-' prefix mirrors real Firebase push keys; timestamp + counter
    // keeps lexicographic order == creation order, always.
    return `-k${now.toString(36)}${this.pushCounter.toString(36).padStart(4, '0')}`;
  }

  // ─── Multi-path update (shallow per path, atomic, null deletes) ─

  private applyUpdate(basePath: string, map: Record<string, unknown>): void {
    // §RTDB-MERGE-PATHS — 1.0.1: the fake now mirrors the REAL SDK's
    // validateFirebaseMergePaths: an update map must NOT contain a
    // path that is an ancestor of another path in the same map
    // (client-side rejection BEFORE any write — exactly the production
    // 500 that 1.0 shipped with, hidden by the previous lenient fake).
    const entries = Object.entries(map);
    // Snapshot-then-swap: the whole map applies atomically.
    const operations: { path: string; value: unknown }[] = entries.map(([rel, value]) => {
      const cleanBase = basePath.replace(/\/+$/, '');
      const cleanRel = rel.replace(/^\/+/, '');
      const full = cleanRel.length > 0 ? `${cleanBase}/${cleanRel}` : cleanBase;
      return { path: full, value };
    });
    const segmentsOf = (p: string) => p.split('/').filter((s) => s.length > 0);
    for (let i = 0; i < operations.length; i++) {
      for (let j = i + 1; j < operations.length; j++) {
        const a = segmentsOf(operations[i]!.path);
        const b = segmentsOf(operations[j]!.path);
        const shorter = Math.min(a.length, b.length);
        if (shorter === 0) continue;
        let isPrefix = true;
        for (let k = 0; k < shorter; k++) {
          if (a[k] !== b[k]) { isPrefix = false; break; }
        }
        if (isPrefix && a.length !== b.length) {
          throw new Error(
            `update failed: values argument contains a path /${a.join('/')} that is ancestor of another path /${b.join('/')}`,
          );
        }
      }
    }
    for (const op of operations) {
      this.writeValue(op.path, op.value);
    }
  }

  // ─── Query ─────────────────────────────────────────────────────

  private childEntries(path: string): { key: string; value: unknown }[] {
    const value = this.readValue(path);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    return Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== null && v !== undefined)
      .map(([key, v]) => ({ key, value: v }));
  }

  makeSnapshot(value: unknown, key: string | null = null, children?: { key: string; value: unknown }[]): FakeSnapshot {
    const snap: FakeSnapshot = {
      exists: () => value !== null && value !== undefined,
      val: () => value,
      key,
      forEach(cb) {
        const entries = children ?? (value && typeof value === 'object' && !Array.isArray(value)
          ? Object.entries(value as Record<string, unknown>).map(([k, v]) => ({ key: k, value: v }))
          : []);
        for (const entry of entries) {
          if (cb({ key: entry.key, val: () => entry.value }) === true) break;
        }
      },
    };
    return snap;
  }

  // ─── Reference facade ──────────────────────────────────────────

  ref(path: string) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const db = this;
    const base = path.replace(/^\/+|\/+$/g, '');

    const reference = {
      toString() { return base; },

      async get(): Promise<FakeSnapshot> {
        return db.makeSnapshot(db.readValue(base));
      },

      async set(value: unknown): Promise<void> {
        db.writeValue(base, value);
      },

      async update(map: Record<string, unknown>): Promise<void> {
        db.applyUpdate(base, map);
      },

      async remove(): Promise<void> {
        db.writeValue(base, null);
      },

      push(): { key: string } {
        return { key: db.nextPushKey() };
      },

      async transaction<T>(
        fn: (current: T | null) => T | undefined | null,
      ): Promise<{ committed: boolean; snapshot: FakeSnapshot }> {
        // Serialize transactions per path (real SDK semantics).
        const prev = db.txQueues.get(base) ?? Promise.resolve();
        const run = prev.then(async () => {
          const current = db.readValue(base) as T | null;
          const next = fn(current ?? null);
          if (next === undefined) {
            return { committed: false, snapshot: db.makeSnapshot(db.readValue(base)) };
          }
          db.writeValue(base, next);
          return { committed: true, snapshot: db.makeSnapshot(db.readValue(base)) };
        });
        db.txQueues.set(base, run.catch(() => undefined));
        return run;
      },

      // ─── Query builder (fluent, like the Admin SDK) ───
      orderByKey() { return db.queryBuilder(base, 'key'); },
      orderByChild(child: string) { return db.queryBuilder(base, { child }); },
    };

    return reference;
  }

  private queryBuilder(
    base: string,
    orderBy: 'key' | { child: string },
  ) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const db = this;
    let startAt: string | number | null = null;
    let endAt: string | number | null = null;
    let limitFirst: number | null = null;
    let limitLast: number | null = null;

    const builder = {
      startAt(v: string | number) { startAt = v; return builder; },
      endAt(v: string | number) { endAt = v; return builder; },
      limitToFirst(n: number) { limitFirst = n; return builder; },
      limitToLast(n: number) { limitLast = n; return builder; },
      async get(): Promise<FakeSnapshot> {
        let entries = db.childEntries(base);
        if (orderBy === 'key') {
          entries.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
        } else {
          const field = orderBy.child;
          entries.sort((a, b) => {
            const av = (a.value as Record<string, unknown>)?.[field];
            const bv = (b.value as Record<string, unknown>)?.[field];
            const an = typeof av === 'number' ? av : Number.NEGATIVE_INFINITY;
            const bn = typeof bv === 'number' ? bv : Number.NEGATIVE_INFINITY;
            return an - bn;
          });
        }
        if (startAt !== null) {
          entries = entries.filter((e) => {
            const v = orderBy === 'key' ? e.key : (e.value as Record<string, unknown>)?.[orderBy.child];
            if (typeof v === 'number' && typeof startAt === 'number') return v >= startAt;
            return String(v) >= String(startAt);
          });
        }
        if (endAt !== null) {
          entries = entries.filter((e) => {
            const v = orderBy === 'key' ? e.key : (e.value as Record<string, unknown>)?.[orderBy.child];
            if (typeof v === 'number' && typeof endAt === 'number') return v <= endAt;
            return String(v) <= String(endAt);
          });
        }
        if (limitLast !== null) {
          entries = entries.slice(-limitLast);
        } else if (limitFirst !== null) {
          entries = entries.slice(0, limitFirst);
        }
        return db.makeSnapshot(
          entries.length > 0 ? Object.fromEntries(entries.map((e) => [e.key, e.value])) : null,
          null,
          entries,
        );
      },
    };
    return builder;
  }

  // ─── Test utilities ────────────────────────────────────────────

  /** Dump a path (diagnostics). */
  dump(path: string): unknown {
    return this.readValue(path);
  }

  reset(): void {
    this.root = {};
    this.lastPushMs = 0;
    this.pushCounter = 0;
    this.txQueues.clear();
  }
}

/** Singleton the stubbed getAdminDb serves (shared across a test file). */
export const connectFakeDb = new FakeRtdb();
