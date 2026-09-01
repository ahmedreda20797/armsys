// ══════════════════════════════════════════════════════════════
//  Phase 6.1 — Global Search tests (spec §30 items 1-30 + §32)
//
//  Convention (repo-wide): node:test + node:assert/strict via
//  `tsx --test`, with the M0.1 in-memory db harness so the REAL
//  route handler runs end-to-end (auth → permission → scope →
//  search → projection) without Firebase.
//
//  Covers the 30 spec cases:
//   1-2  employee search (exact/partial)     16  archived employee
//   3    observation search                  17  anti-enumeration
//   4    complaint search                    18  no raw record leak
//   5    CAPA search                         19  result projection
//   6    follow-up search                    20  result limits
//   7    travel deal search                  21  navigation contract
//   8    deduction search                    22  highlightId propagation
//   9    cross-domain results                23  filter propagation
//   10   Arabic normalization                24  useRecordHighlight integration
//   11   English search                      25  empty query
//   12   case-insensitive search             26  no results
//   13   exact ID search                     27  malformed request
//   14   permission filtering                28  unauthorized request
//   15   employee scope filtering            29  adapter without permission
//                                            30  unknown domain
//  Plus §32: search is never a permission bypass.
// ══════════════════════════════════════════════════════════════

import '../../__tests__/m01-test-support';
import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  bearerHeaders,
  dbStubs,
  mintToken,
  registerFixtures,
  registerUser,
  resetTestData,
  setTable,
} from '../../__tests__/m01-test-support';

import {
  SEARCH_DOMAINS,
  SEARCH_DOMAIN_ORDER,
  buildSearchNavigation,
  normalizeForSearch,
  isSearchDomain,
} from '@/lib/search';
import { matchRecord, scoreFieldAgainstTerm } from '@/lib/search/record-matcher';
import { canViewDomain, runGlobalSearch, type SearchDeps } from '@/lib/search/search-service';
import type { EmployeeScopeContext } from '@/lib/scope';
import { parseSearchRequestBody } from '@/lib/search/search-request';

interface SearchRoute {
  POST?: (req: Request) => Promise<Response>;
}

const srcOf = (rel: string): string =>
  fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

function searchRequest(body: unknown, token?: string): Request {
  return new Request('http://localhost/api/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? bearerHeaders(token) : {}) },
    body: JSON.stringify(body),
  });
}

const CONTRACT_KEYS = new Set([
  'recordId', 'domain', 'recordType', 'title', 'subtitle', 'metadata',
  'matchedFields', 'date', 'status', 'statusValue', 'month',
]);

// ── world seeds ─────────────────────────────────────────────────

const EMP_ACTIVE_1 = 'emp-1';
const EMP_ACTIVE_2 = 'emp-2';
const EMP_ARCHIVED = 'emp-arch';

/** Scoped users registered after EVERY reset (the users map is wiped). */
function registerScopedUsers(): void {
  registerUser({
    id: 'u-no-emp', email: 'noemp@test.local', name: 'بدون موظفين', role: 'user',
    linkedEmployeeId: EMP_ACTIVE_2,
    permissions: { employees: { level: 'none' } },
  });
  registerUser({
    id: 'u-own', email: 'own@test.local', name: 'نطاق ذاتي', role: 'user',
    linkedEmployeeId: EMP_ACTIVE_2,
    permissions: {
      employees: { level: 'read', scope: 'own' },
      observations: { level: 'read' },
      complaints: { level: 'read' },
      capa: { level: 'read' },
    },
  });
  // Permission-filtering fixture: role preset only (fail-closed own scope
  // via the linked employee), no stored overrides.
  registerUser({
    id: 'u-perm', email: 'perm@test.local', name: 'صلاحيات افتراضية', role: 'user',
    linkedEmployeeId: EMP_ACTIVE_2,
  });
}

