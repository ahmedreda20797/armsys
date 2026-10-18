// ══════════════════════════════════════════════════════════════
//  §EVIDENCE-ITEMS — canonical multi-item evidence model
//
//  One record carries ANY number of independent evidence items
//  (same interaction philosophy as Travel bookingItems): each item
//  owns its type and its type-specific value. Evidence values are
//  NEVER concatenated into one string field.
//
//  Types: link / number / image. 'text' is LEGACY-ONLY — the read
//  adapter preserves old free-text evidence verbatim; the add-item
//  UI offers only link/number/image.
//
//  Images: bytes live in Firebase Storage (metadata only in RTDB —
//  never Base64). Storage paths:
//    pending (staged, pre-save):  evidence/pending/<uploadId>.webp
//    final   (parent persisted):  evidence/<table>/<recordId>/<itemId>.webp
//
//  LEGACY COMPATIBILITY: records stored before this model carry a
//  single `evidence` string (and Follow-ups `attachments: string[]`).
//  They normalize at READ time into canonical items (non-destructive).
//  On SAVE, canonical items are projected back onto the legacy fields
//  so every existing reader (reports, KPI pipeline, exports) stays
//  correct. Legacy text is never split or re-guessed (§16/§17).
//
//  Pure and client-safe — no server imports.
// ══════════════════════════════════════════════════════════════

import type { EvidenceItem, EvidenceItemType } from '@/types';
import { classifyEvidence, parseSafeHttpUrl } from '@/lib/quality-observations/evidence';

/** Types offered by the add-evidence UI, in canonical display order. */
export const EVIDENCE_ITEM_TYPES: readonly EvidenceItemType[] = ['link', 'number', 'image'] as const;

/** Types accepted by the authoritative sanitizer ('text' round-trips legacy items). */
const STORABLE_TYPES: readonly EvidenceItemType[] = ['link', 'number', 'image', 'text'];

/** Arabic source labels (EN via en-map/i18n). */
export const EVIDENCE_TYPE_LABELS_AR: Record<EvidenceItemType, string> = {
  link: 'رابط',
  number: 'رقم',
  image: 'صورة',
  text: 'نص',
};

/** Icons per type (UI) — same convention as BOOKING_TYPE_ICONS. */
export const EVIDENCE_TYPE_ICONS: Record<EvidenceItemType, string> = {
  link: '🔗',
  number: '#️⃣',
  image: '🖼️',
  text: '📝',
};

// ── Limits (single source of truth — client validation and the API
//    both read THESE constants; no scattered magic numbers §11/§20) ──

export const MAX_EVIDENCE_ITEMS = 50;
export const MAX_EVIDENCE_URL_LENGTH = 2000;
export const MAX_EVIDENCE_NUMBER_LENGTH = 64;
export const MAX_EVIDENCE_TEXT_LENGTH = 500;
export const MAX_EVIDENCE_FILE_NAME_LENGTH = 255;
export const MAX_EVIDENCE_ITEM_ID_LENGTH = 64;

/** Image input ceiling BEFORE optimization (bytes). */
export const EVIDENCE_IMAGE_MAX_INPUT_BYTES = 8 * 1024 * 1024;
/** Hard ceiling for the stored (optimized WebP) object (bytes). */
export const EVIDENCE_IMAGE_MAX_STORED_BYTES = 3 * 1024 * 1024;
/** Downscale ceiling — keeps screenshot text readable (§11: never aggressive). */
export const EVIDENCE_IMAGE_MAX_WIDTH = 2000;
/** WebP quality — readability of evidence text over byte savings. */
export const EVIDENCE_IMAGE_QUALITY = 85;
/** Accepted INPUT mime types (SVG deliberately excluded — vector XSS). */
export const EVIDENCE_IMAGE_MIME_ALLOWLIST: readonly string[] = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
];
/** Storage objects are ALWAYS re-encoded to WebP server-side. */
export const EVIDENCE_IMAGE_STORED_MIME = 'image/webp';

// ── Storage path helpers (shared by client, API and Storage lib) ──

