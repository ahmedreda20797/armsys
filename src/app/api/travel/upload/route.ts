import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import * as XLSX from 'xlsx';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'الملف مطلوب' }, { status: 400 });
    }

    // Fetch all employees once for matching
    const allEmployees = await db.employee.findMany({
      select: { id: true, name: true },
    });

    const buffer = Buffer.from(await file.arrayBuffer());
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });

    if (rows.length === 0) {
      return NextResponse.json({ error: 'الملف فاضي أو لا يحتوي على بيانات' }, { status: 400 });
    }

    // ── Find column headers ──
    const headers = Object.keys(rows[0]);

    const findCol = (candidates: string[]): string | null => {
      for (const c of candidates) {
        const found = headers.find((h) => h.trim().toLowerCase() === c.toLowerCase());
        if (found) return found;
      }
      for (const c of candidates) {
        const found = headers.find((h) => h.trim().toLowerCase().includes(c.toLowerCase()));
        if (found) return found;
      }
      return null;
    };

    const colStart = findCol(['Start', 'start', 'start date', 'البداية', 'تاريخ الذهاب', 'departure']);
    const colEnd = findCol(['End', 'end', 'end date', 'النهاية', 'تاريخ العودة', 'return']);
    const colDeal = findCol(['DEAL', 'deal', 'الصفقة', 'الديل', 'ديل']);
    const colNames = findCol(['NAMES', 'names', 'الأسماء', 'العملاء', 'NAMES OF PAX', 'PAX NAME', 'Pax Name', 'pax']);
    const colStatus = findCol(['Status', 'status', 'الحالة']);
    const colIncomplete = findCol(['INCOMPLETE', 'incomplete', 'غير مكتمل', 'ملاحظات', 'notes', 'Notes']);

    if (!colDeal) {
      return NextResponse.json(
        { error: 'لم يتم التعرف على عمود DEAL', foundHeaders: headers },
        { status: 400 }
      );
    }

    // ── Parse each row ──
    const results: {
      success: number;
      skipped: number;
      errors: string[];
      createdEmployees: number;
      matchedEmployees: number;
    } = { success: 0, skipped: 0, errors: [], createdEmployees: 0, matchedEmployees: 0 };

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];

      try {
        const rawDeal = colDeal ? String(row[colDeal] || '').trim() : '';
        if (!rawDeal) {
          results.skipped++;
          continue;
        }

        // ── Parse DEAL column ──
        const deal = parseDealColumn(rawDeal);

        // ── 1. Find or create Employee (fuzzy match) ──
        const empResult = await findOrCreateEmployee(deal.employeeName, allEmployees);
        if (!empResult.employeeId) {
          results.errors.push(`صف ${i + 2}: فشل إنشاء موظف "${deal.employeeName}"`);
          results.skipped++;
          continue;
        }
        if (empResult.created) {
          results.createdEmployees++;
          allEmployees.push({ id: empResult.employeeId, name: deal.employeeName });
        } else if (empResult.fuzzyMatch) {
          results.matchedEmployees++;
        }

        // ── 2. Departure Date ──
        let departureDate = '';
        // Priority: Start column > DEAL date
        if (colStart && row[colStart]) {
          const rawStart = String(row[colStart]).trim();
          if (rawStart) departureDate = normalizeDate(rawStart);
        }
        if (!departureDate && deal.date) {
          departureDate = deal.date;
        }
        if (!departureDate) {
          departureDate = new Date().toLocaleDateString('en-GB');
        }

        // ── 3. Return Date ──
        let returnDate = '';
        if (colEnd && row[colEnd]) {
          const rawEnd = String(row[colEnd]).trim();
          if (rawEnd) returnDate = normalizeDate(rawEnd);
        }

        // ── 4. Destination ──
        const destination = deal.destination || 'غير محدد';

        // ── 5. Customer Names ──
        let customerNames = '';
        if (colNames && row[colNames]) {
          customerNames = String(row[colNames]).trim();
        }
        if (!customerNames && deal.customerName) {
          customerNames = deal.customerName;
        }

        // ── 6. Notes ──
        let notes = '';
        if (colIncomplete && row[colIncomplete]) {
          notes = String(row[colIncomplete]).trim();
        }

        // ── 7. Status ──
        let status = 'upcoming';
        if (colStatus && row[colStatus]) {
          const rawStatus = String(row[colStatus]).trim().toLowerCase();
          if (rawStatus.includes('complet') || rawStatus.includes('مكتمل') || rawStatus === 'done') {
            status = 'completed';
          } else if (rawStatus.includes('progress') || rawStatus.includes('معالج') || rawStatus.includes('جاري') || rawStatus.includes('processing')) {
            status = 'in_progress';
          } else if (rawStatus.includes('cancel') || rawStatus.includes('ملغي') || rawStatus.includes('متكنسل')) {
            status = 'canceled';
          } else if (rawStatus.includes('chang') || rawStatus.includes('تغيير')) {
            status = 'in_progress';
          }
        }

        // Auto-determine status from dates
        if ((!colStatus || !row[colStatus]) && departureDate) {
          const depNum = parseDateToNumber(departureDate);
          const nowNum = dateToNumber(new Date());
          if (returnDate) {
            const retNum = parseDateToNumber(returnDate);
            if (retNum < nowNum) status = 'completed';
            else if (depNum <= nowNum) status = 'in_progress';
          } else if (depNum < nowNum) {
            status = 'completed';
          }
        }

        await db.travelDeal.create({
          data: {
            employeeId: empResult.employeeId,
            destination,
            departureDate,
            returnDate: returnDate || null,
            dealerName: rawDeal || null,
            customerNames: customerNames || null,
            notes: notes || null,
            status,
            hasFlight: false,
            hasHotel: false,
            hasVisa: false,
            hasTours: false,
            hasTransportation: false,
          },
        });

        results.success++;
      } catch (rowError) {
        results.errors.push(`صف ${i + 2}: ${String(rowError)}`);
        results.skipped++;
      }
    }

    const summary = `تم استيراد ${results.success} حجز بنجاح`;
    const details: string[] = [];
    if (results.createdEmployees > 0) details.push(`تم إنشاء ${results.createdEmployees} موظف جديد`);
    if (results.matchedEmployees > 0) details.push(`تم مطابقة ${results.matchedEmployees} موظف (فزي)`);
    if (results.skipped > 0) details.push(`تم تخطي ${results.skipped} صف`);

    return NextResponse.json({
      message: details.length > 0 ? `${summary} | ${details.join(' | ')}` : summary,
      ...results,
    });
  } catch (error) {
    console.error('Travel upload error:', error);
    return NextResponse.json({ error: 'فشل في استيراد الحجوزات' }, { status: 500 });
  }
}

