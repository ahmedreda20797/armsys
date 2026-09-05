// ══════════════════════════════════════════════════════════════
//  Employee Documents — pure helpers (Milestone 7 §17)
//
//  Client-safe pure module (no db): the document type vocabulary,
//  the derived expiry status (the ONLY status rule — never a stored
//  or invented flag), and the GET/create payload sanitization used
//  by the API route. Deterministic and unit-tested.
// ══════════════════════════════════════════════════════════════

/** Document type vocabulary (stable keys, Arabic labels). */
export const DOCUMENT_TYPES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'identity', label: 'هوية / بطاقة' },
  { value: 'contract', label: 'عقد عمل' },
  { value: 'certificate', label: 'شهادة' },
  { value: 'medical', label: 'شهادة طبية' },
  { value: 'other', label: 'أخرى' },
];

const DOCUMENT_TYPE_VALUES = new Set(DOCUMENT_TYPES.map((t) => t.value));

export function isKnownDocumentType(value: unknown): value is string {
  return typeof value === 'string' && DOCUMENT_TYPE_VALUES.has(value);
}

export function documentTypeLabel(value: string): string {
  return DOCUMENT_TYPES.find((t) => t.value === value)?.label ?? value;
}

/** Derived expiry status — explicit, never stored, never fabricated. */
export type DocumentStatus = 'valid' | 'expired' | 'permanent';

export function documentStatus(expiryDate: string | null | undefined, today?: string): DocumentStatus {
  if (!expiryDate) return 'permanent';
  const day = today ?? new Date().toISOString().slice(0, 10);
  return expiryDate < day ? 'expired' : 'valid';
}

export const DOCUMENT_STATUS_LABELS: Record<DocumentStatus, string> = {
  valid: 'ساري',
  expired: 'منتهي',
  permanent: 'دائم',
};