export const EVIDENCE_STORAGE_ROOT = 'evidence';
export const EVIDENCE_PENDING_PREFIX = 'evidence/pending';

const SEGMENT_RE = /^[A-Za-z0-9_-]{1,128}$/;
const STORED_FILE_RE = /^[A-Za-z0-9_-]{1,96}\.webp$/;

/** Staging path — image uploaded, parent record not yet saved. */
export function buildPendingStoragePath(uploadId: string): string {
  return `${EVIDENCE_PENDING_PREFIX}/${uploadId}.webp`;
}

/** Final path — bound to the parent record (authorization anchor §13). */
export function buildFinalStoragePath(table: string, recordId: string, itemId: string): string {
  return `${EVIDENCE_STORAGE_ROOT}/${table}/${recordId}/${itemId}.webp`;
}

/**
 * Strictly parse an evidence storage path.
 *   evidence/pending/<id>.webp                       → { kind: 'pending', … }
 *   evidence/<table>/<recordId>/<itemId>.webp        → { kind: 'final', … }
 * Anything else (traversal, extra segments, wrong extension) → null.
 */
export function parseEvidenceStoragePath(
  path: string,
): { kind: 'pending'; uploadId: string } | { kind: 'final'; table: string; recordId: string; fileName: string } | null {
  if (typeof path !== 'string') return null;
  const segments = path.split('/');
  if (segments[0] !== EVIDENCE_STORAGE_ROOT) return null;

  if (segments.length === 3 && segments[1] === 'pending') {
    const fileName = segments[2];
    if (!STORED_FILE_RE.test(fileName)) return null;
    return { kind: 'pending', uploadId: fileName.slice(0, -'.webp'.length) };
  }

  if (segments.length === 4) {
    const [, table, recordId, fileName] = segments;
    if (!SEGMENT_RE.test(table) || !SEGMENT_RE.test(recordId) || !STORED_FILE_RE.test(fileName)) return null;
    return { kind: 'final', table, recordId, fileName };
  }

  return null;
}

// ── Identity ──

/** Generate a collision-safe id for a new item (client or server). */
export function newEvidenceItemId(): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `ev-${Date.now().toString(36)}-${rand}`;
}

function isEvidenceItemType(v: unknown): v is EvidenceItemType {
  return typeof v === 'string' && (STORABLE_TYPES as readonly string[]).includes(v);
}

// ── Authoritative server-side validation (§20 — per item, never a
//    concatenated collection) ──

function sanitizeImage(meta: unknown, errorPrefix: string): { ok: true; image: EvidenceItem['image'] } | { ok: false; error: string } {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
    return { ok: false, error: `${errorPrefix}: image metadata is required` };
  }
  const img = meta as Record<string, unknown>;
  if (typeof img.storagePath !== 'string' || !parseEvidenceStoragePath(img.storagePath)) {
    return { ok: false, error: `${errorPrefix}: invalid image storagePath` };
  }
  if (typeof img.mimeType !== 'string' || img.mimeType !== EVIDENCE_IMAGE_STORED_MIME) {
    return { ok: false, error: `${errorPrefix}: invalid image mimeType` };
  }
  if (typeof img.size !== 'number' || !Number.isFinite(img.size) || img.size <= 0 || img.size > EVIDENCE_IMAGE_MAX_STORED_BYTES) {
    return { ok: false, error: `${errorPrefix}: invalid image size` };
  }
  const fileName = typeof img.fileName === 'string' && img.fileName.trim() !== ''
    ? img.fileName.trim().slice(0, MAX_EVIDENCE_FILE_NAME_LENGTH)
    : 'evidence.webp';
  const width = typeof img.width === 'number' && Number.isFinite(img.width) && img.width > 0 ? Math.round(img.width) : null;
  const height = typeof img.height === 'number' && Number.isFinite(img.height) && img.height > 0 ? Math.round(img.height) : null;
  return {
    ok: true,
    image: { storagePath: img.storagePath, fileName, mimeType: EVIDENCE_IMAGE_STORED_MIME, size: Math.round(img.size), width, height },
  };
}