// ═══════════════════════════════════════════════════════
//  DEAL Column Parser
//  Handles: Customer/Employee/Destination/Date
//  Or: Date/Employee/Destination  (date at beginning)
// ═══════════════════════════════════════════════════════

function parseDealColumn(deal: string): {
  customerName: string;
  employeeName: string;
  destination: string;
  date: string;
} {
  const parts = deal.split('/').map((p) => p.trim()).filter((p) => p.length > 0);

  if (parts.length === 0) return { customerName: '', employeeName: '', destination: '', date: '' };

  // ── Check if LAST 3 parts form a date: DD/M/YYYY ──
  if (parts.length >= 5) {
    const [p1, p2, p3] = [parts[parts.length - 3], parts[parts.length - 2], parts[parts.length - 1]];
    if (/^\d{1,2}$/.test(p1) && /^\d{1,2}$/.test(p2) && /^\d{2,4}$/.test(p3)) {
      const day = parseInt(p1);
      const month = parseInt(p2);
      if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
        const year = p3.length === 2 ? parseInt('20' + p3) : parseInt(p3);
        const dateStr = `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
        const nameParts = parts.slice(0, -3);
        return assignNameParts(nameParts, dateStr);
      }
    }
  }

  // ── Check if FIRST 3 parts form a date: DD/MM/YYYY ──
  if (parts.length >= 4) {
    const [p1, p2, p3] = [parts[0], parts[1], parts[2]];
    if (/^\d{1,2}$/.test(p1) && /^\d{1,2}$/.test(p2) && /^\d{2,4}$/.test(p3)) {
      const day = parseInt(p1);
      const month = parseInt(p2);
      if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
        const year = p3.length === 2 ? parseInt('20' + p3) : parseInt(p3);
        const dateStr = `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
        const nameParts = parts.slice(3);
        return assignNameParts(nameParts, dateStr);
      }
    }
  }

  // ── No date detected - treat all as names ──
  return assignNameParts(parts, '');
}

function assignNameParts(nameParts: string[], date: string): {
  customerName: string;
  employeeName: string;
  destination: string;
  date: string;
} {
  if (nameParts.length === 0) return { customerName: '', employeeName: '', destination: '', date };
  if (nameParts.length === 1) return { customerName: '', employeeName: nameParts[0], destination: '', date };
  if (nameParts.length === 2) return { customerName: nameParts[0], employeeName: nameParts[1], destination: '', date };
  return {
    customerName: nameParts[0],
    employeeName: nameParts[1],
    destination: nameParts.slice(2).join(' / '),
    date,
  };
}

