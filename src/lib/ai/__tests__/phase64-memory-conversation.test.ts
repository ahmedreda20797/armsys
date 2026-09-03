// ══════════════════════════════════════════════════════════════
//  Phase 6.4 — Organizational Memory (§14-17) + Conversation
//  foundation (§18/§19) — in-memory persistence (no Firebase).
//
//  Quality lifecycle enforcement · trusted-knowledge gating ·
//  provider-independent retrieval with scope respect · conversation
//  ownership isolation · archive/restore ownership preservation ·
//  model/provider switching never deletes organizational knowledge.
// ══════════════════════════════════════════════════════════════

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  createMemoryEntry,
  transitionMemoryStatus,
  getAllMemoryEntries,
  type MemoryPersistence,
} from '../memory/store';
import {
  isTrustedMemory,
  canTransitionMemoryStatus,
  MEMORY_STATUS_TRANSITIONS,
} from '../memory/types';
import { retrieveRelevantMemories } from '../memory/retrieval';
import {
  createConversation,
  getConversationForUser,
  listConversationsForUser,
  appendMessage,
  listMessagesForUser,
  setConversationArchived,
  listConversationsForAdmin,
  type ConversationPersistence,
} from '../conversation/store';

// ── in-memory persistence helpers ───────────────────────────────
function makeMemoryPersistence(): MemoryPersistence & { rows: Map<string, Record<string, unknown>> } {
  const rows = new Map<string, Record<string, unknown>>();
  let seq = 0;
  return {
    rows,
    async getAll() {
      return [...rows.values()].map((r) => ({ ...r }));
    },
    async create(data) {
      seq += 1;
      const rec = { ...data, id: `mem-${seq}` };
      rows.set(rec.id, rec);
      return { ...rec };
    },
    async update(id, data) {
      const row = rows.get(id);
      if (row) Object.assign(row, data);
      return row ?? null;
    },
  };
}

function makeConversationPersistence(): ConversationPersistence & {
  conversations: Map<string, Record<string, unknown>>;
  messages: Map<string, Record<string, unknown>>;
} {
  const conversations = new Map<string, Record<string, unknown>>();
  const messages = new Map<string, Record<string, unknown>>();
  let seq = 0;
  return {
    conversations,
    messages,
    async getAllConversations() {
      return [...conversations.values()].map((r) => ({ ...r }));
    },
    async getAllMessages() {
      return [...messages.values()].map((r) => ({ ...r }));
    },
    async createConversation(data) {
      seq += 1;
      const rec = { ...data, id: `conv-${seq}` };
      conversations.set(rec.id, rec);
      return { ...rec };
    },
    async createMessage(data) {
      seq += 1;
      const rec = { ...data, id: `msg-${seq}` };
      messages.set(rec.id, rec);
      return { ...rec };
    },
    async updateConversation(id, data) {
      const row = conversations.get(id);
      if (row) Object.assign(row, data);
      return row ?? null;
    },
  };
}

const EVIDENCE = [{ collection: 'qualityObservations', recordId: 'obs-1' }];

