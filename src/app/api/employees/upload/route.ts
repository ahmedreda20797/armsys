import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { findFirst, createRecord, updateRecord } from '@/lib/db';

const COLUMN_MAP: Record<string, string> = {
  'كود': 'code', 'كود الموظف': 'code', 'الكود': 'code', 'code': 'code',
  'اسم': 'name', 'الاسم': 'name', 'اسم الموظف': 'name', 'name': 'name',
  'القسم': 'department', 'قسم': 'department', 'department': 'department',
  'الوظيفة': 'position', 'وظيفة': 'position', 'position': 'position', 'المسمى الوظيفي': 'position',
  'بداية الدوام': 'shiftStart', 'بداية': 'shiftStart', 'من': 'shiftStart', 'shiftStart': 'shiftStart',
  'نهاية الدوام': 'shiftEnd', 'نهاية': 'shiftEnd', 'إلى': 'shiftEnd', 'shiftEnd': 'shiftEnd',
  'تاريخ التعيين': 'hireDate', 'تاريخ': 'hireDate', 'hireDate': 'hireDate',
  'رقم الموبايل': 'mobile', 'موبايل': 'mobile', 'تليفون': 'mobile', 'هاتف': 'mobile', 'mobile': 'mobile', 'رقم الهاتف': 'mobile', 'رقم التليفون': 'mobile',
};

function normalizeHeader(header: unknown): string {
  const trimmed = String(header ?? '').trim();
  return COLUMN_MAP[trimmed] || COLUMN_MAP[trimmed.toLowerCase()] || trimmed;
}

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

function parseExcelDate(value: unknown): string | null {
  const num = toNumber(value);
  if (num !== null && num > 30000 && num < 100000) {
    const excelEpoch = new Date(1899, 11, 30);
    const date = new Date(excelEpoch.getTime() + num * 86400000);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  }
  const str = String(value ?? '').trim();
  if (!str || str === 'ـــ' || str === '---' || str === '-') return null;
  return str;
}

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

function cleanText(value: unknown): string | null {
  const str = String(value ?? '').trim();
  if (!str || str === 'ـــ' || str === '---' || str === '-') return null;
  return str;
}

function parseExcelFile(buffer: ArrayBuffer): { rows: unknown[][]; headers: string[]; rawHeaders: string[] } {
  try {
    const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array' });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) return { rows: [], headers: [], rawHeaders: [] };
    const sheet = workbook.Sheets[sheetName];
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
    if (!file) return NextResponse.json({ error: 'لم يتم اختيار ملف' }, { status: 400 });

    const buffer = await file.arrayBuffer();
    const { rows, headers, rawHeaders } = parseExcelFile(buffer);

    if (rows.length === 0) {
      return NextResponse.json({ error: `لا توجد بيانات في الملف. الأعمدة: ${rawHeaders.join(', ')}` }, { status: 400 });
    }

    const colIdx: Record<string, number> = {};
    headers.forEach((h, i) => { colIdx[h] = i; });

    const employees = rows.map((row) => {
      const getVal = (key: string) => row[colIdx[key]] ?? '';
      return {
        code: cleanText(getVal('code')),
        name: cleanText(getVal('name')) || '',
        department: cleanText(getVal('department')),
        position: cleanText(getVal('position')),
        shiftStart: parseExcelTime(getVal('shiftStart')),
        shiftEnd: parseExcelTime(getVal('shiftEnd')),
        hireDate: parseExcelDate(getVal('hireDate')),
        mobile: cleanText(getVal('mobile')),
      };
    }).filter((emp) => emp.name !== '');

    if (employees.length === 0) {
      return NextResponse.json({ error: 'لم يتم العثور على عمود "الاسم". الأعمدة: ' + rawHeaders.join(', ') }, { status: 400 });
    }

    let imported = 0;
    let duplicates = 0;

    for (const emp of employees) {
      try {
        if (emp.code) {
          const existing = await findFirst('employees', { code: emp.code });
          if (existing) { await updateRecord('employees', existing.id, emp); imported++; duplicates++; continue; }
        }
        await createRecord('employees', emp);
        imported++;
      } catch { duplicates++; }
    }

    return NextResponse.json({
      message: `تم استيراد ${imported} موظف بنجاح${duplicates > 0 ? ` (${duplicates} تم تحديثهم/تخطيهم)` : ''}`,
      imported, updated: duplicates, total: employees.length,
    });
  } catch (error) {
    console.error('Upload employees error:', error);
    return NextResponse.json({ error: 'خطأ في معالجة الملف: ' + String(error) }, { status: 500 });
  }
}