// ═══════════════════════════════════════════════════════
//  Fuzzy Employee Matcher + Auto-Create
// ═══════════════════════════════════════════════════════

function normalizeName(name: string): string {
  return name
    .trim()
    .replace(/[.\-,;:!?'"()\[\]{}<>]/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function levenshtein(a: string, b: string): number {
  const la = a.length;
  const lb = b.length;
  const matrix: number[][] = Array.from({ length: lb + 1 }, () => []);

  for (let i = 0; i <= lb; i++) matrix[i][0] = i;
  for (let j = 0; j <= la; j++) matrix[0][j] = j;

  for (let i = 1; i <= lb; i++) {
    for (let j = 1; j <= la; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[lb][la];
}

interface EmpRecord {
  id: string;
  name: string;
}

async function findOrCreateEmployee(
  rawName: string,
  existingEmployees: EmpRecord[]
): Promise<{ employeeId: string | null; created: boolean; fuzzyMatch: boolean }> {
  const trimmed = rawName.trim();
  if (!trimmed) return { employeeId: null, created: false, fuzzyMatch: false };

  const normalized = normalizeName(trimmed);
  const threshold = Math.max(3, Math.floor(Math.min(normalized.length, 30) * 0.3));

  // ── 1. Exact match (normalized) ──
  for (const emp of existingEmployees) {
    if (normalizeName(emp.name) === normalized) {
      return { employeeId: emp.id, created: false, fuzzyMatch: false };
    }
  }

  // ── 2. Contains match (one contains the other) ──
  for (const emp of existingEmployees) {
    const empNorm = normalizeName(emp.name);
    if (empNorm.includes(normalized) || normalized.includes(empNorm)) {
      // Additional check: the shorter one must be at least 3 chars
      const shorter = Math.min(empNorm.length, normalized.length);
      if (shorter >= 3) {
        return { employeeId: emp.id, created: false, fuzzyMatch: true };
      }
    }
  }

  // ── 3. Levenshtein fuzzy match ──
  let bestMatch: { id: string; dist: number } | null = null;
  for (const emp of existingEmployees) {
    const dist = levenshtein(normalized, normalizeName(emp.name));
    if (dist <= threshold) {
      if (!bestMatch || dist < bestMatch.dist) {
        bestMatch = { id: emp.id, dist };
      }
    }
  }
  if (bestMatch) {
    return { employeeId: bestMatch.id, created: false, fuzzyMatch: true };
  }

  // ── 4. Auto-create new employee ──
  try {
    const newEmp = await db.employee.create({
      data: {
        name: trimmed,
        email: '',
        phone: '',
        department: 'سفر',
        position: 'موظف',
        salary: 0,
        joinDate: new Date().toISOString().split('T')[0],
      },
    });
    return { employeeId: newEmp.id, created: true, fuzzyMatch: false };
  } catch (err) {
    console.error('Failed to create employee:', err);
    return { employeeId: null, created: false, fuzzyMatch: false };
  }
}

// ═══════════════════════════════════════════════════════
//  Date Helpers
// ═══════════════════════════════════════════════════════

function normalizeDate(val: unknown): string {
  const str = String(val).trim();
  if (!str) return '';

  // Excel serial number
  if (/^\d{5}$/.test(str)) {
    const serial = parseInt(str, 10);
    const epoch = new Date(1899, 11, 30);
    const date = new Date(epoch.getTime() + serial * 86400000);
    return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
  }

  // DD/MM/YYYY or DD/MM/YY
  const dmy = str.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (dmy) {
    let d = parseInt(dmy[1], 10);
    let m = parseInt(dmy[2], 10);
    let y = parseInt(dmy[3], 10);
    if (y < 100) y += 2000;
    return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
  }

  // YYYY-MM-DD or YYYY/MM/DD
  const ymd = str.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/);
  if (ymd) {
    return `${String(parseInt(ymd[3], 10)).padStart(2, '0')}/${String(parseInt(ymd[2], 10)).padStart(2, '0')}/${ymd[1]}`;
  }

  // Fallback: JS Date parsing
  try {
    const d = new Date(str);
    if (!isNaN(d.getTime())) {
      return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
    }
  } catch {
    /* ignore */
  }

  return '';
}

function parseDateToNumber(dateStr: string): number {
  const p = dateStr.split('/');
  if (p.length !== 3) return 0;
  return (parseInt(p[2], 10) || 0) * 10000 + (parseInt(p[1], 10) || 0) * 100 + (parseInt(p[0], 10) || 0);
}

function dateToNumber(date: Date): number {
  return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
}