# ARM ERP — Canonical Metrics Documentation

> **Single source of truth**: `src/lib/metrics/`
>
> No module outside `src/lib/metrics/` may define a risk score, an overdue rule, an SLA
> window, or an effectiveness percentage. All API routes consume from this layer; all
> UI components display only — they never recompute.

## Architecture

```
Firebase RTDB
  → src/lib/db.ts          (data access + in-memory cache)
  → src/lib/metrics/*       (THIS — canonical calculations)
  → src/app/api/*           (thin HTTP layer, calls metrics)
  → UI components           (display only — never recompute)
```

---

## 1. Risk Scoring (`riskMetrics.ts`)

### Formula

`score = Σ factor(count × weight, cap)`, capped at **100**.

| Factor                   | Weight | Cap  | Input field                   |
|--------------------------|--------|------|-------------------------------|
| Delays (late attendance) | ×1     | 15   | `delayCount`                  |
| Absences                 | ×3     | 30   | `absenceCount`                |
| Quality deductions       | ×5     | 25   | `qualityCount`                |
| HR deductions            | ×5     | 15   | `hrCount`                     |
| Open follow-ups          | ×3     | 15   | `openFollowUpCount`           |
| High-priority follow-ups| ×5     | 25   | `highPriorityFollowUpCount`   |
| Critical follow-ups      | ×10    | 30   | `criticalFollowUpCount`       |
| Open complaints          | ×8     | 20   | `openComplaintCount`          |
| Repeated issues          | ×5     | 15   | `repeatedIssueCount`          |
| Open CAPA                | ×5     | 25   | `openCapaCount`               |
| Overdue CAPA             | ×10    | 30   | `overdueCapaCount`            |
| Critical CAPA            | ×8     | 30   | `criticalCapaCount`           |
| Reopened CAPA            | ×15    | 30   | `reopenedCapaCount`           |

### Risk Levels

| Band      | Score Range | Label (AR) |
|-----------|-------------|-------------|
| Low       | 0–10        | منخفض       |
| Medium    | 11–25       | متوسط       |
| High      | 26–50       | مرتفع       |
| Critical  | 51–100      | حرج         |

### Breakdown Shape

Every consumer receives the same canonical breakdown:

```typescript
{
  score: number;       // 0–100
  level: RiskLevel;    // 'low' | 'medium' | 'high' | 'critical'
  breakdown: {
    delay:              { count: number; points: number };
    absence:            { count: number; points: number };
    quality:            { count: number; points: number };
    hr:                 { count: number; points: number };
    openFollowUp:       { count: number; points: number };
    highPriorityFollowUp: { count: number; points: number };
    criticalFollowUp:   { count: number; points: number };
    complaint:          { count: number; points: number };
    repeatedIssue:      { count: number; points: number };
    openCapa:           { count: number; points: number };
    overdueCapa:        { count: number; points: number };
    criticalCapa:       { count: number; points: number };
    reopenedCapa:       { count: number; points: number };
  }
}
```

### Consumers

- **Risk Center** (`/api/risk-center`) — primary dashboard
- **Employee 360** (`/api/employee-360/[id]`) — individual profile
- **Follow-ups** (`/api/follow-ups`) — employee risk map (follow-up-scoped)

All three call `computeRisk()` — no inline formulas exist elsewhere.

---

## 2. Follow-Up Overdue (`followUpMetrics.ts`)

### Rule (compute-on-read)

A follow-up is **overdue** when ALL of:
1. Status is **active**: `open`, `under_review`, `under_follow_up`
2. `nextFollowUpDate` exists and is a valid date
3. `nextFollowUpDate < startOfDay(now)` (strictly before midnight today)

### Key Functions

- `isOverdueFollowUp(f, now?)` — boolean
- `isActiveFollowUp(f)` — boolean
- `isTerminalFollowUp(f)` — boolean (`resolved`, `closed`, `cancelled`)

### Important Notes

- There is **no `status: 'overdue'`** in the database. The previous code matched
  `status === 'overdue'` which returned 0 results (that status was never written).
  The canonical `isOverdueFollowUp()` identifies overdue records dynamically,
  which surfaced 12 previously-hidden overdue follow-ups.
- Dates are stored as `YYYY-MM-DD` in `nextFollowUpDate`.
- Today's due date is NOT overdue (due < start-of-today fails for equal dates).

### Consumers

