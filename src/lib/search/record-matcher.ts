// ══════════════════════════════════════════════════════════════
//  Global Search — pure record matcher (Phase 6.1, spec §16)
//
//  Exact / lexical matching ONLY — no AI, no embeddings, no semantic
//  model. Priority: exact unique id > exact > prefix > contains.
//  An internal relevance score orders results (never exposed as a
//  contract field).
//
//  Multi-term queries use AND semantics: every term must match at
//  least one searchable field, otherwise the record does not match.
// ══════════════════════════════════════════════════════════════

import { normalizeForSearch } from './search-normalize';

export type MatchKind = 'exact-id' | 'exact' | 'prefix' | 'contains';

/** One searchable field extracted from a record (in-memory copy). */
export interface MatchableField {
  key: string;
  /** Arabic label surfaced in matchedFields. */
  label: string;
  value: string | null | undefined;
  /** 'business' = human-facing unique identifier (employee code, CAPA number). */
  idLevel?: 'business';
}

export interface RecordMatch {
  score: number;
  matchedFields: string[];
  bestKind: MatchKind;
}

const KIND_SCORE: Record<MatchKind, number> = {
  'exact-id': 1000,
  exact: 500,
  prefix: 300,
  contains: 100,
};

/** Small bonus for earlier (more identifying) fields in the adapter order. */
const FIELD_PRIORITY_BONUS = 8;

/** Whole-query == record id shortcut score (strongest possible match). */
export const RECORD_ID_MATCH_SCORE = 2000;

/** Classify ONE normalized field value against ONE term. */
export function scoreFieldAgainstTerm(
  normalizedValue: string,
  term: string,
  idLevel?: 'business',
): MatchKind | null {
  if (!normalizedValue) return null;
  if (normalizedValue === term) return idLevel === 'business' ? 'exact-id' : 'exact';
  if (normalizedValue.startsWith(term)) return 'prefix';
  if (normalizedValue.includes(term)) return 'contains';
  return null;
}

/**
 * Score ONE record against the query terms. Returns null when the
 * record does not match (any term unmatched ⇒ no match — AND).
 */
export function matchRecord(
  fields: MatchableField[],
  terms: string[],
): RecordMatch | null {
  if (terms.length === 0) return null;

  let totalScore = 0;
  const matchedFields: string[] = [];
  let bestKind: MatchKind = 'exact-id';

  for (const term of terms) {
    let termScore = 0;
    let termLabel: string | null = null;
    let termKind: MatchKind | null = null;

    fields.forEach((field, index) => {
      const value = normalizeForSearch(String(field.value ?? ''));
      if (!value) return;
      const kind = scoreFieldAgainstTerm(value, term, field.idLevel);
      if (!kind) return;
      const score = KIND_SCORE[kind] + Math.max(0, fields.length - index) * FIELD_PRIORITY_BONUS;
      if (score > termScore) {
        termScore = score;
        termLabel = field.label;
        termKind = kind;
      }
    });

    if (termLabel === null || termKind === null) return null;
    totalScore += termScore;
    if (!matchedFields.includes(termLabel)) matchedFields.push(termLabel);
    if (KIND_SCORE[termKind] < KIND_SCORE[bestKind]) bestKind = termKind;
  }

  return { score: totalScore, matchedFields, bestKind };
}

/**
 * Exact unique-identifier shortcut: the WHOLE normalized query equals
 * the record's canonical id (spec §16 priority 1).
 */
export function isRecordIdMatch(recordId: string, normalizedQuery: string): boolean {
  return normalizeForSearch(recordId) === normalizedQuery;
}