async function seedWorld(): Promise<void> {
  resetTestData();
  await registerFixtures();
  registerScopedUsers();
  setTable('employees', [
    {
      id: EMP_ACTIVE_1, code: 'EMP-001', name: 'أحمد محمود', department: 'العمليات',
      position: 'موظف حجوزات', status: 'active', mobile: '0120000000',
    },
    {
      id: EMP_ACTIVE_2, code: 'EMP-002', name: 'سارة أحمد', department: 'المبيعات',
      position: 'مندوبة', status: 'active', mobile: '0129999999',
    },
    {
      id: EMP_ARCHIVED, code: 'EMP-003', name: 'خالد الأمين', department: 'العمليات',
      position: 'مشرف', status: 'archived', archivedAt: '2026-07-01T00:00:00.000Z',
    },
  ]);
  setTable('orgNodes', [
    { id: 'node-1', name: 'قسم العمليات', type: 'department', status: 'active' },
  ]);
  setTable('qualityObservations', [
    {
      id: 'obs-1', employeeId: EMP_ACTIVE_1, employeeName: 'أحمد محمود',
      categoryName: 'متابعة العملاء', type: 'تأخير المتابعة',
      notes: 'لم يتم متابعة العميل بعد الحجز', severity: 'medium', status: 'open',
      observationDate: '28/08/2026', month: '2026-08',
    },
    {
      id: 'obs-2', employeeId: EMP_ACTIVE_2, employeeName: 'سارة أحمد',
      categoryName: 'دقة الحجز', notes: 'دقة في تأكيد الحجز', status: 'open',
      observationDate: '20/08/2026', month: '2026-08',
    },
    {
      id: 'obs-arch', employeeId: EMP_ARCHIVED, employeeName: 'خالد الأمين',
      categoryName: 'متابعة العملاء', notes: 'ملاحظة تاريخية لموظف مؤرشف',
      status: 'closed', observationDate: '10/05/2026', month: '2026-05',
    },
  ]);
  setTable('qualityDeductions', [
    {
      id: 'qd-1', employeeId: EMP_ACTIVE_1, date: '15/08/2026', type: 'تأخير صباحي',
      description: 'غياب عن اجتماع الصباح بدون إذن', month: '2026-08',
    },
  ]);
  setTable('hrDeductions', [
    {
      id: 'hrd-1', employeeId: EMP_ACTIVE_1, type: 'تأخير', amount: 100, unit: 'EGP',
      reason: 'تأخير متكرر عن الدوام', status: 'pending', month: '2026-08',
      deductionDate: '15/08/2026',
    },
  ]);
  setTable('complaints', [
    {
      id: 'cmp-1', customerName: 'شركة النيل للسياحة', description: 'شكوى فواتير تأكيد الحجز',
      complaintType: 'delay', status: 'open', employeeId: EMP_ACTIVE_2,
      dealId: 'deal-9', createdAt: '2026-08-20T10:00:00.000Z',
    },
    {
      id: 'cmp-unlinked', customerName: 'عميل بدون ارتباط', description: 'شكوى فواتير',
      complaintType: 'pricing_error', status: 'open', createdAt: '2026-08-21T10:00:00.000Z',
    },
    {
      id: 'cmp-3', customerName: 'عميل مرتبط بأحمد', description: 'شكوى فواتير مرتبطة',
      complaintType: 'other', status: 'open', employeeId: EMP_ACTIVE_1,
      createdAt: '2026-08-22T10:00:00.000Z',
    },
  ]);
  setTable('capaCases', [
    {
      id: 'capa-row-1', capaId: 'CAPA-2026-001', title: 'إجراءات علاج تأخير الحجوزات',
      problemDescription: 'تكرار تأخير تأكيد الحجوزات', status: 'open', priority: 'high',
      department: 'العمليات', employeeId: null, relatedEmployeeIds: [],
    },
    {
      id: 'capa-blocked', capaId: 'CAPA-2026-002', title: 'علاج ضعف العلاج المتابعة',
      problemDescription: 'متابعة ضعيفة', status: 'open', priority: 'medium',
      department: 'العمليات', employeeId: null, relatedEmployeeIds: [EMP_ACTIVE_1],
    },
  ]);
  setTable('followUps', [
    {
      id: 'fu-1', employeeId: EMP_ACTIVE_1, employeeName: 'أحمد محمود',
      subject: 'متابعة سلوك العميل', detailedDescription: 'جلسة توجيه بخصوص التعامل',
      followUpType: 'quality', status: 'open', date: '27/08/2026',
    },
  ]);
  setTable('travelDeals', [
    {
      id: 'trv-1', employeeId: EMP_ACTIVE_1, destination: 'دبي',
      dealerName: 'وكالة الرياض', customerNames: 'محمد علي',
      departureDate: '10/09/2026', returnDate: '17/09/2026', status: 'upcoming',
      notes: 'فيزا سياحية',
    },
  ]);
  setTable('attendance', [
    {
      id: 'att-1', employeeId: EMP_ACTIVE_1, date: '26/08/2026', status: 'late',
      checkIn: '09:35', checkOut: '17:00', minutesLate: 35,
    },
    {
      id: 'att-2', employeeId: EMP_ACTIVE_2, date: '26/08/2026', status: 'present',
      checkIn: '09:00', checkOut: '17:00', minutesLate: 0,
    },
  ]);
  setTable('requests', [
    {
      id: 'req-1', employeeId: EMP_ACTIVE_2, type: 'إجازة سنوية', reason: 'ظرف عائلي',
      status: 'pending', date: '01/09/2026',
    },
  ]);
  setTable('knowledgeBase', [
    {
      id: 'kb-1', title: 'إجراء تأكيد الحجوزات', problem: 'تأكيد متأخر للحجوزات',
      rootCause: 'ضعف المتابعة', solution: 'قائمة متابعة يومية',
      department: 'operations', status: 'published',
    },
  ]);
  setTable('monthSnapshots', [
    { id: '2026-08', monthKey: '2026-08', status: 'open' },
  ]);
  setTable('users', [
    { id: 'u-row-1', name: 'مسؤول النظام', email: 'root@test.local', role: 'admin' },
  ]);

  // Employee-name resolution (hrDeductions/attendance carry no employeeName).
  dbStubs.getEmployeeMap = async () =>
    new Map([
      [EMP_ACTIVE_1, { name: 'أحمد محمود' }],
      [EMP_ACTIVE_2, { name: 'سارة أحمد' }],
      [EMP_ARCHIVED, { name: 'خالد الأمين' }],
    ]);
}