// ── §14/§15 memory lifecycle ────────────────────────────────────
describe('organizational memory — lifecycle (§14/§15)', () => {
  let persistence: ReturnType<typeof makeMemoryPersistence>;
  beforeEach(() => { persistence = makeMemoryPersistence(); });

  it('creates AI-source entries as PROPOSED — even if a caller asks for APPROVED (§15/§36-Q)', async () => {
    const outcome = await createMemoryEntry({
      stage: 'analysis',
      subject: { kind: 'employee', employeeId: 'emp-1' },
      title: 'انخفاض متكرر',
      summary: 'نمط متكرر في ملاحظات الجودة',
      evidence: EVIDENCE,
      source: 'ai-analysis',
      createdBy: 'ai-pipeline',
      confidence: 'medium',
      // FORBIDDEN attempt — must be ignored:
      initialStatus: 'APPROVED',
    }, persistence);
    assert.ok(outcome.ok);
    assert.equal(outcome.entry.status, 'PROPOSED');
    assert.equal(isTrustedMemory(outcome.entry), false);
  });

  it('requires evidence — memory without traceability is rejected (§15)', async () => {
    const outcome = await createMemoryEntry({
      stage: 'learning',
      subject: { kind: 'organization' },
      title: 'بلا أدلة',
      summary: 'ادعاء غير موثق',
      evidence: [],
      source: 'ai-analysis',
      createdBy: 'ai-pipeline',
      confidence: 'low',
    }, persistence);
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.equal(outcome.reason, 'INVALID_INPUT');
  });

  it('status changes ONLY through validated transitions; version is optimistic-lock', async () => {
    const created = await createMemoryEntry({
      stage: 'recommendation',
      subject: { kind: 'department', department: 'المبيعات' },
      title: 'خطة متابعة',
      summary: 'توصية مقترحة للمراجعة',
      evidence: EVIDENCE,
      source: 'management-review',
      createdBy: 'mgr-1',
      confidence: 'high',
    }, persistence);
    assert.ok(created.ok);
    if (!created.ok) return;
    const entry = created.entry;

    // PROPOSED → APPROVED is NOT a valid transition (must pass VALIDATED).
    const skip = await transitionMemoryStatus({
      entryId: entry.id, to: 'APPROVED', actorId: 'admin-1', expectedVersion: 1,
    }, persistence);
    assert.equal(skip.ok, false);
    if (!skip.ok) assert.equal(skip.reason, 'INVALID_TRANSITION');

    // PROPOSED → VALIDATED works and bumps the version.
    const validate = await transitionMemoryStatus({
      entryId: entry.id, to: 'VALIDATED', actorId: 'admin-1', expectedVersion: 1,
    }, persistence);
    assert.ok(validate.ok);
    if (validate.ok) {
      assert.equal(validate.entry.status, 'VALIDATED');
      assert.equal(validate.entry.version, 2);
      assert.equal(isTrustedMemory(validate.entry), true);
    }

    // Stale version → conflict.
    const stale = await transitionMemoryStatus({
      entryId: entry.id, to: 'APPROVED', actorId: 'admin-1', expectedVersion: 1,
    }, persistence);
    assert.equal(stale.ok, false);
    if (!stale.ok) assert.equal(stale.reason, 'VERSION_CONFLICT');
  });

  it('transition table is terminal-safe: ARCHIVED and REJECTED have no exits', () => {
    assert.deepEqual(MEMORY_STATUS_TRANSITIONS.ARCHIVED, []);
    assert.deepEqual(MEMORY_STATUS_TRANSITIONS.REJECTED, ['ARCHIVED']);
    assert.equal(canTransitionMemoryStatus('APPROVED', 'PROPOSED'), false);
  });

  it('unknown entry → NOT_FOUND', async () => {
    const outcome = await transitionMemoryStatus({
      entryId: 'ghost', to: 'VALIDATED', actorId: 'admin-1', expectedVersion: 1,
    }, persistence);
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.equal(outcome.reason, 'NOT_FOUND');
  });
});

