// ══════════════════════════════════════════════════════════════
//  Generic audit primitive — type definitions
//
//  Domain-agnostic audit/timeline types owned by the audit library.
//  The audit library is fully independent of every other module — it
//  depends on NO domain type and on the approvals library only via a
//  structural type (TimelineApprovalEvent), so it can be consumed by
//  Attendance, Sales, HR, CAPA, Workflow and any future module.
//
//  This file imports nothing from any domain — it is the root of the
//  audit dependency tree.
// ══════════════════════════════════════════════════════════════

/**
 * A generic chronological change event. Any module that keeps a
 * per-record change trail appends entries shaped like this.
 *
 * @property action    - Short machine key describing the action (e.g. 'create', 'update').
 * @property actorId   - Stable identifier of the user who performed the action.
 * @property actorName - Display name of the actor (snapshot for history readability).
 * @property timestamp - ISO 8601 timestamp issued by the server.
 * @property details   - Human-readable description of the change.
 */
export interface AuditEvent {
  action: string;
  actorId: string;
  actorName: string;
  /** ISO 8601 timestamp issued by the server. */
  timestamp: string;
  details: string;
}

/**
 * Semantic tone for a timeline point. This drives purely
 * presentational concerns (icon/color) in the UI timeline component;
 * it carries no business meaning.
 */
export type TimelineTone = 'neutral' | 'positive' | 'negative' | 'pending';

/**
 * A single point on a derived timeline. Timeline points are NEVER a
 * stored field — they are always produced on demand by
 * {@link buildTimeline} from audit and approval histories.
 *
 * @property key        - Stable unique key for list rendering.
 * @property label      - Human-readable label for the action (often localized).
 * @property timestamp  - ISO 8601 timestamp of the source event.
 * @property actorName  - Display name of the actor.
 * @property details    - Human-readable description (notes or audit details).
 * @property tone       - Semantic tone for presentation only.
 */
export interface TimelinePoint {
  key: string;
  label: string;
  /** ISO 8601 timestamp of the source event. */
  timestamp: string;
  actorName: string;
  details: string;
  /** Semantic tone for presentation (drives icon/color, not logic). */
  tone: TimelineTone;
}

/**
 * The structural slice of an approval event that the timeline builder
 * needs. Kept intentionally structural (not imported from the
 * approvals library) so the audit library has ZERO hard dependency on
 * approvals — any object with these four fields satisfies it.
 *
 * @property action    - The approval action key (e.g. 'approve').
 * @property actorId   - Stable identifier of the actor.
 * @property actorName - Display name of the actor.
 * @property timestamp - ISO 8601 timestamp.
 * @property notes     - Free-text note (may be empty).
 */
export interface TimelineApprovalEvent {
  action: string;
  actorId: string;
  actorName: string;
  timestamp: string;
  notes: string;
}

/**
 * The magnitude of an entity type, expressed as a plain string so the
 * audit library never owns any module's entity vocabulary. Callers
 * pass their own literal (e.g. 'observation', 'request', 'capa').
 */
export type AuditEntityType = string;