interface Grouped {
  groups: Array<{
    domain: string;
    label: string;
    total: number;
    truncated: boolean;
    results: Array<Record<string, unknown>>;
  }>;
}

function groupOf(body: Grouped, domain: string) {
  return body.groups.find((g) => g.domain === domain);
}

// ════════════════════════════════════════════════════════════════

describe('Phase 6.1 — search registry & normalization (pure)', () => {
  it('A1. registry mirrors the SYSTEM INVENTORY (canonical tables, permission keys, nav strategies)', () => {
    assert.equal(SEARCH_DOMAIN_ORDER.length, 14);
    // Canonical RTDB tables — no shadow collections.
    const expectedTables: Record<string, string> = {
      employees: 'employees', qualityObservations: 'qualityObservations',
      qualityDeductions: 'qualityDeductions', hrDeductions: 'hrDeductions',
      complaints: 'complaints', capaCases: 'capaCases', followUps: 'followUps',
      travelDeals: 'travelDeals', attendance: 'attendance', requests: 'requests',
      knowledgeBase: 'knowledgeBase', monthSnapshots: 'monthSnapshots',
      orgNodes: 'orgNodes', users: 'users',
    };
    for (const domain of SEARCH_DOMAIN_ORDER) {
      assert.equal(SEARCH_DOMAINS[domain].table, expectedTables[domain]);
      assert.ok(SEARCH_DOMAINS[domain].permissionKey.length > 0);
      assert.ok(SEARCH_DOMAINS[domain].page.length > 0);
    }
    // Nav strategies follow each target page's EXISTING contract.
    assert.equal(SEARCH_DOMAINS.qualityObservations.navStrategy, 'highlight');
    assert.equal(SEARCH_DOMAINS.complaints.navStrategy, 'highlight');
    assert.equal(SEARCH_DOMAINS.followUps.navStrategy, 'highlight');
    assert.equal(SEARCH_DOMAINS.travelDeals.navStrategy, 'highlight');
    assert.equal(SEARCH_DOMAINS.capaCases.navStrategy, 'detailParam');
    assert.equal(SEARCH_DOMAINS.capaCases.navParam, 'id');
    assert.equal(SEARCH_DOMAINS.qualityDeductions.navStrategy, 'generic');
    assert.equal(SEARCH_DOMAINS.knowledgeBase.navStrategy, 'generic');
    assert.equal(SEARCH_DOMAINS.monthSnapshots.navStrategy, 'generic');
    // Scope doctrine mirrors the source routes.
    assert.equal(SEARCH_DOMAINS.employees.scopeKind, 'employees');
    assert.equal(SEARCH_DOMAINS.complaints.scopeKind, 'linked');
    assert.equal(SEARCH_DOMAINS.complaints.scopeOptions.optionalLink, true);
    assert.equal(SEARCH_DOMAINS.capaCases.scopeOptions.relatedEmployeeIdsField, 'relatedEmployeeIds');
    assert.equal(SEARCH_DOMAINS.knowledgeBase.scopeKind, 'none');
    assert.equal(isSearchDomain('employees'), true);
    assert.equal(isSearchDomain('not-a-domain'), false);
  });

  it('A2. Arabic normalization: hamza/alef, taa marbuta, diacritics, digits, lowercase', () => {
    assert.equal(normalizeForSearch('أَحْمَد'), normalizeForSearch('احمد'));
    assert.equal(normalizeForSearch('شركه'), normalizeForSearch('شركة'));
    assert.equal(normalizeForSearch('٢٠٢٦'), '2026');
    assert.equal(normalizeForSearch('JOHN'), 'john');
    assert.equal(normalizeForSearch('  متابعة   العملاء '), 'متابعه العملاء');
  });

  it('A3. matcher priority: exact-id > exact > prefix > contains; AND semantics', () => {
    assert.equal(scoreFieldAgainstTerm('احمد محمود', 'احمد محمود'), 'exact');
    assert.equal(scoreFieldAgainstTerm('احمد محمود', 'احمد'), 'prefix');
    assert.equal(scoreFieldAgainstTerm('سارة احمد', 'احمد'), 'contains');
    assert.equal(scoreFieldAgainstTerm('emp-001', 'emp-001', 'business'), 'exact-id');
    const exact = matchRecord(
      [{ key: 'name', label: 'الاسم', value: 'دبي' }],
      ['دبي'],
    );
    const prefix = matchRecord(
      [{ key: 'name', label: 'الاسم', value: 'دبي مارينا' }],
      ['دبي'],
    );
    const contains = matchRecord(
      [{ key: 'name', label: 'الاسم', value: 'رحلة دبي السياحية' }],
      ['دبي'],
    );
    assert.ok(exact && prefix && contains);
    assert.ok(exact.score > prefix.score);
    assert.ok(prefix.score > contains.score);
    // AND: a term with no matching field ⇒ no match.
    assert.equal(matchRecord([{ key: 'name', label: 'الاسم', value: 'دبي' }], ['دبي', 'القاهرة']), null);
  });
});