/**
 * Server-side payload validation for client-submitted evidenceItems
 * (the API is authoritative; the UI is not trusted). Returns the
 * sanitized canonical items or an explicit error — never a partial
 * guess. Mirrors sanitizeBookingItems.
 */
export function sanitizeEvidenceItems(
  input: unknown,
): { ok: true; items: EvidenceItem[] } | { ok: false; error: string } {
  if (!Array.isArray(input)) {
    return { ok: false, error: 'evidenceItems must be an array' };
  }
  if (input.length > MAX_EVIDENCE_ITEMS) {
    return { ok: false, error: `evidenceItems exceeds ${MAX_EVIDENCE_ITEMS} items` };
  }
  const seenIds = new Set<string>();
  const items: EvidenceItem[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { ok: false, error: 'evidence item must be an object' };
    }
    const it = raw as Record<string, unknown>;
    if (typeof it.id !== 'string' || it.id.length === 0 || it.id.length > MAX_EVIDENCE_ITEM_ID_LENGTH) {
      return { ok: false, error: 'evidence item id is required (string ≤ 64 chars)' };
    }
    if (seenIds.has(it.id)) {
      return { ok: false, error: `duplicate evidence item id: ${it.id}` };
    }
    seenIds.add(it.id);
    if (!isEvidenceItemType(it.type)) {
      return { ok: false, error: `unknown evidence item type: ${String(it.type)}` };
    }
    const prefix = `evidence item ${it.id}`;

    let item: EvidenceItem;
    if (it.type === 'link') {
      const url = typeof it.url === 'string' ? it.url.trim() : '';
      if (!url) return { ok: false, error: `${prefix}: url is required` };
      if (url.length > MAX_EVIDENCE_URL_LENGTH) {
        return { ok: false, error: `${prefix}: url exceeds ${MAX_EVIDENCE_URL_LENGTH} chars` };
      }
      if (!parseSafeHttpUrl(url)) {
        return { ok: false, error: `${prefix}: url must be a valid http(s) link` };
      }
      item = { id: it.id, type: 'link', url };
    } else if (it.type === 'number') {
      // Preserved as an EXACT string — leading zeros are meaningful (§6).
      const number = typeof it.number === 'string' ? it.number.trim() : '';
      if (!number) return { ok: false, error: `${prefix}: number is required` };
      if (number.length > MAX_EVIDENCE_NUMBER_LENGTH) {
        return { ok: false, error: `${prefix}: number exceeds ${MAX_EVIDENCE_NUMBER_LENGTH} chars` };
      }
      if (/[\r\n]/.test(number)) return { ok: false, error: `${prefix}: number must be single-line` };
      item = { id: it.id, type: 'number', number };
    } else if (it.type === 'image') {
      const img = sanitizeImage(it.image, prefix);
      if (!img.ok) return img;
      item = { id: it.id, type: 'image', image: img.image };
    } else {
      // 'text' — legacy round-trip only.
      const text = typeof it.text === 'string' ? it.text.trim() : '';
      if (!text) return { ok: false, error: `${prefix}: text is required` };
      if (text.length > MAX_EVIDENCE_TEXT_LENGTH) {
        return { ok: false, error: `${prefix}: text exceeds ${MAX_EVIDENCE_TEXT_LENGTH} chars` };
      }
      item = { id: it.id, type: 'text', text };
    }

    items.push({
      ...item,
      createdAt: typeof it.createdAt === 'string' && it.createdAt ? it.createdAt : null,
      createdBy: typeof it.createdBy === 'string' && it.createdBy ? it.createdBy.slice(0, 128) : null,
    });
  }
  return { ok: true, items };
}

// ── Read-time legacy adapter (§17: adapter over destructive migration) ──

/** Which legacy fields a module carries on its records. */
export type LegacyEvidenceKind = 'required-string' | 'nullable-string' | 'followup' | 'none';

function isValidStoredItem(item: unknown): item is EvidenceItem {
  if (!item || typeof item !== 'object') return false;
  const it = item as Record<string, unknown>;
  return typeof it.id === 'string' && it.id.length > 0 && isEvidenceItemType(it.type);
}

