# Indexed Queries — Phase 2 Investigation (QNALYS Phase 1, Task F)

**Status: INVESTIGATION ONLY.** No schema migration, no record moves, no rules
deployment, and no data-access-path replacement were performed in Phase 1.
This document is the prioritized input for a future indexed-query phase.

---

## 1. Current state (verified in code)

- **Structure**: one flat RTDB root — `arm_erp/<table>/<recordId>` (see
  `src/lib/db.ts`). Every "query" in the app is a full-node `.get()` of one
  table, filtered **in memory** (loaders in `src/lib/performance-intelligence/loaders.ts`,
  `src/lib/kpi-reporting/loaders.ts`, scope filtering in `src/lib/scope/server.ts`).
- **Rules**: `database.rules.json` contains **zero `.indexOn` entries** — no
  query currently deployable could use an index.
- **Indexed attempts already in code**:
  - `findUserByEmail` (src/lib/db.ts) tries `orderByChild('email').equalTo()`
    with a hard timeout + transparent full-scan fallback + circuit breaker,
    because **indexed `orderByChild` queries were observed to hang indefinitely
    on this network** (documented at `src/lib/db.ts:236-243` and
    `src/app/api/follow-ups/route.ts:62-65`).
  - `revokeAllUserRefreshTokens` (src/lib/auth.ts:240) runs an UNGUARDED
    `orderByChild('userId')` on `sessions` — same hang exposure, low frequency
    (password change only).
- **Mitigations already shipped in Phase 1** (independent of indexes):
  lib/db TTL cache, §SINGLE-FLIGHT in-flight dedup, request-scoped §HR-LOOKUP,
  and §GROUP-SCALING batched loaders. These cut the *frequency* of full-table
  downloads; the *per-download cost* (whole table over the wire) is what an
  indexed phase would address.

## 2. Most expensive full-table reads (growth risk ordered)

| Priority | Table | Read paths | Growth profile |
|---|---|---|---|
| P1 | `attendanceResults` | monthly regeneration, hub datasets, benchmarks, employee performance | one row per employee **per month** — grows linearly with workforce×time |
| P1 | `qualityObservations` | KPI engine, observations loader, month reports, smart report | per-observation rows; the largest quality volume |
| P1 | `followUps` / `travelDeals` | performance intelligence, follow-ups route (full-node `.get()` per request) | per-action rows, append-heavy |
| P2 | `hrDeductions` | hub HR blocks (now via §HR-LOOKUP), HR reports | moderate volume; full-table read is already request-scoped |
| P2 | `complaints` / `capaCases` | operations analysis, complaints pages | moderate volume |
| P2 | `notifications` | polling (list/stats/unseen) | high write+read churn; bounded today by the 30s §DOWNLOAD-OPT TTL |
| P3 | `users` (login) | `findUserByEmail` fallback scan | grows with headcount only; breaker already limits damage |
| P3 | `employmentEvents`, `kpiSchemes`, `kpiSchemeOverrides` | engine loaders | small, slow-growing |
| — | `monthSnapshots` | keyed by month id (`getById`) | already effectively indexed by its natural key |

## 3. Recommended indexes (rules-only, additive, zero migration)

RTDB `.indexOn` entries are **inert until a query adopts them** — adding the
rules cannot change any existing read's behavior. Deploy order:

```json
{
  "rules": {
    ".read": false,
    ".write": false,
    "erp": { "notifications": { ".read": false, ".write": false } },
    "arm_erp": {
      ".read": false,
      ".write": false,
      "users":              { ".indexOn": ["email"] },
      "sessions":           { ".indexOn": ["userId"] },
      "attendanceResults":  { ".indexOn": ["employeeId", "month"] },
      "qualityObservations":{ ".indexOn": ["employeeId", "month"] },
      "followUps":          { ".indexOn": ["employeeId"] },
      "travelDeals":        { ".indexOn": ["employeeId"] },
      "hrDeductions":       { ".indexOn": ["employeeId", "month"] },
      "complaints":         { ".indexOn": ["employeeId"] },
      "capaCases":          { ".indexOn": ["employeeId", "relatedEmployeeIds"] },
      "notifications":      { ".indexOn": ["userId", "createdAt"] }
    }
  }
}
```

Notes:
- RTDB supports **one `orderByChild` per query** (no composites). The two-field
  entries let each query pick its dimension; the second field is refined
  in memory exactly as today.
- `capaCases.relatedEmployeeIds` is an array field — RTDB indexes each array
  member, enabling `orderByChild('relatedEmployeeIds').equalTo(empId)` for the
  indirect-CAPA split.
- Priority order when adopting queries: (1) `users.email` (the code already
  contains the query — the rules deploy alone unlocks it), (2) `sessions.userId`,
  (3) `attendanceResults.employeeId+month`, (4) the per-employee operational
  tables.

## 4. Compatibility & migration risks

1. **The documented hang is the gating risk.** Any indexed query must ship
   with the `raceWithTimeout` + full-scan fallback + breaker pattern
   (`findUserByEmail` is the in-repo precedent). An indexed query adopted
   without the cap can hang a route indefinitely on this network.
2. **Rules deployment touches production configuration** (Firebase Console or
   rules file deploy) — explicitly out of Phase 1 scope; requires owner
   sign-off and a verification step (query + fallback both exercised).
3. **Authorization must stay in memory.** Indexed/narrowed fetches change I/O
   cost only — the M0.5 scope doctrine (server-side filtering on stored
   `employeeId` before serialization) must be preserved; an indexed fetch must
   never be treated as an authorization boundary.
4. **Do NOT restructure collections in the same phase as rules.** The deeper
   option — per-employee subcollections
   (`arm_erp/attendanceByEmployee/<employeeId>/<month>`) — would bound reads
   to one employee's partition but requires dual-write + backfill +
   reconciliation (drift risk between old/new sources of truth). Recommend
   deferring behind an explicit migration plan with a read-comparison
   verification script; treat as a separate phase.
5. **Snapshot tables stay as-is.** `monthSnapshots` is keyed by month (natural
   index) and `getById` already reads one document.

## 5. Prioritized next-phase plan (recommended)

| Step | Action | Prereq | Expected effect |
|---|---|---|---|
| 1 | Deploy the `.indexOn` rules above (no query changes) | owner approval, rules deploy | inert; unlocks steps 2+ |
| 2 | `findUserByEmail` indexed path becomes primary (fallback + breaker already in place) | step 1 | login latency drops from full-scan (~17s cold, documented) to one indexed point query |
| 3 | Guard `revokeAllUserRefreshTokens` with the same timeout+fallback | none | removes an unguarded hang |
| 4 | Attendance results by employeeId+month in the monthly regeneration path | steps 1+2 verified stable | bounded regeneration reads |
| 5 | Per-employee operational reads behind timeout-capped indexed queries with scan fallback (quality/followUps/deals/HR) | steps 1-4 stable | bounded per-employee report I/O |
| 6 | (Separate phase, own plan) per-employee subcollections + backfill | steps 1-5 measured | removes full-table downloads entirely |
