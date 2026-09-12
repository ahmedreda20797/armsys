// ══════════════════════════════════════════════════════════════
//  Unseen / new-item tracking — shared vocabulary (§SIDEBAR-BADGES)
//
//  Per-user "new records added by OTHERS since I last looked" counts
//  for the sidebar. Design goals:
//    • Per-USER state — User A seeing a record never marks it seen
//      for User B (state lives under the viewer's own id).
//    • O(1) storage — one small record per user storing the LAST
//      SEEN timestamp per module, NOT a per-record seen list. "New"
//      = created after your last visit by someone else. Opening the
//      page marks the module seen.
//    • Cheap reads — the summary endpoint reads ONE tiny per-user
//      record + one getAllBatch over already-TTL-cached tables; no
//      full-table scans per user beyond the shared cache.
// ══════════════════════════════════════════════════════════════

/** RTDB table holding per-user seen state (record id = userId). */
export const USER_SEEN_STATE_TABLE = 'userSeenState';

/**
 * Sidebar page id → the RTDB table whose NEW records it displays.
 * Only modules that show lists of user-created records are monitored.
 * (Risk Center computes its view live from the underlying tables —
 * new capa/follow-up/complaint records already badge those pages.)
 */
export const UNSEEN_MONITORED_TABLES: Record<string, string> = {
  followUps: 'followUps',
  quality: 'qualityDeductions',
  observations: 'qualityObservations',
  complaints: 'complaints',
  capa: 'capaCases',
  travel: 'travelDeals',
};

/** True when the sidebar should badge this page id. */
export function isUnseenMonitoredPage(pageId: string): boolean {
  return pageId in UNSEEN_MONITORED_TABLES;
}