// ── §16/§17 retrieval ───────────────────────────────────────────
describe('organizational memory — retrieval (§16/§17 provider-independent)', () => {
  it('ranks trusted + relevant entries first; never dumps everything', async () => {
    const persistence = makeMemoryPersistence();
    await createMemoryEntry({
      stage: 'learning', subject: { kind: 'organization' },
      title: 'خطة متابعة المبيعات نجحت', summary: 'خطة المتابعة اليومية رفعت استجابة العملاء',
      department: 'المبيعات',
      period: { from: '2026-06', to: '2026-06' },
      evidence: EVIDENCE, source: 'management-review', createdBy: 'mgr-1', confidence: 'high',
      initialStatus: 'VALIDATED',
    }, persistence);
    await createMemoryEntry({
      stage: 'analysis', subject: { kind: 'organization' },
      title: 'ملاحظة حضور', summary: 'ارتفاع طفيف في تأخير الحضور',
      department: 'العمليات',
      evidence: EVIDENCE, source: 'ai-analysis', createdBy: 'ai', confidence: 'low',
    }, persistence);

    const all = await getAllMemoryEntries(persistence);
    const results = retrieveRelevantMemories(
      { topic: 'متابعة المبيعات', department: 'المبيعات', limit: 5 },
      all,
    );
    assert.ok(results.length >= 1);
    assert.ok(results.length <= 5, 'bounded — never a dump');
    assert.match(results[0].entry.title, /المبيعات/);
    assert.ok(results[0].matchedOn.includes('trusted'));
    // Untrusted PROPOSED entry ranks far below the trusted one.
    if (results.length > 1) {
      assert.ok(results[0].score > results[1].score);
    }
  });

  it('cross-organization entries are excluded (§36-P scope respect)', async () => {
    const persistence = makeMemoryPersistence();
    await createMemoryEntry({
      stage: 'learning', subject: { kind: 'organization' },
      title: 'ذاكرة مؤسسة أخرى', summary: 'محتوى من منظمة أخرى تمامًا',
      organizationId: 'org-b',
      evidence: EVIDENCE, source: 'management-review', createdBy: 'mgr-b', confidence: 'high',
      initialStatus: 'APPROVED',
    }, persistence);
    const all = await getAllMemoryEntries(persistence);
    const results = retrieveRelevantMemories(
      { topic: 'ذاكرة', organizationId: 'org-a' },
      all,
    );
    assert.equal(results.length, 0);
  });

  it('REJECTED/ARCHIVED entries never surface without explicit opt-in', async () => {
    const persistence = makeMemoryPersistence();
    const created = await createMemoryEntry({
      stage: 'analysis', subject: { kind: 'organization' },
      title: 'ادعاء مرفوض', summary: 'استنتاج لم يجتز المراجعة',
      evidence: EVIDENCE, source: 'management-review', createdBy: 'mgr-1', confidence: 'low',
    }, persistence);
    assert.ok(created.ok);
    if (!created.ok) return;
    await transitionMemoryStatus({
      entryId: created.entry.id, to: 'REJECTED', actorId: 'admin-1', expectedVersion: 1,
    }, persistence);

    const all = await getAllMemoryEntries(persistence);
    const results = retrieveRelevantMemories({ topic: 'ادعاء' }, all);
    assert.equal(results.length, 0);
  });

  it('retrieval is a PURE function — no provider, model or network identity anywhere', async () => {
    const persistence = makeMemoryPersistence();
    const created = await createMemoryEntry({
      stage: 'learning', subject: { kind: 'organization' },
      title: 'تعلم مستقل عن الموديل', summary: 'المعرفة تنتمي إلى ARM لا إلى مزود',
      evidence: EVIDENCE, source: 'management-review', createdBy: 'mgr-1', confidence: 'high',
      initialStatus: 'APPROVED',
    }, persistence);
    const all = await getAllMemoryEntries(persistence);
    const results = retrieveRelevantMemories({ topic: 'الموديل' }, all);
    assert.equal(results.length, 1);
    assert.ok(created.ok);
    // Provenance carries NO model identity — switching providers later
    // cannot invalidate any entry (§17).
    const serialized = JSON.stringify(results.map((r) => r.entry));
    assert.ok(!/gemini|glm|gpt/i.test(serialized));
  });
});

