// ══════════════════════════════════════════════════════════════
//  Quality Observation Evidence — classification + safe handling
//
//  Pure, client-safe helpers for the Observation Detail dialog's
//  evidence viewer (Phase 2 Milestone 7, Part B).
//
//  The evidence value is USER-PROVIDED data. These helpers make
//  the security posture explicit and testable:
//    • URL detection uses the URL parser — never a fragile
//      startsWith('http') check, and never "text containing dots".
//    • Only http:// and https:// are treated as openable links.
//      javascript:, data:, file:, mailto: and every other scheme
//      are classified as PLAIN TEXT (never opened as links).
//    • Display truncation is a VIEW concern only — every helper
//      returns/preserves the ORIGINAL string untouched so Copy,
//      Open and View always operate on the exact stored value.
//    • Rendering stays React-escaped text (no HTML conversion —
//      the caller renders with JSX text nodes only).
// ══════════════════════════════════════════════════════════════

/** Empty-state label shown when an observation carries no evidence. */
export const EVIDENCE_EMPTY_LABEL = 'لا يوجد دليل / إثبات';

/** The only schemes classified as openable web links. */
const SAFE_URL_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Classified evidence kinds:
 *   • empty — no evidence value at all
 *   • url   — a safe http(s) web link
 *   • text  — plain text (including unsafe/unsupported URL schemes,
 *             which are deliberately treated as text and never opened)
 */
export type EvidenceKind = 'empty' | 'url' | 'text';

/** Classified evidence value — carries the ORIGINAL string verbatim. */
export type ClassifiedEvidence =
  | { kind: 'empty' }
  | { kind: 'url'; url: string }
  | { kind: 'text'; text: string };

/**
 * Strictly parse a value as a SAFE openable web URL.
 *
 * Uses the WHATWG URL parser (handles whitespace, credentials,
 * ports, IDN…) and then allow-lists the protocol. Returns the
 * parsed absolute URL string, or null when the value is not a
 * safe http(s) link. Accepts an optional base for relative
 * resolution tests; production callers pass none.
 */
export function parseSafeHttpUrl(value: string, base?: string): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  let parsed: URL;
  try {
    parsed = base ? new URL(trimmed, base) : new URL(trimmed);
  } catch {
    return null;
  }

  if (!SAFE_URL_PROTOCOLS.has(parsed.protocol)) return null;

  // A bare host with no path still needs a hostname to be a real link
  // (new URL('http://') throws, but guard explicitly for clarity).
  if (!parsed.hostname) return null;

  return parsed.toString();
}

/**
 * Classify a raw observation evidence value.
 *
 *   '' / whitespace / null / undefined          → empty
 *   safe http(s) URL (via URL parsing)          → url (carries the
 *                                                  original trimmed value)
 *   anything else (incl. javascript:, data:…)   → text
 *
 * The returned url/text string is the caller's evidence value with
 * surrounding whitespace trimmed ONLY for classification; Copy/Open
 * operations should still copy the original stored string exactly.
 */
export function classifyEvidence(value: string | null | undefined): ClassifiedEvidence {
  if (typeof value !== 'string' || value.trim() === '') {
    return { kind: 'empty' };
  }

  const trimmed = value.trim();

  // A safe http(s) URL must ALSO look like one at a glance — the URL
  // parser accepts 'example.com/path' only with a base, so without a
  // base a passing parse already implies an explicit scheme.
  if (parseSafeHttpUrl(trimmed)) {
    return { kind: 'url', url: trimmed };
  }

  return { kind: 'text', text: trimmed };
}

/**
 * Display-only truncation for long evidence previews.
 *
 * NEVER used for Copy / Open / View — those always receive the full
 * original string. Purely cosmetic (keeps long URLs from stretching
 * the dialog).
 */
export function truncateEvidenceForDisplay(value: string, maxLength = 120): string {
  if (value.length <= maxLength) return value;
  const head = Math.ceil((maxLength - 1) / 2);
  const tail = Math.floor((maxLength - 1) / 2);
  return `${value.slice(0, head)}…${value.slice(value.length - tail)}`;
}
