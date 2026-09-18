import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { getAll, createRecord, findFirst } from '@/lib/db';
import { requireAuth, verifyPermission } from '@/lib/verify-permission';
import { asScopeViewer, hasUnrestrictedEmployeeScope } from '@/lib/scope/server';
import { resolveActor } from '@/lib/auth/actor-resolver';
import { makeApprovalEvent, projectLatestApprovalStatus } from '@/lib/approvals';
import { notifyQualityDiscountPending } from '@/lib/notifications/quality-approval-events';
import { getById } from '@/lib/db';

// ── Column mapping for Arabic Excel headers ──
const COLUMN_MAP: Record<string, string> = {
  'اسم الموظف': 'name',
  'اسم': 'name',
  'الاسم': 'name',
  'الاسم الكامل': 'name',
  'name': 'name',
  'employee name': 'name',
  'employee': 'name',
  'الموظف': 'name',

  'التاريخ': 'date',
  'تاريخ': 'date',
  'تاريخ الخصم': 'date',
  'date': 'date',

  'قيمة الخصم': 'amount',
  'قيمة': 'amount',
  'الخصم': 'amount',
  'مبلغ الخصم': 'amount',
  'المبلغ': 'amount',
  'عدد الأيام': 'amount',
  'أيام الخصم': 'amount',
  'عدد ايام الخصم': 'amount',
  'خصم': 'amount',
  'amount': 'amount',
  'days': 'amount',

  'السبب': 'reason',
  'سبب': 'reason',
  'الوصف': 'reason',
  'وصف': 'reason',
  'الشرح': 'reason',
  'شرح': 'reason',
  'description': 'reason',
  'reason': 'reason',

  'الدليل': 'evidence',
  'دليل': 'evidence',
  'رابط الدليل': 'evidence',
  'الرابط': 'evidence',
  'رابط': 'evidence',
  'evidence': 'evidence',
  'link': 'evidence',
};

function normalizeHeader(header: unknown): string {
  const trimmed = String(header ?? '').trim();
  if (COLUMN_MAP[trimmed]) return COLUMN_MAP[trimmed];
  const lower = trimmed.toLowerCase();
  if (COLUMN_MAP[lower]) return COLUMN_MAP[lower];
  return trimmed;
}

// ── Parse date: handles Excel serial numbers, DD/MM/YYYY, YYYY-MM-DD, etc. ──
function parseExcelDate(value: unknown): string {
  if (typeof value === 'number') {
    if (value > 30000 && value < 100000) {
      const excelEpoch = new Date(1899, 11, 30);
      const date = new Date(excelEpoch.getTime() + value * 86400000);
      return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
    }
    return String(value);
  }
  const str = String(value ?? '').trim();
  if (!str || str === 'ـــ' || str === '---' || str === '-' || str === '/') return '';

  // DD/MM/YYYY or DD/MM/YY
  const dmy = str.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (dmy) {
    let d = parseInt(dmy[1], 10);
    let m = parseInt(dmy[2], 10);
    let y = parseInt(dmy[3], 10);
    if (y < 100) y += 2000;
    return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
  }

  // YYYY-MM-DD
  const ymd = str.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/);
  if (ymd) {
    return `${String(parseInt(ymd[3], 10)).padStart(2, '0')}/${String(parseInt(ymd[2], 10)).padStart(2, '0')}/${ymd[1]}`;
  }

  return str;
}

// ── Extract month (YYYY-MM) from DD/MM/YYYY ──
function extractMonth(dateStr: string): string {
  const parts = dateStr.split('/');
  if (parts.length === 3) {
    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10);
    const year = parseInt(parts[2], 10);
    if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
      return `${year}-${String(month).padStart(2, '0')}`;
    }
  }
  return '';
}

// ── Parse deduction amount (supports both days and monetary values) ──
function parseAmount(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed || trimmed === 'ـــ' || trimmed === '---' || trimmed === '-' || trimmed === '/') return 0;
    const n = Number(trimmed);
    return isNaN(n) ? 0 : n;
  }
  return 0;
}