/**
 * Normalize ONE record into its canonical evidence items.
 *
 *   • record.evidenceItems (array) → stored items, invalid rows dropped.
 *   • otherwise (legacy record)    → deterministic read-time adapter:
 *     the single `evidence` string becomes ONE item (classified url/text —
 *     never split), and Follow-ups' `attachments` each become their own
 *     item. Original fields are never touched (non-destructive).
 */
export function normalizeEvidenceItems(
  record: { evidenceItems?: EvidenceItem[] | null } & {
    evidence?: string | null;
    attachments?: string[] | null;
  },
  legacy: LegacyEvidenceKind,
): EvidenceItem[] {
  if (Array.isArray(record.evidenceItems)) {
    return record.evidenceItems.filter(isValidStoredItem);
  }

  const items: EvidenceItem[] = [];
  if (legacy !== 'none' && typeof record.evidence === 'string' && record.evidence.trim() !== '') {
    const classified = classifyEvidence(record.evidence);
    if (classified.kind === 'url') {
      items.push({ id: 'legacy-evidence', type: 'link', url: classified.url });
    } else {
      items.push({ id: 'legacy-evidence', type: 'text', text: record.evidence });
    }
  }

  if (legacy === 'followup' && Array.isArray(record.attachments)) {
    record.attachments.forEach((att, i) => {
      if (typeof att !== 'string' || att.trim() === '') return;
      items.push(
        parseSafeHttpUrl(att)
          ? { id: `legacy-att-${i + 1}`, type: 'link', url: att.trim() }
          : { id: `legacy-att-${i + 1}`, type: 'text', text: att },
      );
    });
  }

  return items;
}

// ── Write-time legacy projection (existing readers stay correct) ──

/**
 * CAPA read adapter — CAPA carries DIFFERENT legacy fields than the
 * other modules: `correctiveEvidence: string` (documentation
 * narrative) and `attachments: CAPAAttachment[]` (structured objects).
 * Stored items win; otherwise each legacy field becomes its own item
 * verbatim — the narrative is never re-guessed into a link.
 */
export function normalizeCapaEvidenceItems(
  capa: { evidenceItems?: EvidenceItem[] | null; correctiveEvidence?: string | null; attachments?: Array<{ url?: string; name?: string }> | null },
): EvidenceItem[] {
  if (Array.isArray(capa.evidenceItems)) {
    return capa.evidenceItems.filter(isValidStoredItem);
  }
  const items: EvidenceItem[] = [];
  if (typeof capa.correctiveEvidence === 'string' && capa.correctiveEvidence.trim() !== '') {
    const classified = classifyEvidence(capa.correctiveEvidence);
    items.push(
      classified.kind === 'url'
        ? { id: 'legacy-corrective-evidence', type: 'link', url: classified.url }
        : { id: 'legacy-corrective-evidence', type: 'text', text: capa.correctiveEvidence },
    );
  }
  if (Array.isArray(capa.attachments)) {
    capa.attachments.forEach((att, i) => {
      const url = typeof att?.url === 'string' ? att.url.trim() : '';
      if (!url) return;
      items.push(
        parseSafeHttpUrl(url)
          ? { id: `legacy-att-${i + 1}`, type: 'link', url }
          : { id: `legacy-att-${i + 1}`, type: 'text', text: url },
      );
    });
  }
  return items;
}

function firstLinkUrl(items: ReadonlyArray<EvidenceItem>): string | null {
  for (const item of items) if (item.type === 'link' && item.url) return item.url;
  return null;
}

function firstText(items: ReadonlyArray<EvidenceItem>): string | null {
  for (const item of items) if (item.type === 'text' && item.text) return item.text;
  return null;
}

/**
 * Project canonical items back onto the module's legacy fields
 * (spread the result into the record write). Readers of the old
 * single-string fields keep seeing the FIRST link (the shape they
 * always understood); number/image items have no legacy shape and
 * are read exclusively through evidenceItems.
 */