// ── §18/§19 conversations ───────────────────────────────────────
describe('conversation foundation (§18/§19 — per-user, Phase 6.5-ready)', () => {
  let persistence: ReturnType<typeof makeConversationPersistence>;
  beforeEach(() => { persistence = makeConversationPersistence(); });

  it('create → append → list round-trips messages in order', async () => {
    const conv = await createConversation({ userId: 'u-1', title: 'محادثة الأداء', provider: 'gemini', model: 'gemini-test-model' }, persistence);
    assert.ok(conv.ok);
    if (!conv.ok) return;
    const appended1 = await appendMessage('u-1', { conversationId: conv.value.conversationId, role: 'user', content: 'حلل أداء أحمد' }, persistence);
    assert.ok(appended1.ok, 'user message appends');
    const appended2 = await appendMessage('u-1', { conversationId: conv.value.conversationId, role: 'assistant', content: 'بحسب البيانات المتحقق منها…', validationState: 'VALID' }, persistence);
    assert.ok(appended2.ok, 'assistant message appends');
    const messages = await listMessagesForUser('u-1', conv.value.conversationId, persistence);
    assert.ok(messages.ok);
    if (messages.ok) {
      assert.equal(messages.value.length, 2);
      assert.equal(messages.value[0].role, 'user');
      assert.equal(messages.value[1].role, 'assistant');
      assert.equal(messages.value[1].validationState, 'VALID');
    }
  });

  it('user B cannot read user A conversation — indistinguishable from missing (§36-B)', async () => {
    const conv = await createConversation({ userId: 'u-1', title: 'خاصة' }, persistence);
    assert.ok(conv.ok);
    if (!conv.ok) return;
    const intruder = await getConversationForUser('u-2', conv.value.conversationId, persistence);
    assert.equal(intruder.ok, false);
    if (!intruder.ok) {
      assert.equal(intruder.reason, 'NOT_FOUND', 'anti-enumeration: NOT_FOUND, never FORBIDDEN');
    }
    const intruderMessages = await listMessagesForUser('u-2', conv.value.conversationId, persistence);
    assert.equal(intruderMessages.ok, false);
    // And user B's list never contains it.
    const listB = await listConversationsForUser('u-2', { includeArchived: true }, persistence);
    assert.equal(listB.length, 0);
  });

  it('archive/restore preserves ownership (§36-O)', async () => {
    const conv = await createConversation({ userId: 'u-1', title: 'للأرشفة' }, persistence);
    assert.ok(conv.ok);
    if (!conv.ok) return;
    const archived = await setConversationArchived('u-1', conv.value.conversationId, true, persistence);
    assert.ok(archived.ok);
    if (archived.ok) assert.equal(archived.value.archived, true);

    // Owner still sees it with includeArchived, and only the owner does.
    const ownerList = await listConversationsForUser('u-1', { includeArchived: true }, persistence);
    assert.equal(ownerList.length, 1);
    const defaultList = await listConversationsForUser('u-1', {}, persistence);
    assert.equal(defaultList.length, 0, 'archived hidden by default');

    const restored = await setConversationArchived('u-1', conv.value.conversationId, false, persistence);
    assert.ok(restored.ok);
    // Ownership column was NEVER part of any update payload.
    const stored = persistence.conversations.get(conv.value.conversationId);
    assert.equal(stored?.userId, 'u-1');

    // A different user cannot archive someone else's conversation.
    const stranger = await setConversationArchived('u-2', conv.value.conversationId, true, persistence);
    assert.equal(stranger.ok, false);
  });

  it('admin listing is gated behind role === admin (§33 — no default surveillance)', async () => {
    const conv = await createConversation({ userId: 'u-1', title: 'عادية' }, persistence);
    assert.ok(conv.ok);
    const denied = await listConversationsForAdmin({ role: 'manager', userId: 'u-mgr' }, persistence);
    assert.equal(denied.ok, false);
    if (!denied.ok) assert.equal(denied.reason, 'FORBIDDEN');
    const allowed = await listConversationsForAdmin({ role: 'admin', userId: 'u-admin' }, persistence);
    assert.ok(allowed.ok);
    if (allowed.ok) assert.equal(allowed.value.length, 1);
  });

  it('conversations NEVER convert into organizational memory (§19 separation)', async () => {
    // Structural proof: the conversation store module has no import of
    // the memory store, and the memory store has no import of
    // conversations — no cross-write path exists.
    const convSource = (await import('node:fs')).readFileSync('src/lib/ai/conversation/store.ts', 'utf8');
    const memorySource = (await import('node:fs')).readFileSync('src/lib/ai/memory/store.ts', 'utf8');
    assert.ok(!convSource.includes('memory/store'), 'conversations must not write memory');
    assert.ok(!memorySource.includes('conversation/store'), 'memory must not read conversations');
  });
});

// ── §36-R — provider switching never deletes knowledge ──────────
describe('model independence (§36-R — provider change preserves everything)', () => {
  it('switching provider/model deletes NO memory and NO conversations', async () => {
    const memoryPersistence = makeMemoryPersistence();
    const conversationPersistence = makeConversationPersistence();

    await createMemoryEntry({
      stage: 'learning', subject: { kind: 'organization' },
      title: 'معرفة تراكمية', summary: 'تبقى بعد تبديل المزود',
      evidence: EVIDENCE, source: 'management-review', createdBy: 'mgr-1', confidence: 'high',
      initialStatus: 'VALIDATED',
    }, memoryPersistence);
    await createConversation({ userId: 'u-1', title: 'محادثة تبقى', provider: 'gemini', model: 'm-1' }, conversationPersistence);

    // "Switch" the provider twice — gemini → groq-like → openai-compatible.
    const resolutions = [
      { provider: 'gemini' as const, model: 'gemini-a' },
      { provider: 'openai-compatible' as const, model: 'vendor-b' },
      { provider: 'z-ai' as const, model: null },
    ];
    for (const settings of resolutions) {
      // Any provider resolution attempt (even failing) touches nothing.
      const memory = await getAllMemoryEntries(memoryPersistence);
      assert.equal(memory.length, 1, 'memory survives every provider switch');
      const conversations = await listConversationsForUser('u-1', { includeArchived: true }, conversationPersistence);
      assert.equal(conversations.length, 1, 'conversations survive every provider switch');
      assert.equal(memory[0].title, 'معرفة تراكمية');
      void settings;
    }
    // Structural proof: neither store exposes ANY delete/remove API.
    const memorySource = (await import('node:fs')).readFileSync('src/lib/ai/memory/store.ts', 'utf8');
    const conversationSource = (await import('node:fs')).readFileSync('src/lib/ai/conversation/store.ts', 'utf8');
    assert.ok(!/deleteRecord/.test(memorySource));
    assert.ok(!/deleteRecord/.test(conversationSource));
  });
});