- **Home Stats** (`/api/home/stats`) — `followUpsSummary.totalOverdue`
- Follow-up detail views via client-side helpers (out of scope — documented as remaining risk)

---

## 3. CAPA Overdue / SLA (`capaMetrics.ts`)

### SLA Days

| Priority  | SLA (days) |
|-----------|-----------|
| Critical  | 1         |
| High      | 3         |
| Medium    | 7         |
| Low       | 14        |

### Due Date Resolution

```
if correctiveDueDate is set and valid → use it as the due date (NO SLA addition)
else if createdAt is valid          → due = createdAt + slaDays
else                                 → null (cannot determine)
```

**Bug fixed**: The old `capa-sla/route.ts` had a double-SLA bug where
`effectiveDueMs = baseDate + slaDays` was applied even when `correctiveDueDate`
was set, effectively adding SLA twice. The canonical `capaDueDateMs()` fixes this.

### Overdue Rule

A CAPA is **overdue** when ALL of:
1. Status is **active** (not `closed` or `rejected`)
2. `capaDueDateMs()` returns a non-null value
3. `now > capaDueDateMs()`

### Effectiveness

```
calcCAPAEffectiveness(cases) = (effective closed / total closed) × 100
```

Returns a **percentage** (0–100). Open cases are excluded from the denominator.

### Consumers

- **CAPA Cases** (`/api/capa-cases`) — enrichment with overdue days
- **CAPA SLA** (`/api/capa-sla`) — monitoring + notifications
- **Reports CAPA** (`/api/reports/capa`) — summary + department/employee/monthly
- **CAPA Export** (`/api/reports/capa-export`) — dynamic overdue in exports
- **Employee 360** (`/api/employee-360/[id]`) — individual CAPA stats

---

## 4. Attendance Compliance Denominator

**Rule (confirmed by user)**: Working days are throughout the week (Sun–Thu or
Sun–Sat depending on shift). Each employee is entitled to **4 free absence
days per month** (`FREE_ABSENCE_ALLOWANCE = 4`). Absences under 4 per month
count as bonus attendance days, not deductions.

The compliance denominator is the **actual number of distinct working days
observed in attendance records** for the given month — NOT a hardcoded 22.

**Bug fixed**: The old `home/stats/route.ts` had `workingDaysSet.size || 22` which
fabricated "22 working days" when no attendance records existed for a month.
Now: `workingDaysSet.size` (0 means 0 — surfaces the real data gap).

---

## 5. Deduction Rules (canonical, auto-synced)

| Key                  | Amount | Unit   | Condition                    |
|----------------------|--------|--------|------------------------------|
| `late15`             | 0.25   | days   | Late 1–15 minutes            |
| `late30`             | 0.5    | days   | Late 16–30 minutes           |
| `late60`             | 1      | days   | Late 31–60 minutes           |
| `absence`            | 1      | days   | Full absence                 |
| `singleFingerprint`  | 0.5    | days   | Only one fingerprint record  |

**Grace period**: 15 minutes — arrivals within 15 minutes of shift start are
not counted as late.

---

## 6. Timezone Policy

All dates in Firebase RTDB are stored as ISO 8601 strings (`new Date().toISOString()`).
Server-side computations use `new Date()` which is the **server's local timezone**.

**Remaining risk**: No centralized timezone config exists. If the server and users
are in different timezones, overdue calculations may be off by ±1 day. This needs
a deployment-target decision before centralizing.

---

## 7. Quality KPI & Monthly Performance Engine (`kpiMetrics.ts`)

### Architecture

```
qualityObservations (canonical source)
  → src/lib/metrics/kpiMetrics.ts   (score, snapshot, trend, aggregation)
  → src/app/api/*                   (thin HTTP routes)
  → UI components                   (display only)
```

Quality observations are the **canonical source** of every KPI, monthly score,
trend, and dashboard metric. Only **approved** observations with
`applyPointDeduction = true` affect scores. Pending and rejected observations
have zero KPI impact.

### Score Formula (config-driven)

```
score = clamp(defaultScore − deductions + effectiveBonus, minimumScore, ∞)
```

