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
  → src/lib/db.ts                       (data access + in-memory cache)
  → src/lib/kpi-scoring/score-calculator.ts  (single scoring formula)
  → src/lib/metrics/kpiMetrics.ts       (score, snapshot, trend, aggregation)
  → src/lib/month-snapshots.ts          (close/reopen lifecycle)
  → src/lib/kpi-dashboard/index.ts      (aggregation + filtering)
  → src/app/api/*                       (thin HTTP routes)
  → UI components                       (display only — never recompute)
```

Quality observations are the **canonical source** of every KPI, monthly score,
trend, and dashboard metric. Only **approved** observations with
`applyPointDeduction = true` affect scores. Pending and rejected observations
have zero KPI impact.

**No module outside `src/lib/metrics/` or `src/lib/kpi-scoring/` may define a
KPI score, formula, or trend direction.**

### Canonical Source

`src/lib/metrics/kpiMetrics.ts` — single source of truth. All API routes
consume from this layer; all UI components display only.

### Score Formula (config-driven)

```
effectiveBonus = allowBonus ? min(rawBonus, maximumBonus) : 0
score = clamp(defaultScore − deductionPoints + effectiveBonus, minimumScore, ∞)
```

The single scoring formula lives in `src/lib/kpi-scoring/score-calculator.ts`:
`computeScoreFromAdjustments(input: ScoreInput): ScoreResult`. The KPI
engine delegates to it. No other scoring function exists.

| Setting          | Default | Description                                  |
|------------------|---------|----------------------------------------------|
| `defaultScore`   | 100     | Starting score for every employee            |
| `minimumScore`   | 0       | Floor — score never goes below this          |
| `allowBonus`     | true    | Gate — when false, bonuses are ignored       |
| `maximumBonus`   | 20      | Cap on total bonus points added              |
| `approvalRequired` | true  | Deductions need manager approval to score    |
| `closeMonthLock` | true    | Locks observations in closed months          |
| `trendCalculation` | rollingAverage | Algorithm for trend direction          |
| `leaderboardEnabled` | true | Show leaderboard on dashboard              |

All settings live in the `kpiSettings/singleton` document. Future business-rule
changes need no code edit — they're config-driven.

### Eligibility

An observation is **eligible for KPI scoring** when ALL of:
- `applyPointDeduction === true`
- `approvalStatus === 'approved'`

Predicates in `kpiMetrics.ts`:
| Predicate | Condition | KPI Impact |
|-----------|-----------|------------|
| `isApprovedKpiObs` | `applyPointDeduction && approvalStatus === 'approved'` | Affects score |
| `isEffectiveDeductionObs` | approved AND `!isBonus` | Deduction applied |
| `isEffectiveBonusObs` | approved AND `isBonus` | Bonus applied |
| `isPendingApprovalObs` | `applyPointDeduction && approvalStatus === 'pending'` | Counted in stats, not score |
| `isRejectedObs` | `applyPointDeduction && approvalStatus === 'rejected'` | Counted in stats, not score |

### Weighted Analytics

| Points type | Used for | Stored as |
|-------------|----------|-----------|
| Raw points (`points`) | Current score calculation | `deductionPoints`, `bonusPoints` in `EmployeeScoreEntry` |
| Weighted points (`points × categoryWeight`) | Future analytics only | `weightedPoints` in `EmployeeScoreEntry` |

The current formula uses **raw points only**. Weighted points are captured
and stored for forward compatibility with future weighted analytics engines.
`categoryTotals: Record<categoryId, deductionPoints>` stores per-category raw
totals.

### Score Bands (display)

| Band   | Score | Color   |
|--------|-------|---------|
| High   | ≥90   | emerald |
| Good   | ≥75   | blue    |
| Medium | ≥50   | amber   |
| Low    | <50   | rose    |

### Monthly Snapshots

#### Open Month (live preview)
- No snapshot document exists in the database.
- `/api/month-snapshots/{monthKey}` computes a **live preview** using the
  canonical KPI engine. This preview is **not persisted** — it's transient.
- Dashboard uses live computation for the current calendar month.
- Employee 360 shows this as "مباشر" (live) badge.

#### Closed Month (frozen immutable snapshot)
- Closing a month produces an **immutable** snapshot that freezes:
  - **Employee scores, ranks, deductions, bonuses** — per employee
  - **Employee metadata** (name, department, position, supervisor) — so later
    transfers/promotions/renames never mutate closed months
  - **The KPI settings** used to compute (`settingsSnapshot`)
  - **Department aggregates** (avgScore, totals)
  - **Category totals**, **approval stats**
  - **Top/Bottom leaderboards** (10 each)
- Snapshots are **never recomputed**. The dashboard reads precomputed snapshots;
  only the current open month is live-computed.
- Frozen data is served verbatim — no queries to current employee metadata.

#### Snapshot History (append-only archive)
When a closed month is reopened and then re-closed, the previous frozen version
is archived in `snapshotHistory[]` (append-only). Each entry preserves the
full frozen state including scores, metadata, settings, and timestamps.

#### `buildLivePreview` — open-month transient view. Not persisted.
#### `buildClosedSnapshot` — first close of a month. Appends `close` audit event.
#### `buildReopenedSnapshot` — flips status to `open`. Increments `reopenCount`.
  Stores `reopenReason`. Preserves all frozen scores.
#### `buildReclosedSnapshot` — re-close after reopen. Archives previous
  version into `snapshotHistory`. Appends `reclose` audit event.

### Close / Reopen Lifecycle

| Operation | Behavior | Idempotent | Audited |
|-----------|----------|------------|---------|
| **Close Month** | Computes fresh snapshot, persists, returns frozen | ✓ (returns existing if already closed) | ✓ (`close_month` on first close only) |
| **Reopen** | Flips status to `open`, stores reason | ✓ (returns existing if already open) | ✓ (`reopen` event) |
| **Re-close** | Archives previous version, computes new, persists | Same as Close | ✓ (`reclose` event) |

- **Reopen never deletes** the frozen snapshot — only `status` flips.
- Previous frozen state remains **recoverable** via `snapshotHistory`.
- New settings snapshot is captured on each close.
- No duplicate audit/notification on idempotent repeated operations.

### Trend

Supported trend modes (per `settings.trendCalculation`):

| Mode | Algorithm | Threshold |
|------|-----------|-----------|
| `rollingAverage` (default) | Deviation of latest vs rolling mean | ±3 points |
| `movingScore` | Month-over-month delta | ±3 points |
| `simpleAverage` | Month-over-month delta | ±2 points |

```
direction      = improving | stable | declining
momDelta       = latest month avg − previous month avg
rollingAverage = mean across all supplied snapshots
movingScore    = latest month's average score
sampleSize     = number of snapshots in the input
```

**Stored-snapshot rule**: Trend uses **stored snapshots only** — never live
recalculation. This ensures historical trend data is immutable and consistent.

### Dashboard (`/api/kpi-dashboard`)

| Scope | Data source |
|-------|-------------|
| **Current month** | Live computation via canonical engine |
| **Historical months** | Frozen snapshots (never recomputed) |
| **Custom range** | Aggregation of stored snapshots + current live month |
| **Employee-scoped** | `filterSnapshot` narrows `employeeScores` per employeeId |

Dashboard response (`KpiDashboardResponse`):
- `avgScore`, `totalEmployees`, `totalDeductions`, `totalBonuses`
- `trend: TrendResult`
- `topEmployees`, `bottomEmployees` (leaderboard)
- `pendingApprovals`, `approvalStats`
- `categoryDistribution`, `departmentRanking`
- `monthlyScores[]` (per-month avgScore, isLive flag)
- `performanceFactor: PerformanceFactor`
- `settings` (current, not frozen)

### Approval Workflow (append-only history)

```
Quality creates observation (approvalStatus: pending)
  → Manager approves /rejects (approvalStatus: approved | rejected)
  → Only approved observations with applyPointDeduction=true affect score
```

Approval history is **append-only** (`approvalHistory[]`). The latest entry is
projected to `approvalStatus` for fast queries. Nothing is ever overwritten.

Point override during approval: the approver may set a `points` override. The
original and override values are captured as `pointsBefore`/`pointsAfter` in
the approval event (action becomes `override` for audit clarity).

### Employee 360 Quality & KPI Integration (Milestone 9)

The `EmployeeQualityKpiPanel` is a self-contained React Query component that
consumes canonical APIs only:

| Data | API Hook | Behavior |
|------|----------|----------|
| Current month score | `useKpiDashboard({range:'current_month', employeeId})` | Live computation |
| Monthly history | `useMonthSnapshots()` + `useMonthSnapshot(monthKey)` per row | Frozen/live per snapshot status |
| Observations | `useObservations({employeeId, month})` | Filtered by month |
| Categories | `useObservationCategories()` | Name lookup |
| Timeline | `buildTimeline(obs.auditLog, obs.approvalHistory)` + `<TimelineView>` | Pure library + shared component |

**Identity key**: `employeeId` (canonical). Employee name, email, mobile, code
are display/search identifiers only.

**Closed-month integrity**: Historical Employee 360 always displays the
original frozen snapshot. Even if employee department/position/name changes,
KPI settings change, category configuration changes, or new observations are
created in later months, the frozen score and metadata are unchanged.

**Live vs frozen distinction**: The UI shows "مباشر" (live) badge for
current/open months and "مجمّد" (frozen) badge for closed months.

### Migration (`src/lib/quality-migration/`)

| Feature | Description |
|---------|-------------|
| **Source** | Legacy `qualityDeductions` table |
| **Target** | Canonical `qualityObservations` table |
| **Migration marker** | `clientRequestId` prefixed with `legacy_quality_migration:` for idempotent detection |
| **Legacy marker** | Recognises `createdByName === '__system_migration__'` with `[source:<id>]` in notes |
| **Idempotency** | Both markers checked before creating; re-runs skip already-migrated records |
| **Legacy preservation** | Migration never deletes or modifies legacy records |
| **Permission** | Admin-only (`/api/quality-observations/migrate`) |

### PerformanceFactor Adapter

`qualityToPerformanceFactor(scoreResult, maxScore)` converts a quality score
into the `PerformanceFactor` interface — the shared contract for a future
unified Performance Engine (Attendance, Sales, Productivity, etc.).

```typescript
PerformanceFactor {
  factorId: string;      // 'quality'
  factorName: string;   // 'Quality KPI'
  score: number;         // the employee's quality score
  maxScore: number;      // defaultScore
  weight: number;        // 1.0 (configurable per factor in future)
  normalized: number;     // score / maxScore (0–1)
  breakdown?: Record<string, number>;  // future per-category detail
}
```

### Idempotency & Data Integrity

- **Close Month**: idempotent (returns existing frozen snapshot unchanged)
- **Reopen**: reversible (never deletes the frozen snapshot)
- **Re-close**: archives previous version, computes fresh
- **Observation creation**: dedup via `clientRequestId`
- **Approval**: idempotent on already-approved/rejected (returns existing)
- **FK validation**: employee/category existence checked before every write
- **Server-authoritative**: names, departments, scores always recomputed server-side
- **Closed-month lock**: mutations blocked when `closeMonthLock` is enabled

### Consumers

- **KPI Dashboard** (`/api/kpi-dashboard`) — aggregated scores, trend, leaderboard, department ranking
- **Observations** (`/api/quality-observations`) — CRUD + approve/reject
- **Month Snapshots** (`/api/month-snapshots`) — close/reopen, detail views
- **Employee 360** — quality tab with monthly history, frozen scores, timeline (Milestone 9)
- **Audit Log** (`/api/quality-audit-log`) — global queryable trail
- **Migration** (`/api/quality-observations/migrate`) — admin one-time import from legacy `qualityDeductions`

### Permission Model

| Role | Create | Update | Delete | Approve | Close/Reopen | Settings | Audit |
|------|--------|--------|--------|---------|---------------|----------|-------|
| **Admin** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Manager** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Quality** | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✓ |
| **HR** | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |

`verifyPermission(request, pageId, action)` enforces server-side. Client-side
`usePermissions(pageId)` gates UI visibility.

---

## 8. Tests

Run: `npm test` (uses `tsx --test`)

```
src/lib/__tests__/
├── approvals/approval-history.test.ts     — approval workflow tests
├── audit/timeline-builder.test.ts        — timeline ordering, labels
├── idempotency/idempotency.test.ts      — dedup logic
├── kpi-dashboard/kpi-dashboard.test.ts  — dashboard aggregation
├── kpi-scoring/score-calculator.test.ts — scoring formula unit tests
├── metrics/
│   ├── riskMetrics.test.ts               — 20 tests (formula, caps, levels)
│   ├── followUpMetrics.test.ts           — 14 tests (overdue, status)
│   ├── capaMetrics.test.ts               — 22 tests (SLA, effectiveness)
│   ├── kpiMetrics.test.ts                — 56 tests (score, snapshots, trend)
│   └── milestone-9-verification.test.ts   — 18 tests (M9 parity, immutability, reopen)
├── month-snapshots/month-snapshots.test.ts — close/reopen lifecycle
├── quality-migration/quality-migration.test.ts — migration tests
└── quality-obs/observation-api.test.ts    — observation API tests
```

Total: **364 tests** (346 existing + 18 new Milestone 9). One pre-existing
failure in `quality-migration.test.ts` (outside Milestone 9 scope).

---

## 9. Remaining Risks (documented, NOT fixed this sprint)

| Risk | Impact | Why deferred |
|------|--------|-------------|
| `CAPAPage.tsx` client-side `stats` memo | Large refactor; CAPA table is empty today | No visible impact |
| Timezone centralization | Needs deployment-target decision | Architecture decision |
| 8 duplicate attendance records | Data issue, needs business review | Not a code fix |
| `capaCases` table empty | Data/seed issue | No code change needed |
| `capa-helpers.ts` client-side `isOverdue()` | Uses `Date.now()` instead of server canonical | Out of scope; UI-only |
| Concurrent close race | Two simultaneous closes on an open month could both compute | Idempotent guard makes this safe; documented in M5 report |
| Supervisor map | Currently empty (null) for all employees | No supervisor hierarchy data yet |
