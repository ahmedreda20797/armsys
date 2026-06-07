import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { db } from '@/lib/db';

// Column mapping for biometric Excel headers
const COLUMN_MAP: Record<string, string> = {
  'اسم': 'name',
  'الاسم': 'name',
  'اسم الموظف': 'name',
  'name': 'name',
  'كود': 'code',
  'كود الموظف': 'code',
  'code': 'code',
  'التاريخ': 'date',
  'تاريخ': 'date',
  'date': 'date',
  'الدخول': 'checkIn',
  'دخول': 'checkIn',
  'وقت الدخول': 'checkIn',
  'وقت الحضور': 'checkIn',
  'حضور': 'checkIn',
  'checkin': 'checkIn',
  'check_in': 'checkIn',
  'الخروج': 'checkOut',
  'خروج': 'checkOut',
  'وقت الخروج': 'checkOut',
  'وقت الانصراف': 'checkOut',
  'انصراف': 'checkOut',
  'checkout': 'checkOut',
  'check_out': 'checkOut',
  'time in': 'checkIn',
  'time out': 'checkOut',
};

function normalizeHeader(header: unknown): string {
  const trimmed = String(header ?? '').trim();
  return COLUMN_MAP[trimmed] || COLUMN_MAP[trimmed.toLowerCase()] || trimmed;
}

// ✅ FIXED: handle empty string → return null
function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '' || trimmed === 'ـــ' || trimmed === '---' || trimmed === '-') return null;
    const n = Number(trimmed);
    return isNaN(n) ? null : n;
  }
  return null;
}

// ✅ FIXED: only convert if num > 30000 (valid Excel date serial)
function parseExcelDate(value: unknown): string {
  const num = toNumber(value);
  if (num !== null && num > 30000 && num < 100000) {
    const excelEpoch = new Date(1899, 11, 30);
    const date = new Date(excelEpoch.getTime() + num * 86400000);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  }
  return String(value ?? '').trim();
}

// ✅ FIXED: only convert if num > 0 and num < 2 (valid time fraction)
function parseExcelTime(value: unknown): string | null {
  const num = toNumber(value);
  if (num !== null && num > 0 && num < 2) {
    const totalMinutes = Math.round(num * 24 * 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }
  const str = String(value ?? '').trim();
  if (!str || str === 'ـــ' || str === '---' || str === '-' || str === '/') return null;
  return str;
}

function parseExcelFile(buffer: ArrayBuffer): { rows: unknown[][]; headers: string[]; rawHeaders: string[] } {
  try {
    const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array' });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) return { rows: [], headers: [], rawHeaders: [] };

    const sheet = workbook.Sheets[sheetName];
    // ✅ FIXED: add raw: true to preserve number types
    const rawData: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });

    if (rawData.length < 2) return { rows: [], headers: [], rawHeaders: [] };

    let headerRowIndex = 0;
    for (let i = 0; i < rawData.length; i++) {
      const row = rawData[i] as unknown[];
      const nonEmpty = row.filter((c) => String(c ?? '').trim() !== '');
      if (nonEmpty.length >= 2) { headerRowIndex = i; break; }
    }

    const rawHeaders = (rawData[headerRowIndex] as unknown[]).map((h) => String(h ?? '').trim());
    const headers = rawHeaders.map(normalizeHeader);

    const rows: unknown[][] = [];
    for (let i = headerRowIndex + 1; i < rawData.length; i++) {
      const row = rawData[i];
      if (row.every((v) => !v && v !== 0)) continue;
      rows.push(row);
    }

    return { rows, headers, rawHeaders };
  } catch (error) {
    console.error('Excel parse error:', error);
    return { rows: [], headers: [], rawHeaders: [] };
  }
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'لم يتم اختيار ملف' }, { status: 400 });
    }

    const buffer = await file.arrayBuffer();
    const { rows, headers, rawHeaders } = parseExcelFile(buffer);

    if (rows.length === 0) {
      return NextResponse.json({
        error: 'لا توجد بيانات في الملف. الأعمدة: ' + rawHeaders.join(', '),
      }, { status: 400 });
    }

    // Column index map
    const colIdx: Record<string, number> = {};
    headers.forEach((h, i) => { colIdx[h] = i; });

    // Load all employees
    const allEmployees = await db.employee.findMany({
      select: { id: true, name: true, code: true },
    });

    const empByName = new Map<string, { id: string }>();
    allEmployees.forEach((e) => {
      empByName.set(e.name.trim().toLowerCase().replace(/\s+/g, ' '), { id: e.id });
    });

    const empByCode = new Map<string, { id: string }>();
    allEmployees.filter((e) => e.code).forEach((e) => {
      empByCode.set(e.code!.trim().toLowerCase(), { id: e.id });
    });

    let imported = 0;
    let skipped = 0;
    const skippedNames: string[] = [];

    for (const row of rows) {
      const getVal = (key: string) => row[colIdx[key]] ?? '';

      const name = String(getVal('name')).trim();
      const code = String(getVal('code')).trim();
      const date = parseExcelDate(getVal('date'));
      const checkIn = parseExcelTime(getVal('checkIn'));
      const checkOut = parseExcelTime(getVal('checkOut'));

      // Debug log for first row
      if (row === rows[0]) {
        console.log('🔍 Biometric raw:', row);
        console.log('🔍 Biometric parsed:', { name, code, date, checkIn, checkOut });
      }

      if (!date) { skipped++; continue; }

      let employee = name ? empByName.get(name.toLowerCase().replace(/\s+/g, ' ')) : null;
      if (!employee && code) employee = empByCode.get(code.toLowerCase());

      if (!employee) {
        skipped++;
        if (skippedNames.length < 10) skippedNames.push(name || code || 'بدون اسم');
        continue;
      }

      await db.biometric.create({
        data: { employeeId: employee.id, date, checkIn, checkOut },
      });
      imported++;
    }

    const skippedMsg = skippedNames.length > 0
      ? ` (أمثلة: ${skippedNames.slice(0, 5).join(', ')})`
      : '';

    return NextResponse.json({
      message: `تم استيراد ${imported} سجل بنجاح${skipped > 0 ? ` — ${skipped} تم تخطيه${skippedMsg}` : ''}`,
      imported,
      skipped,
      dbEmployeeCount: allEmployees.length,
    });
  } catch (error) {
    console.error('Upload biometric error:', error);
    return NextResponse.json(
      { error: 'خطأ في معالجة الملف: ' + String(error) },
      { status: 500 }
    );
  }
}