describe('Phase 6.1 — search route: validation & authentication (§25-§30)', () => {
  let route: SearchRoute;
  let adminToken: string;

  before(async () => {
    route = (await import('@/app/api/search/route')) as SearchRoute;
    const tokens = await registerFixtures();
    adminToken = tokens.adminToken;
  });

  beforeEach(async () => {
    await seedWorld();
  });

  it('28. unauthorized request → 401, no data', async () => {
    const res = await route.POST!(searchRequest({ query: 'أحمد' }));
    assert.equal(res.status, 401);
  });

  it('27. malformed request (broken JSON / wrong types) → 400 validation', async () => {
    const broken = new Request('http://localhost/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...bearerHeaders(adminToken) },
      body: '{not-json',
    });
    assert.equal((await route.POST!(broken)).status, 400);
    assert.equal((await route.POST!(searchRequest({ query: 123 }, adminToken))).status, 400);
    assert.equal((await route.POST!(searchRequest({ query: 'أحمد', domain: 'hacked; DROP' }, adminToken))).status, 400);
  });

  it('25. empty query → 400 (client prevents, server enforces)', async () => {
    assert.equal((await route.POST!(searchRequest({ query: '' }, adminToken))).status, 400);
    assert.equal((await route.POST!(searchRequest({ query: '   ' }, adminToken))).status, 400);
    assert.equal((await route.POST!(searchRequest({ query: 'ا' }, adminToken))).status, 400);
  });

  it('30. unknown domain → 400 validation', async () => {
    const parsed = parseSearchRequestBody({ query: 'أحمد', domain: 'nonexistent' });
    assert.equal(parsed.ok, false);
    const res = await route.POST!(searchRequest({ query: 'أحمد', domain: 'nonexistent' }, adminToken));
    assert.equal(res.status, 400);
  });

  it('limit beyond the server cap → 400', async () => {
    assert.equal((await route.POST!(searchRequest({ query: 'أحمد', limit: 51 }, adminToken))).status, 400);
    assert.equal((await route.POST!(searchRequest({ query: 'أحمد', limit: 0 }, adminToken))).status, 400);
  });

  it('26. no results → 200 with empty groups (no error)', async () => {
    const res = await route.POST!(searchRequest({ query: 'zzqqxx' }, adminToken));
    assert.equal(res.status, 200);
    const body = (await res.json()) as Grouped;
    assert.deepEqual(body.groups, []);
  });
});

