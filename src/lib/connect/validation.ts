// src/lib/connect/validation.ts
// ══════════════════════════════════════════════════════════════
//  QNALYS Connect 1.0 — REQUEST VALIDATION
//
//  Pure helpers validating EVERY user-supplied field before a service
//  call (§SECURITY "Validate every user-supplied ID / body lengths /
//  clientKey format"). Route handlers convert the returned failure
//  strings into 400 VALIDATION errors; services never see unvalidated
//  input.
// ══════════════════════════════════════════════════════════════

import {
  CLIENT_KEY_MAX,
  CLIENT_KEY_PATTERN,
  CONVERSATION_DESCRIPTION_MAX,
  CONVERSATION_TITLE_MAX,
  MENTIONS_MAX,
  MESSAGE_BODY_MAX,
  MESSAGE_BODY_MIN,
  REFERENCE_TARGETS,
  REFERENCES_MAX,
} from './constants';
import type { MessageReference } from './types';
import { isValidEntityId } from './ids';

/** Shape-only body guard — a non-object body fails every validator. */
export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateMessageBody(body: unknown): { ok: true; body: string } | { ok: false; error: string } {
  if (typeof body !== 'string') return { ok: false, error: 'نص الرسالة مطلوب' };
  const trimmed = body.trim();
  if (trimmed.length < MESSAGE_BODY_MIN) return { ok: false, error: 'نص الرسالة فارغ' };
  if (trimmed.length > MESSAGE_BODY_MAX) return { ok: false, error: `الرسالة طويلة جداً (الحد ${MESSAGE_BODY_MAX} حرف)` };
  return { ok: true, body: trimmed };
}

export function validateClientKey(clientKey: unknown): { ok: true; clientKey: string } | { ok: false; error: string } {
  if (clientKey === undefined || clientKey === null) return { ok: true, clientKey: '' };
  if (typeof clientKey !== 'string') return { ok: false, error: 'صيغة clientKey غير صالحة' };
  if (clientKey.length > CLIENT_KEY_MAX) return { ok: false, error: 'clientKey طويل جداً' };
  if (clientKey.length === 0) return { ok: true, clientKey: '' };
  if (!CLIENT_KEY_PATTERN.test(clientKey)) {
    return { ok: false, error: 'صيغة clientKey غير صالحة (8-64 حرفاً: أرقام، أحرف لاتينية، - و _)' };
  }
  return { ok: true, clientKey };
}

export function validateConversationTitle(title: unknown, required: boolean): { ok: true; title: string | null } | { ok: false; error: string } {
  if (title === undefined || title === null || title === '') {
    return required ? { ok: false, error: 'عنوان المجموعة مطلوب' } : { ok: true, title: null };
  }
  if (typeof title !== 'string') return { ok: false, error: 'عنوان غير صالح' };
  const trimmed = title.trim();
  if (!trimmed) return required ? { ok: false, error: 'عنوان المجموعة مطلوب' } : { ok: true, title: null };
  if (trimmed.length > CONVERSATION_TITLE_MAX) return { ok: false, error: `العنوان طويل جداً (الحد ${CONVERSATION_TITLE_MAX} حرف)` };
  return { ok: true, title: trimmed };
}

export function validateConversationDescription(description: unknown): { ok: true; description: string | null } | { ok: false; error: string } {
  if (description === undefined || description === null || description === '') return { ok: true, description: null };
  if (typeof description !== 'string') return { ok: false, error: 'وصف غير صالح' };
  const trimmed = description.trim();
  if (!trimmed) return { ok: true, description: null };
  if (trimmed.length > CONVERSATION_DESCRIPTION_MAX) return { ok: false, error: `الوصف طويل جداً (الحد ${CONVERSATION_DESCRIPTION_MAX} حرف)` };
  return { ok: true, description: trimmed };
}

/**
 * Validate the mentions array: a list of well-formed user ids (the
 * MEMBERSHIP check — mentions must be active members — happens in the
 * service where the member records are already loaded).
 */
export function validateMentions(mentions: unknown): { ok: true; mentions: string[] | null } | { ok: false; error: string } {
  if (mentions === undefined || mentions === null) return { ok: true, mentions: null };
  if (!Array.isArray(mentions)) return { ok: false, error: 'قائمة الإشارات غير صالحة' };
  if (mentions.length > MENTIONS_MAX) return { ok: false, error: `عدد الإشارات يتجاوز الحد (${MENTIONS_MAX})` };
  for (const m of mentions) {
    if (!isValidEntityId(m)) return { ok: false, error: 'معرّف إشارة غير صالح' };
  }
  const unique = Array.from(new Set(mentions as string[]));
  return { ok: true, mentions: unique.length > 0 ? unique : null };
}

/**
 * Validate internal record references against the REFERENCE_TARGETS
 * allowlist (existence validation happens in the service via getById).
 */
export function validateReferences(references: unknown): { ok: true; references: MessageReference[] | null } | { ok: false; error: string } {
  if (references === undefined || references === null) return { ok: true, references: null };
  if (!Array.isArray(references)) return { ok: false, error: 'قائمة الارتباطات غير صالحة' };
  if (references.length > REFERENCES_MAX) return { ok: false, error: `عدد الارتباطات يتجاوز الحد (${REFERENCES_MAX})` };
  const out: MessageReference[] = [];
  for (const raw of references) {
    if (!isJsonObject(raw)) return { ok: false, error: 'ارتباط غير صالح' };
    const { type, id, title } = raw as Record<string, unknown>;
    if (typeof type !== 'string' || !(type in REFERENCE_TARGETS)) {
      return { ok: false, error: 'نوع الارتباط غير مدعوم' };
    }
    if (!isValidEntityId(id)) return { ok: false, error: 'معرّف الارتباط غير صالح' };
    out.push({
      type: type as MessageReference['type'],
      id: id as string,
      title: typeof title === 'string' ? title.slice(0, 200) : null,
    });
  }
  return { ok: true, references: out.length > 0 ? out : null };
}

/** Parse a bounded positive integer query param (limit/size). */
export function parseBoundedIntParam(
  raw: string | null,
  fallback: number,
  max: number,
): number {
  if (raw === null || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}