// ── Clean text ──
function cleanText(value: unknown): string {
  const str = String(value ?? '').trim();
  if (!str || str === 'ـــ' || str === '---' || str === '-' || str === '/') return '';
  return str;
}

export async function POST(request: NextRequest) {
  try {
    // M0.1: quality deductions affect payroll-adjacent data — require the
    // quality 'create' action (401 unauthenticated / 403 forbidden).
    const auth = await requireAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'مطلوب تسجيل الدخول' }, { status: 401 });
    }
    const permCheck = await verifyPermission(request, 'quality', 'create');
    if (!permCheck.allowed) {
      return NextResponse.json({ error: permCheck.error }, { status: 403 });
    }

    // §WORKFLOW (UNIFORM APPROVAL) — bulk-imported discounts follow the
    // SAME approval lifecycle as manual ones and ALWAYS enter it as
    // PENDING, regardless of who imports: decision authority lives in
    // the approve/reject routes ('approve' action), never in creation.
    // §AUDIT — every imported row is attributed to the uploading user.
    const actor = await resolveActor(permCheck.user?.id);
    const uploaderRecord = permCheck.user?.id
      ? await getById<{ name?: string; email?: string }>('users', permCheck.user.id)
      : null;
    const submitEvent = makeApprovalEvent({
      action: 'submit',
      actorId: actor.id,
      actorName: actor.name,
      notes: 'استيراد خصومات من ملف Excel',
    });
    const approvalHistory = [submitEvent];
    const importedApprovalStatus = projectLatestApprovalStatus(approvalHistory);

    // ── BULK WRITE-SCOPE (M0.4) ──
    // Rows target employees matched by free-text names — arbitrary
    // workforce targets. Like every bulk employee-linked create it
    // requires an UNRESTRICTED employee scope; scoped viewers are
    // denied fail-closed (the deduction rules themselves unchanged).
    const unrestricted = await hasUnrestrictedEmployeeScope(
      asScopeViewer(permCheck.user!),
      permCheck.user!.permissions,
    );
    if (!unrestricted) {
      return NextResponse.json(
        { error: 'صلاحية غير كافية لاستيراد خصومات خارج نطاق بياناتك' },
        { status: 403 },
      );
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'لم يتم اختيار ملف' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rawData: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });

    if (rawData.length < 2) {
      return NextResponse.json({ error: 'الملف فاضي أو لا يحتوي على بيانات كافية' }, { status: 400 });
    }

    // ── Find header row (first row with at least 2 non-empty cells) ──
    let headerIdx = 0;
    for (let i = 0; i < rawData.length; i++) {
      const row = rawData[i] as unknown[];
      const nonEmpty = row.filter((c) => String(c ?? '').trim() !== '');
      if (nonEmpty.length >= 2) { headerIdx = i; break; }
    }

    // ── Map column headers ──
    const headers = (rawData[headerIdx] as unknown[]).map(normalizeHeader);
    const colIdx: Record<string, number> = {};
    headers.forEach((h, i) => { colIdx[h] = i; });

    console.log('🔍 Quality upload columns found:', colIdx);

    // ── Check required columns ──
    const hasName = colIdx['name'] !== undefined;
    const hasDate = colIdx['date'] !== undefined;

    if (!hasName) {
      return NextResponse.json({
        error: 'لم يتم العثور على عمود "اسم الموظف". الأعمدة المكتشفة: ' + headers.join(', '),
        foundColumns: headers,
      }, { status: 400 });
    }

    // ── Load all employees for matching ──
    const allEmployees = await getAll('employees');
    const empByName = new Map<string, { id: string }>();
    allEmployees.forEach((e: any) => {
      empByName.set(e.name.trim().toLowerCase().replace(/\s+/g, ' '), { id: e.id });
    });

    let imported = 0;
    let skipped = 0;
    let updated = 0;
    const skippedNames: string[] = [];

    // ── Process each data row ──
    for (let i = headerIdx + 1; i < rawData.length; i++) {
      const row = rawData[i] as unknown[];
      if (row.every((v) => !v && v !== 0)) continue;

      const getVal = (key: string) => row[colIdx[key]] ?? '';

      const name = cleanText(getVal('name'));
      const date = parseExcelDate(getVal('date'));
      const amount = parseAmount(getVal('amount'));
      const reason = cleanText(getVal('reason'));
      const evidence = cleanText(getVal('evidence'));

      if (!name) { skipped++; continue; }
      if (!date) { skipped++; continue; }

      // ── Find employee by name (exact or fuzzy) ──
      const normalizedName = name.toLowerCase().replace(/\s+/g, ' ');
      let employee = empByName.get(normalizedName);

      // Fuzzy match: try contains
      if (!employee) {
        for (const [key, val] of empByName.entries()) {
          if (key.includes(normalizedName) || normalizedName.includes(key)) {
            employee = val;
            break;
          }
        }
      }

      if (!employee) {
        skipped++;
        if (skippedNames.length < 10) skippedNames.push(name);
        continue;
      }

      // ── Determine deduction type from reason text ──
      let type = 'quality_issue';
      const reasonLower = reason.toLowerCase();
      if (reasonLower.includes('سلامة') || reasonLower.includes('safety') || reasonLower.includes('حادث') || reasonLower.includes('معدات حماية')) {
        type = 'safety';
      } else if (reasonLower.includes('التزام') || reasonLower.includes('compliance') || reasonLower.includes('قوانين') || reasonLower.includes('لوائح')) {
        type = 'compliance';
      }

      // ── Check for existing record (same employee + same date) to avoid duplicates ──
      const existing = await findFirst('qualityDeductions', {
        employeeId: employee.id,
        date: date,
      });

      if (existing) {
        updated++;
      } else {
        // ── Create the quality deduction record ──
        const month = extractMonth(date);

        // Determine if amount is days or money
        // If amount <= 30, treat as days; otherwise treat as monetary amount
        const deductionDays = (amount > 0 && amount <= 30) ? amount : 0;
        const deductionAmount = (amount > 30) ? amount : 0;

        await createRecord('qualityDeductions', {
          employeeId: employee.id,
          date,
          type,
          description: reason || '',
          deductionDays,
          deductionAmount,
          evidence: evidence || null,
          month,
          // §AUDIT — hidden creator metadata (server-resolved).
          createdById: actor.id,
          createdByUserId: actor.id,
          createdByName: actor.name,
          createdByEmail: uploaderRecord?.email || null,
          // §WORKFLOW — same approval lifecycle as manual creation.
          approvalStatus: importedApprovalStatus,
          approvalHistory,
        });
        imported++;
      }
    }

    const skippedMsg = skippedNames.length > 0
      ? ` (أمثلة: ${skippedNames.slice(0, 5).join(', ')})`
      : '';

    // §APPROVAL-NOTIFY — one summary notification for the whole batch
    // (dedup window prevents retry spam; per-record deep links come
    // from the pending section on the quality page).
    if (imported > 0) {
      void notifyQualityDiscountPending({
        recordId: 'bulk-import',
        typeLabel: `استيراد ${imported} خصم جودة`,
        actorId: actor.id,
        creatorName: actor.name,
      });
    }

    return NextResponse.json({
      message: `تم استيراد ${imported} خصم بنجاح${updated > 0 ? ` — ${updated} سجل مكرر تم تخطيه` : ''}${skipped > 0 ? ` — ${skipped} صف تم تخطيه${skippedMsg}` : ''}`,
      imported,
      skipped,
      updated,
      dbEmployeeCount: allEmployees.length,
      foundColumns: headers,
    });
  } catch (error) {
    console.error('Quality upload error:', error);
    return NextResponse.json(
      { error: 'خطأ في معالجة الملف: ' + String(error) },
      { status: 500 }
    );
  }
}