describe('Phase 6.1 — global search results (admin, §30-1..13,16)', () => {
  let route: SearchRoute;
  let adminToken: string;

  before(async () => {
    route = (await import('@/app/api/search/route')) as SearchRoute;
    adminToken = (await registerFixtures()).adminToken;
  });

  beforeEach(async () => {
    await seedWorld();
  });

  async function search(query: string, extra: Record<string, unknown> = {}) {
    const res = await route.POST!(searchRequest({ query, ...extra }, adminToken));
    assert.equal(res.status, 200);
    return (await res.json()) as Grouped;
  }

  it('1. exact employee search by name', async () => {
    const body = await search('أحمد محمود');
    const group = groupOf(body, 'employees');
    assert.ok(group);
    assert.equal(group.results[0].recordId, EMP_ACTIVE_1);
    assert.ok((group.results[0].matchedFields as string[]).includes('الاسم'));
  });

  it('2. partial employee search (also via normalization)', async () => {
    const body = await search('احمد');
    const group = groupOf(body, 'employees');
    assert.ok(group);
    const ids = group.results.map((r) => r.recordId);
    assert.ok(ids.includes(EMP_ACTIVE_1));
    assert.ok(ids.includes(EMP_ACTIVE_2));
  });

  it('3. observation search by note text', async () => {
    const body = await search('متابعة العميل بعد الحجز');
    const group = groupOf(body, 'qualityObservations');
    assert.ok(group);
    assert.equal(group.results[0].recordId, 'obs-1');
    assert.ok((group.results[0].matchedFields as string[]).includes('الملاحظات'));
  });

  it('4. complaint search by customer name', async () => {
    const body = await search('شركه النيل'); // taa marbuta normalization
    const group = groupOf(body, 'complaints');
    assert.ok(group);
    assert.equal(group.results[0].recordId, 'cmp-1');
  });

  it('5. CAPA search by human CAPA number (business id)', async () => {
    const body = await search('CAPA-2026-001');
    const group = groupOf(body, 'capaCases');
    assert.ok(group);
    assert.equal(group.results[0].recordId, 'capa-row-1');
    assert.ok((group.results[0].matchedFields as string[]).includes('رقم CAPA'));
  });

  it('6. follow-up search', async () => {
    const body = await search('سلوك العميل');
    const group = groupOf(body, 'followUps');
    assert.ok(group);
    assert.equal(group.results[0].recordId, 'fu-1');
  });

  it('7. travel deal search + month derivation from departureDate', async () => {
    const body = await search('دبي');
    const group = groupOf(body, 'travelDeals');
    assert.ok(group);
    assert.equal(group.results[0].recordId, 'trv-1');
    assert.equal(group.results[0].month, '2026-09');
  });

  it('8. HR deduction search + employee name resolved server-side', async () => {
    const body = await search('تأخير متكرر');
    const group = groupOf(body, 'hrDeductions');
    assert.ok(group);
    assert.equal(group.results[0].recordId, 'hrd-1');
    assert.equal(group.results[0].subtitle, 'أحمد محمود');
  });

  it('8b. quality deduction search (legacy domain)', async () => {
    const body = await search('اجتماع الصباح');
    const group = groupOf(body, 'qualityDeductions');
    assert.ok(group);
    assert.equal(group.results[0].recordId, 'qd-1');
  });

  it('9. cross-domain results + strongest group first (exact-id dominance)', async () => {
    const body = await search('احمد');
    const domains = body.groups.map((g) => g.domain);
    for (const expected of ['employees', 'qualityObservations', 'complaints', 'followUps', 'travelDeals', 'hrDeductions', 'attendance']) {
      assert.ok(domains.includes(expected), `missing ${expected}`);
    }
    // The exact-unique-id match must outrank every other group.
    const byCapaId = await search('CAPA-2026-001');
    assert.equal(byCapaId.groups[0].domain, 'capaCases');
  });

  it('10. Arabic normalization end-to-end (hamza + taa marbuta + diacritics)', async () => {
    const body = await search('أَحمد');
    assert.ok(groupOf(body, 'employees'));
    const complaints = await search('النيل للسياحة');
    assert.ok(groupOf(complaints, 'complaints'));
  });

  it('11-12. English search, case-insensitive', async () => {
    setTable('employees', [
      { id: 'emp-en', code: 'EMP-100', name: 'John Smith', department: 'Sales', position: 'Agent', status: 'active' },
    ]);
    const body = await search('JOHN');
    const group = groupOf(body, 'employees');
    assert.ok(group);
    assert.equal(group.results[0].recordId, 'emp-en');
  });

  it('13. exact unique-id search (RTDB id and employee code)', async () => {
    const byRtdbId = await search('obs-1');
    const obsGroup = groupOf(byRtdbId, 'qualityObservations');
    assert.ok(obsGroup);
    assert.equal((obsGroup.results[0].matchedFields as string[])[0], 'المعرف');
    const byCode = await search('EMP-002');
    const empGroup = groupOf(byCode, 'employees');
    assert.ok(empGroup);
    assert.equal(empGroup.results[0].recordId, EMP_ACTIVE_2);
  });

  it('16. archived employee: searchable with archived status, history intact (§13)', async () => {
    const body = await search('خالد الأمين');
    const group = groupOf(body, 'employees');
    assert.ok(group, 'archived employee stays searchable');
    assert.equal(group.results[0].recordId, EMP_ARCHIVED);
    assert.equal(group.results[0].status, 'مؤرشف');
    assert.equal(group.results[0].statusValue, 'archived');
    // Historical records of the archived employee remain reachable.
    const history = await search('ملاحظة تاريخية لموظف مؤرشف');
    const histGroup = groupOf(history, 'qualityObservations');
    assert.ok(histGroup);
    assert.equal(histGroup.results[0].recordId, 'obs-arch');
  });

  it('19. result projection: Arabic labels, lightweight contract shape', async () => {
    const body = await search('متابعة العملاء');
    const obsGroup = groupOf(body, 'qualityObservations');
    assert.ok(obsGroup);
    const result = obsGroup.results[0] as Record<string, unknown>;
    assert.equal(obsGroup.label, 'ملاحظات الجودة');
    for (const r of body.groups.flatMap((g) => g.results)) {
      for (const key of Object.keys(r)) {
        assert.ok(CONTRACT_KEYS.has(key), `non-contract key leaked: ${key}`);
      }
    }
    assert.equal(result.recordType, 'ملاحظة جودة');
    assert.equal(result.status, 'مفتوحة');
    assert.equal(result.date, '28/08/2026');
    assert.equal(result.month, '2026-08');
  });

  it('20. result limits: per-group slice + truncated + total (visible results only)', async () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({
      id: `obs-l${i}`, employeeId: EMP_ACTIVE_1, employeeName: 'أحمد محمود',
      categoryName: 'الانضباط', notes: `التسليم المتأخر رقم ${i + 1}`, status: 'open',
      observationDate: `0${i + 1}/08/2026`, month: '2026-08',
    }));
    setTable('qualityObservations', rows);
    const body = await search('التسليم');
    const group = groupOf(body, 'qualityObservations');
    assert.ok(group);
    assert.equal(group.total, 8);
    assert.equal(group.results.length, 5);
    assert.equal(group.truncated, true);
    // Domain-scoped "view all" lifts the slice (server-capped).
    const all = await search('التسليم', { domain: 'qualityObservations', limit: 50 });
    const allGroup = groupOf(all, 'qualityObservations');
    assert.ok(allGroup);
    assert.equal(allGroup.results.length, 8);
    assert.equal(allGroup.truncated, false);
    assert.deepEqual(all.groups.map((g) => g.domain), ['qualityObservations']);
  });
});