export function projectLegacyEvidenceFields(
  items: ReadonlyArray<EvidenceItem>,
  legacy: LegacyEvidenceKind,
): Record<string, unknown> {
  const linkUrl = firstLinkUrl(items);
  const text = firstText(items);
  switch (legacy) {
    case 'required-string':
      return { evidence: linkUrl ?? text ?? '' };
    case 'nullable-string':
      return { evidence: linkUrl ?? text ?? null };
    case 'followup':
      return {
        evidence: linkUrl ?? text ?? null,
        attachments: items.filter((i) => i.type === 'link' && i.url).map((i) => i.url as string),
      };
    default:
      return {};
  }
}

/**
 * Merge newly saved items with the storage-bound image paths after
 * promotion (server write-path helper — rewrites pending → final).
 * Non-image items and already-final images pass through unchanged.
 */
export function withFinalStoragePaths(
  items: ReadonlyArray<EvidenceItem>,
  table: string,
  recordId: string,
): EvidenceItem[] {
  return items.map((item) =>
    item.type === 'image' && item.image && parseEvidenceStoragePath(item.image.storagePath)?.kind === 'pending'
      ? { ...item, image: { ...item.image, storagePath: buildFinalStoragePath(table, recordId, item.id) } }
      : item,
  );
}

/** Client fetch URL for an evidence image (served authorized by the API). */
export function evidenceImageUrl(storagePath: string): string {
  return `/api/evidence/image/${storagePath}`;
}

/** Extract only the image items (display + promotion helpers). */
export function evidenceImageItems(items: ReadonlyArray<EvidenceItem>): EvidenceItem[] {
  return items.filter((i) => i.type === 'image' && i.image);
}

/** Is an item complete enough to save? (Form-level per-item gating §20.) */
export function isCompleteEvidenceItem(item: EvidenceItem): boolean {
  switch (item.type) {
    case 'link':
      return typeof item.url === 'string' && item.url.trim() !== '' && item.url.trim().length <= MAX_EVIDENCE_URL_LENGTH && !!parseSafeHttpUrl(item.url.trim());
    case 'number':
      return typeof item.number === 'string' && item.number.trim() !== '' && item.number.trim().length <= MAX_EVIDENCE_NUMBER_LENGTH;
    case 'image':
      return !!item.image && !!parseEvidenceStoragePath(item.image.storagePath);
    case 'text':
      return typeof item.text === 'string' && item.text.trim() !== '';
  }
}

/**
 * Anti-attachment guard (§13): on save, an image item may carry either
 *   • a PENDING path (freshly staged by this user — promoted on write), or
 *   • a FINAL path that is ALREADY on this same record (unchanged item).
 * A final path belonging to any OTHER record is rejected — otherwise a
 * caller with create rights on an accessible record could mount a
 * restricted record's image under its own authorization.
 * Returns an error string, or null when every image item is attachable.
 */
export function assertAttachableEvidenceImages(
  items: ReadonlyArray<EvidenceItem>,
  existingItems: ReadonlyArray<EvidenceItem> | null,
): string | null {
  const existingPaths = new Set(
    (existingItems ?? [])
      .filter((i) => i.type === 'image' && i.image)
      .map((i) => (i.image as { storagePath: string }).storagePath),
  );
  for (const item of items) {
    if (item.type !== 'image' || !item.image) continue;
    const parsed = parseEvidenceStoragePath(item.image.storagePath);
    if (!parsed) return `evidence item ${item.id}: invalid image storagePath`;
    if (parsed.kind === 'pending') continue;
    if (!existingPaths.has(item.image.storagePath)) {
      return `evidence item ${item.id}: image evidence must be newly staged`;
    }
  }
  return null;
}

/**
 * Stamp actor/time on items that lack them (server write path — the
 * client never forges provenance).
 */
export function stampEvidenceItems(
  items: ReadonlyArray<EvidenceItem>,
  nowIso: string,
  actorId: string,
): EvidenceItem[] {
  return items.map((item) => ({
    ...item,
    createdAt: item.createdAt ?? nowIso,
    createdBy: item.createdBy ?? actorId,
  }));
}
