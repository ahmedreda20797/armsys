import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { getAll, createRecord, findFirst, deleteWhere } from '@/lib/db';
import { verifyPermission } from '@/lib/verify-permission';

const COLUMN_MAP: Record<string, string> = {
  'الاسم': 'name', 'اسم': 'name', 'name': 'name', 'Employee Name': 'name',
  'الكود': 'code', 'كود': 'code', 'code': 'code', 'Code': 'code',
  'التاريخ': 'date', 'تاريخ': 'date', 'date': 'date', 'Date': 'date',
  'الحضور': 'checkIn', 'حضور': 'checkIn', 'check in': 'checkIn', 'checkIn': 'checkIn', 'Check In': 'checkIn', 'In': 'checkIn',
  'الانصراف': 'checkOut', 'انصراف': 'checkOut', 'check out': 'checkOut', 'checkOut': 'checkOut', 'Check Out': 'checkOut', 'Out': 'checkOut',
};

function normalizeHeader(header: unknown): string {
  const trimmed = String(header ?? '').trim();
  return COLUMN_MAP[trimmed] || COLUMN_MAP[trimmed.toLowerCase()] || trimmed;
}

function parseExcelTime(value: unknown): string | null {
  if (typeof value === 'number') {
    if (value > 0 && value < 2) {
      const totalMinutes = Math.round(value * 24 * 60);
      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;
      return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    }
  }
  const str = String(value ?? '').trim();
  if (!str || str === 'ـــ' || str === '---' || str === '-') return null;
  return str;
}

function parseExcelDate(value: unknown): string | null {
  if (typeof value === 'number' && value > 30000 && value < 100000) {
    const excelEpoch = new Date(1899, 11, 30);
    const date = new Date(excelEpoch.getTime() + value * 86400000);
    return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
  }
  const str = String(value ?? '').trim();
  if (!str || str === 'ـــ' || str === '---' || str === '-') return null;
  return str;
}

/** Extract month key (YYYY-MM) from a date string DD/MM/YYYY */
function extractMonth(dateStr: string): string {
  const parts = dateStr.split('/');
  if (parts.length === 3) {
    return `${parts[2]}-${parts[1].padStart(2, '0')}`;
  }
  return '';
}

export async function POST(request: NextRequest) {
  try {
    // Verify permission: need 'upload' on 'biometric'
    const permCheck = await verifyPermission(request, 'biometric', 'upload');
    if (!permCheck.allowed) {
      return NextResponse.json({ error: permCheck.error }, { status: 403 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'الملف مطلوب' }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rawData: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });

    if (rawData.length < 2) return NextResponse.json({ error: 'لا توجد بيانات' }, { status: 400 });

    // Find header row (first row with at least 2 non-empty cells)
    let headerIdx = 0;
    for (let i = 0; i < rawData.length; i++) {
      const nonEmpty = (rawData[i] as unknown[]).filter((c) => String(c ?? '').trim() !== '');
      if (nonEmpty.length >= 2) { headerIdx = i; break; }
    }

    const headers = (rawData[headerIdx] as unknown[]).map(normalizeHeader);
    const colIdx: Record<string, number> = {};
    headers.forEach((h, i) => { colIdx[h] = i; });

    // Check required columns
    if (colIdx['name'] === undefined || colIdx['date'] === undefined) {
      return NextResponse.json({ error: 'الملف يجب أن يحتوي على أعمدة الاسم والتاريخ' }, { status: 400 });
    }

    const allEmployees = await getAll('employees');
    let imported = 0;
    let skipped = 0;
    const monthsSet = new Set<string>();

    for (let i = headerIdx + 1; i < rawData.length; i++) {
      const row = rawData[i] as unknown[];
      if (row.every((v) => !v && v !== 0)) continue;

      const getVal = (key: string) => row[colIdx[key]] ?? '';
      const code = String(getVal('code')).trim();
      const name = String(getVal('name')).trim();
      const date = parseExcelDate(getVal('date')) || '';
      const checkIn = parseExcelTime(getVal('checkIn')) || null;
      const checkOut = parseExcelTime(getVal('checkOut')) || null;

      if (!name || !date) { skipped++; continue; }

      // Extract month for separation tracking
      const month = extractMonth(date);
      if (month) monthsSet.add(month);

      // Find or create employee
      let employeeId = '';
      const matched = allEmployees.find((e: any) => (code && e.code === code) || e.name === name);
      if (matched) {
        employeeId = matched.id;
      } else {
        const existing = await findFirst('employees', { name });
        if (existing) {
          employeeId = existing.id;
        } else {
          const emp = await createRecord('employees', { name, code: code || null });
          employeeId = emp.id;
          allEmployees.push({ id: emp.id, name, code } as any);
        }
      }

      // Create biometric record with month field for separation
      await createRecord('biometrics', {
        employeeId,
        date,
        checkIn,
        checkOut,
        month: month || null,
      });
      imported++;
    }

    return NextResponse.json({
      message: `تم استيراد ${imported} سجل${skipped > 0 ? ` (${skipped} تم تخطيهم)` : ''}`,
      imported,
      skipped,
      months: Array.from(monthsSet),
    });
  } catch (error) {
    console.error('Biometric upload error:', error);
    return NextResponse.json({ error: 'فشل في استيراد البيانات' }, { status: 500 });
  }
}