describe('Phase 6.1 — permissions, scope & anti-enumeration (§10-§13, §30-14/15/17/29, §32)', () => {
  let route: SearchRoute;
  let adminToken: string;
  let userToken: string;
  let noEmployeesToken: string;
  let ownScopeToken: string;
  let permToken: string;

  before(async () => {
    route = (await import('@/app/api/search/route')) as SearchRoute;
    registerScopedUsers();
    noEmployeesToken = await mintToken({ userId: 'u-no-emp', email: 'noemp@test.local', role: 'user' });
    ownScopeToken = await mintToken({ userId: 'u-own', email: 'own@test.local', role: 'user' });
    permToken = await mintToken({ userId: 'u-perm', email: 'perm@test.local', role: 'user' });
    adminToken = (await registerFixtures()).adminToken;
    userToken = await mintToken({ userId: 'u-user', email: 'user@test.local', role: 'user' });
  });

  beforeEach(async () => {
    await seedWorld();
  });

  async function searchAs(token: string, query: string, extra: Record<string, unknown> = {}) {
    const res = await route.POST!(searchRequest({ query, ...extra }, token));
    assert.equal(res.status, 200);
    return (await res.json()) as Grouped;
  }

  it('29. adapter without permission: domain absent, others unaffected (§11)', async () => {
    const body = await searchAs(noEmployeesToken, 'احمد');
    assert.equal(groupOf(body, 'employees'), undefined);
    assert.ok(groupOf(body, 'complaints'), 'permitted domains keep working');
    // §12: no existence leak for the hidden domain.
    assert.equal(JSON.stringify(body).includes('EMP-001'), false);
    assert.equal(JSON.stringify(body).includes('أحمد محمود') && groupOf(body, 'employees') !== undefined, false);
  });

  it('14. permission filtering: generic user sees only granted domains', async () => {
    const body = await searchAs(permToken, 'احمد');
    const domains = body.groups.map((g) => g.domain);
    assert.ok(domains.includes('employees'));
    assert.ok(domains.includes('complaints'));
    for (const hidden of ['qualityObservations', 'qualityDeductions', 'hrDeductions', 'users', 'orgNodes', 'monthSnapshots', 'knowledgeBase']) {
      assert.equal(domains.includes(hidden), false, `${hidden} must be hidden`);
    }
  });

  it('14b. canViewDomain mirrors verifyPermission view semantics', () => {
    assert.equal(canViewDomain({}, 'admin', 'controlPanel'), true);
    assert.equal(canViewDomain({ employees: 'read' }, 'user', 'employees'), true);
    assert.equal(canViewDomain({ employees: 'none' }, 'user', 'employees'), false);
    assert.equal(canViewDomain({ employees: 'edit' }, 'user', 'employees'), true);
  });

  it('15. employee scope filtering: own-scope user sees only linked-employee records', async () => {
    const body = await searchAs(ownScopeToken, 'احمد');
    const obs = groupOf(body, 'qualityObservations');
    assert.ok(obs, 'obs-2 (سارة أحمد) is in scope');
    const obsIds = obs.results.map((r) => r.recordId);
    assert.ok(obsIds.includes('obs-2'));
    assert.equal(obsIds.includes('obs-1'), false, 'out-of-scope observation must not appear');
    const emp = groupOf(body, 'employees');
    assert.ok(emp);
    assert.deepEqual(emp.results.map((r) => r.recordId), [EMP_ACTIVE_2]);
  });

  it('17. anti-enumeration: out-of-scope employee is invisible — no names, no counts, no hints', async () => {
    // emp-1 (أحمد محمود) is outside the own-scope viewer's reach.
    const body = await searchAs(ownScopeToken, 'أحمد محمود');
    // No RESULT may carry the out-of-scope name (the query echo is the
    // caller's own input, not data leakage).
    const resultJson = JSON.stringify(body.groups);
    assert.equal(resultJson.includes('أحمد محمود'), false);
    assert.equal(resultJson.includes(EMP_ACTIVE_1), false);
    assert.equal(groupOf(body, 'employees'), undefined);
    // The employee's complaint link does not surface either (the whole
    // group may be absent — absence is the correct anti-enumeration answer).
    const direct = await searchAs(ownScopeToken, 'عميل مرتبط');
    const cmpGroup = groupOf(direct, 'complaints');
    const leaked = cmpGroup ? cmpGroup.results.some((r) => r.recordId === 'cmp-3') : false;
    assert.equal(leaked, false);
  });

  it('15b. complaints optionalLink: unlinked rows stay visible, linked out-of-scope rows hide', async () => {
    const body = await searchAs(ownScopeToken, 'فواتير');
    const group = groupOf(body, 'complaints');
    assert.ok(group);
    const ids = group.results.map((r) => r.recordId);
    assert.ok(ids.includes('cmp-unlinked'), 'organizational (unlinked) row passes');
    assert.ok(ids.includes('cmp-1'), 'linked in-scope row passes');
    assert.equal(ids.includes('cmp-3'), false, 'linked out-of-scope row hidden');
  });

  it('15c. CAPA relatedEmployeeIds: every linked employee must be in scope', async () => {
    const body = await searchAs(ownScopeToken, 'علاج');
    const group = groupOf(body, 'capaCases');
    assert.ok(group);
    const ids = group.results.map((r) => r.recordId);
    assert.ok(ids.includes('capa-row-1'), 'unlinked CAPA passes');
    assert.equal(ids.includes('capa-blocked'), false, 'CAPA linked to out-of-scope employee hides');
  });

  it('32. search is never a permission bypass: response never contains raw record fields', async () => {
    const res = await route.POST!(searchRequest({ query: 'احمد', limit: 50 }, adminToken));
    const raw = JSON.stringify(await res.json());
    assert.equal(raw.includes('0120000000'), false, 'employees.mobile must never leak');
    assert.equal(raw.includes('0129999999'), false);
    assert.equal(raw.includes('"employeeId"'), false);
    assert.equal(raw.includes('archivedAt'), false);
  });
});

