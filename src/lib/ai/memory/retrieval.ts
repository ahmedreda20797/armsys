// ══════════════════════════════════════════════════════════════
//  Organizational Memory — retrieval (Phase 6.4, spec §16/§17)
//
//  PURE, PROVIDER-INDEPENDENT relevance ranking. Given a question
//  like "ليه أداء فريق المبيعات انخفض؟", retrieve only RELEVANT
//  memories — never dump all memory into any prompt.
//
//  Ranking dimensions (§16):
//    • TRUST STATUS    — only trusted (VALIDATED/APPROVED) by default;
//                        lower-status entries are excluded unless the
//                        caller explicitly asks to include proposals
//                        (then they rank far below trusted ones);
//    • entity match    — subject employee/organization alignment;
//    • department      — explicit department/topic alignment;
//    • period overlap  — requested period vs entry period;
//    • topic overlap   — Arabic/English keyword overlap with
//                        title/summary/learning;
//    • recency         — recent-when-appropriate (soft boost);
//    • confidence      — high-confidence entries rank above low;
//    • evidence-backed — entries always carry evidence (enforced at
//                        creation) — richer evidence ranks higher.
// ══════════════════════════════════════════════════════════════

import type { AIAnalysisPeriod } from '../types';
import {
  isTrustedMemory,
  type OrganizationalMemoryRecord,
} from './types';

export interface MemoryRetrievalQuery {
  /** Free-text topic — Arabic or English. */
  topic?: string;
  department?: string | null;
  employeeId?: string | null;
  organizationId?: string;
  period?: AIAnalysisPeriod | null;
  /** Include PROPOSED/REJECTED entries (ranked far below trusted). */
  includeUntrusted?: boolean;
  /** Maximum entries returned (default 5 — never a dump). */
  limit?: number;
}

export interface MemoryRetrievalResult {
  entry: OrganizationalMemoryRecord;
  score: number;
  matchedOn: string[];
}

const DEFAULT_LIMIT = 5;
const MAX_TOPIC_TERMS = 8;

/** Arabic-light normalization: strip diacritics/tatweel, unify
 *  alef/ya/ta-marbuta forms, drop definite articles, lowercase. */
function normalizeArabic(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\bال(?=\S{2,})/g, '');
}

function significantTerms(text: string): string[] {
  const normalized = normalizeArabic(text);
  const raw = normalized.split(/[^\p{L}\p{N}]+/u).filter((t) => t.length >= 2);
  return [...new Set(raw)].slice(0, MAX_TOPIC_TERMS);
}

function periodsOverlap(
  a: AIAnalysisPeriod | null | undefined,
  b: AIAnalysisPeriod | null | undefined,
): boolean {
  if (!a || !b) return false;
  return a.from <= b.to && b.from <= a.to;
}

function monthDistance(from: string, to: string): number {
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  if (!Number.isFinite(fy) || !Number.isFinite(fm) || !Number.isFinite(ty) || !Number.isFinite(tm)) {
    return 999;
  }
  return Math.abs((ty - fy) * 12 + (tm - fm));
}

export function retrieveRelevantMemories(
  query: MemoryRetrievalQuery,
  allEntries: readonly OrganizationalMemoryRecord[],
): MemoryRetrievalResult[] {
  const limit = Math.max(1, Math.min(query.limit ?? DEFAULT_LIMIT, 20));
  const topicTerms = query.topic ? significantTerms(query.topic) : [];
  const now = new Date().toISOString();

  const scored: MemoryRetrievalResult[] = [];

  for (const entry of allEntries) {
    const matchedOn: string[] = [];
    let score = 0;

    // ── trust gate + trust weight (§16: relevant + validated first) ──
    if (isTrustedMemory(entry)) {
      score += entry.status === 'APPROVED' ? 30 : 24;
      matchedOn.push('trusted');
    } else if (query.includeUntrusted && entry.status === 'PROPOSED') {
      score += 4; // far below any trusted entry
      matchedOn.push('proposed-included');
    } else {
      continue; // REJECTED/ARCHIVED never surface (§16)
    }

    // ── organization scope (§36-P) ──
    if (query.organizationId && entry.organizationId !== query.organizationId) {
      continue; // cross-organization entries are out of scope
    }

    // ── entity match ──
    if (query.employeeId) {
      const subject = entry.subject as { kind?: string; employeeId?: string };
      if (subject?.kind === 'employee' && subject.employeeId === query.employeeId) {
        score += 25;
        matchedOn.push('employee');
      }
    }

    // ── department match ──
    if (query.department && entry.department) {
      if (normalizeArabic(entry.department) === normalizeArabic(query.department)) {
        score += 18;
        matchedOn.push('department');
      }
    }

    // ── period overlap ──
    if (periodsOverlap(query.period, entry.period)) {
      score += 12;
      matchedOn.push('period');
    } else if (query.period && entry.period) {
      const distance = monthDistance(query.period.from, entry.period.from);
      score += Math.max(0, 6 - distance * 2); // soft recency-by-period decay
    }

    // ── topic overlap ──
    if (topicTerms.length > 0) {
      const haystack = normalizeArabic(
        [entry.title, entry.summary, entry.learning ?? '', entry.outcome ?? ''].join(' '),
      );
      let hits = 0;
      for (const term of topicTerms) {
        if (haystack.includes(term)) hits += 1;
      }
      if (hits > 0) {
        score += Math.min(20, hits * 7);
        matchedOn.push(`topic:${hits}`);
      }
    }

    // ── confidence ──
    if (entry.confidence === 'high') score += 6;
    else if (entry.confidence === 'medium') score += 3;

    // ── recency (soft — recent WHEN appropriate, §16) ──
    const ageDays = Math.max(0, (Date.parse(now) - Date.parse(entry.createdAt)) / 86_400_000);
    if (Number.isFinite(ageDays)) {
      score += Math.max(0, 8 - Math.floor(ageDays / 30)); // ≤8 pts, decays monthly
    }

    // ── evidence richness (bounded) ──
    score += Math.min(4, entry.evidence.length);

    if (score <= 0) continue;
    scored.push({ entry, score, matchedOn });
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