| Setting          | Default | Description                                  |
|------------------|---------|----------------------------------------------|
| `defaultScore`   | 100     | Starting score for every employee            |
| `minimumScore`   | 0       | Floor — score never goes below this          |
| `allowBonus`     | true    | Gate — when false, bonuses are ignored       |
| `maximumBonus`   | 20      | Cap on total bonus points added              |
| `approvalRequired` | true  | Deductions need manager approval to score    |
| `closeMonthLock` | true    | Locks observations in closed months          |
| `trendCalculation` | rollingAverage | Algorithm for trend direction          |

All settings live in the `kpiSettings/singleton` document. Future business-rule
changes need no code edit — they're config-driven.

### Score Bands (display)

| Band   | Score | Color   |
|--------|-------|---------|
| High   | ≥90   | emerald |
| Good   | ≥75   | blue    |
| Medium | ≥50   | amber   |
| Low    | <50   | rose    |

### Monthly Snapshots (Improvement #1 — frozen org state)

Closing a month produces an **immutable** snapshot that freezes:
- Employee scores, ranks, deductions, bonuses
- Employee metadata (name, department, position, supervisor) — so later
  transfers/promotions/rename never mutate closed months
- The KPI settings used to compute (`settingsSnapshot`)

Snapshots are **never recomputed**. The dashboard reads precomputed snapshots;
only the current open month is live-computed. Reopen flips status back to `open`
without deleting the frozen document; a fresh Close regenerates.

### Trend (stored snapshots only)

```
movingScore    = latest month's average score
momDelta       = latest − previous month
rollingAverage = mean across all supplied snapshots
direction      = improving | stable | declining  (algorithm per trendCalculation)
```

Trend uses **stored snapshots only** — never live recalculation.

### Approval Workflow (append-only history)

```
Quality creates observation (status: pending)
  → Manager approves / rejects (status: approved | rejected)
  → Only approved observations affect the score
```

Approval history is **append-only** (`approvalHistory[]`). The latest entry is
projected to `approvalStatus` for fast queries. Nothing is ever overwritten.

### Weighted Categories (Improvement #3)

Each category carries both `defaultPointValue` (used now) and `weight` (stored
as `weightedPoints = Σ points × weight` for future analytics). The current
formula uses points only; weight is captured for forward compatibility.

### Performance Engine Adapter (Improvement #8)

`qualityToPerformanceFactor()` converts a quality score into a
`PerformanceFactor` — the shared interface that a future unified Performance
Engine (Attendance, Productivity, etc.) will consume. Quality is the first
adapter; the interface is generic.

### Idempotency & Data Integrity

- **Close Month**: idempotent (re-closing regenerates the same snapshot)
- **Reopen**: reversible (never deletes the frozen snapshot)
- **Observation creation**: dedup via `clientRequestId`
- **FK validation**: employee/category existence checked before every write
- **Server-authoritative**: names, departments, scores always recomputed server-side

### Consumers

- **KPI Dashboard** (`/api/kpi-dashboard`) — aggregated scores, trend, leaderboard
- **Observations** (`/api/quality-observations`) — CRUD + approve/reject
- **Month Snapshots** (`/api/month-snapshots`) — close/reopen, detail views
- **Employee 360** — quality tab (score card, trend, deductions, bonuses)
- **Audit Log** (`/api/quality-audit-log`) — global queryable trail
- **Migration** (`/api/quality-migration`) — admin one-time import from legacy `qualityDeductions`

---

## 8. Tests

Run: `npm test` (uses `tsx --test`)

```
src/lib/metrics/__tests__/
├── riskMetrics.test.ts     — 20 tests (formula, caps, levels, negative coercion)
├── followUpMetrics.test.ts — 14 tests (overdue on-read, active/terminal status)
├── capaMetrics.test.ts     — 22 tests (SLA, due date, overdue, effectiveness)
└── kpiMetrics.test.ts      — 56 tests (score formula, floors/caps, bonus gating,
                                      approved-only, snapshots, rank, trend, timeline)
```

Total: **112 tests**, all passing.

---

## 9. Remaining Risks (documented, NOT fixed this sprint)

| Risk | Impact | Why deferred |
|------|--------|-------------|
| `CAPAPage.tsx` client-side `stats` memo | Large refactor; CAPA table is empty today | No visible impact |
| Timezone centralization | Needs deployment-target decision | Architecture decision |
| 8 duplicate attendance records | Data issue, needs business review | Not a code fix |
| `capaCases` table empty | Data/seed issue | No code change needed |
| `capa-helpers.ts` client-side `isOverdue()` | Uses `Date.now()` instead of server canonical | Out of scope; UI-only |
