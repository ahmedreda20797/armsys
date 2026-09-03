// ══════════════════════════════════════════════════════════════
//  AI Gateway — prompt-injection protections (Phase 6.4, spec §20)
//
//  User-entered and database-stored TEXT (observation notes,
//  complaint text, employee notes, chat messages) is UNTRUSTED DATA.
//  It must never be able to:
//    • escape its labeled data block,
//    • override SYSTEM/GOVERNANCE instructions,
//    • override permissions (which are enforced OUTSIDE the model
//      anyway — the authorization layer always wins, §11).
//
//  The four separation bands (§20):
//    SYSTEM/GOVERNANCE INSTRUCTIONS  → the fixed versioned system prompt
//    TRUSTED ARM CONTEXT             → deterministic analytics snapshots
//    UNTRUSTED DATA CONTENT          → fenced, sanitized record text
//    USER REQUEST                    → the explicit task line
//
//  Defense is STRUCTURAL (fencing + escaping + labeled blocks), not
//  keyword-blocking: detectInjectionSignals() exists ONLY for
//  observability/audit — it never alters permissions or data.
// ══════════════════════════════════════════════════════════════

/** The exact fence tokens used by ARM data blocks. Any occurrence of
 *  these INSIDE untrusted content would break the fence — they are
 *  neutralized by zero-width-safe escaping before serialization. */
export const ARM_FENCE_BEGIN = '<<<ARM_DATA_BEGIN>>>';
export const ARM_FENCE_END = '<<<ARM_DATA_END>>>';

/** Neutralizes fence-breakout inside untrusted text:
 *  • the ARM fence tokens → wrapped in spaces + split by zero-width
 *    space so the literal sequence can never re-form the fence;
 *  • triple-backtick runs (markdown code fences) → single backticks,
 *    so untrusted content cannot open a new "instructions" block;
 *  • the JSON string context means these replacements survive
 *    serialization exactly. */
export function sanitizeUntrustedText(text: string): string {
  if (typeof text !== 'string' || text.length === 0) return text;
  return text
    .split(ARM_FENCE_BEGIN).join(`\u200b< < ARM_DATA_BEGIN > >\u200b`)
    .split(ARM_FENCE_END).join(`\u200b< < ARM_DATA_END > >\u200b`)
    .replace(/```+/g, '``');
}

/** Deep-sanitizes any string found inside a JSON-serializable payload
 *  (records, notes, titles, descriptions) — arrays and plain objects
 *  are traversed; non-plain values are left to the JSON layer. */
export function sanitizeUntrustedPayload<T>(payload: T): T {
  if (typeof payload === 'string') return sanitizeUntrustedText(payload) as unknown as T;
  if (Array.isArray(payload)) {
    return payload.map((item) => sanitizeUntrustedPayload(item)) as unknown as T;
  }
  if (payload && typeof payload === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
      out[key] = sanitizeUntrustedPayload(value);
    }
    return out as unknown as T;
  }
  return payload;
}

/** Heuristic signals for OBSERVABILITY ONLY (never a security control
 *  by itself — the structural fence is the control). Returns the list
 *  of matched signal names for audit enrichment. */
const INJECTION_SIGNAL_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ['ignore-instructions', /ignore (all )?(previous|prior|above) (instructions|rules|prompts)/i],
  ['ignore-instructions-ar', /تجاهل (التعليمات|الأوامر) (السابقة|أعلاه)/i],
  ['role-hijack', /you are now|act as (the )?(system|admin)/i],
  ['reveal-secrets', /(reveal|show|print) (the )?(api[- ]?key|secret|password|credentials)/i],
  ['reveal-secrets-ar', /اعرض (مفتاح|كلمة السر|كلمة المرور)/i],
  ['permission-bypass', /(bypass|ignore) (permissions|authorization|scope)/i],
  ['permission-bypass-ar', /تجاوز (الصلاحيات|الأذونات)/i],
];

export function detectInjectionSignals(text: string): string[] {
  if (typeof text !== 'string' || text.length === 0) return [];
  const signals: string[] = [];
  for (const [name, regex] of INJECTION_SIGNAL_PATTERNS) {
    if (regex.test(text)) signals.push(name);
  }
  return signals;
}