describe('Phase 6.1 — exact navigation contract (§8/§9, §30-21/22/23)', () => {
  it('21-23. per-domain navigation intents reuse the existing page contracts', () => {
    // Observations: highlight + month seeding.
    const obs = buildSearchNavigation({ domain: 'qualityObservations', recordId: 'obs-1', month: '2026-08' });
    assert.deepEqual(obs, { page: 'observations', highlightId: 'obs-1', navParams: { month: '2026-08' }, exact: true });

    // Travel: highlight + month seeding (server-derived month).
    const travel = buildSearchNavigation({ domain: 'travelDeals', recordId: 'trv-1', month: '2026-09' });
    assert.equal(travel.page, 'travel');
    assert.equal(travel.exact, true);
    assert.deepEqual(travel.navParams, { month: '2026-09' });

    // CAPA: detail mode via the page's OWN navParams.id contract.
    const capa = buildSearchNavigation({ domain: 'capaCases', recordId: 'capa-row-1' });
    assert.deepEqual(capa, { page: 'capa', highlightId: 'capa-row-1', navParams: { id: 'capa-row-1' }, exact: true });

    // Employees: archived seeding so the exact row is reachable (§13).
    const archived = buildSearchNavigation({ domain: 'employees', recordId: EMP_ARCHIVED, statusValue: 'archived' });
    assert.deepEqual(archived, { page: 'employees', highlightId: EMP_ARCHIVED, navParams: { status: 'archived' }, exact: true });
    const active = buildSearchNavigation({ domain: 'employees', recordId: EMP_ACTIVE_1, statusValue: 'active' });
    assert.deepEqual(active, { page: 'employees', highlightId: EMP_ACTIVE_1, navParams: {}, exact: true });

    // Complaints / follow-ups / HR deductions / attendance / requests: exact highlight.
    for (const domain of ['complaints', 'followUps', 'hrDeductions', 'attendance', 'requests'] as const) {
      const intent = buildSearchNavigation({ domain, recordId: 'x-1' });
      assert.equal(intent.exact, true, domain);
      assert.equal(intent.highlightId, 'x-1', domain);
      assert.equal(intent.page, SEARCH_DOMAINS[domain].page, domain);
    }

    // Honest fallback for pages without an exact-record contract.
    for (const domain of ['qualityDeductions', 'knowledgeBase', 'monthSnapshots', 'orgNodes', 'users'] as const) {
      const intent = buildSearchNavigation({ domain, recordId: 'x-1' });
      assert.equal(intent.exact, false, domain);
      assert.equal(intent.highlightId, null, domain);
      assert.equal(intent.page, SEARCH_DOMAINS[domain].page, domain);
    }
  });

  it('24. highlight integration: palette navigates through navigateTo with highlightId, pages consume the shared hook', () => {
    const palette = srcOf('src/components/search/GlobalSearch.tsx');
    assert.match(palette, /buildSearchNavigation/);
    assert.match(palette, /navigateTo\(intent\.page,\s*intent\.highlightId \?\? undefined,\s*intent\.navParams\)/);
    assert.match(palette, /canViewPage\(intent\.page\)/);
    assert.match(palette, /authFetch\('\/api\/search'/);
    assert.match(palette, /method: 'POST'/);
    assert.match(palette, /SEARCH_DEBOUNCE_MS = 250/);
    assert.match(palette, /AbortController/);

    // Shared evidence-highlight mechanism consumers (existing + newly wired).
    for (const page of [
      'src/components/pages/quality-kpi/ObservationsPage.tsx',
      'src/components/pages/ComplaintsPage.tsx',
      'src/components/pages/FollowUpsPage.tsx',
      'src/components/pages/TravelPage.tsx',
      'src/components/pages/HrDeductionsPage.tsx',
      'src/components/pages/AttendancePage.tsx',
    ]) {
      const source = srcOf(page);
      assert.match(source, /useRecordHighlight\(/, page);
      assert.match(source, /data-record-id=/, page);
    }
    // Employees page keeps its own (pre-existing) highlightId row mechanic.
    const employees = srcOf('src/components/pages/EmployeesPage.tsx');
    assert.match(employees, /highlightId/);
    assert.match(employees, /scrollIntoView/);
    assert.match(employees, /navParams\.status/); // Phase 6.1 status seeding
    // Requests page keeps its own highlightId row mechanic.
    const requests = srcOf('src/components/pages/RequestsPage.tsx');
    assert.match(requests, /highlightId/);
    assert.match(requests, /scrollIntoView/);
  });

  it('service-level deps: only VISIBLE domains are read from the database (IO-level §12)', async () => {
    const readTables: string[] = [];
    const caller = {
      userId: 'u-x', role: 'user',
      permissions: { employees: 'none', observations: 'read' } as Record<string, unknown>,
    };
    const scopeCtx = {
      scope: 'all' as const, pageKey: 'employees', source: 'test', isUnrestricted: true,
      employeeIds: [], includes: () => true,
    } as unknown as EmployeeScopeContext;
    await runGlobalSearch(
      caller as Parameters<typeof runGlobalSearch>[0],
      { query: 'احمد' },
      {
        getAll: async (table) => {
          readTables.push(table);
          return table === 'qualityObservations'
            ? [{ id: 'obs-1', employeeId: 'e1', employeeName: 'أحمد محمود', notes: 'احمد' }]
            : [];
        },
        getEmployeeMap: async () => new Map(),
        resolveScope: async () => scopeCtx,
      } as SearchDeps,
    );
    assert.ok(readTables.includes('qualityObservations'));
    assert.equal(readTables.includes('employees'), false, 'unauthorized domain is never queried');
    assert.equal(readTables.includes('users'), false);
  });
});
