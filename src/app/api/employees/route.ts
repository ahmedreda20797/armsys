import { NextRequest, NextResponse } from 'next/server';
import { getAll, createRecord, sortByDateField, withRelatedCounts } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const includeCounts = searchParams.get('counts') === 'true';
    
    let employees = await getAll('employees');
    // Sort by employee code numerically (1 → 100), supports "001", "EMP-01", plain numbers
    const extractCode = (code: any) => {
      const num = parseInt(String(code || '').replace(/\D/g, ''));
      return isNaN(num) ? Infinity : num;
    };
    employees.sort((a: any, b: any) => {
      const codeA = extractCode(a.code);
      const codeB = extractCode(b.code);
      if (codeA !== codeB) return codeA - codeB;
      // Same code or both empty: newest first
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
    
    // Only compute related counts when explicitly requested
    // This avoids 5 extra table scans on the default list view
    if (includeCounts) {
      const employeesWithCounts = await withRelatedCounts(employees as any[]);
      return NextResponse.json(employeesWithCounts);
    }
    
    return NextResponse.json(employees);
  } catch (error) {
    console.error('Fetch employees error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { code, name, department, position, shiftStart, shiftEnd, hireDate, mobile, createdById } = body;

    if (!name) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }

    // Auto-generate sequential code if not provided
    let finalCode = code || null;
    if (!finalCode) {
      const allEmployees = await getAll('employees');
      // Find the last code to detect pattern (prefix + zero-padding)
      let maxCode = 0;
      let lastCodeStr = '';
      for (const emp of allEmployees as any[]) {
        const raw = String(emp.code || '').trim();
        const num = parseInt(raw.replace(/\D/g, ''));
        if (!isNaN(num) && num > maxCode) {
          maxCode = num;
          lastCodeStr = raw;
        }
      }
      if (lastCodeStr) {
        // Extract prefix and zero-padding from last code
        const match = lastCodeStr.match(/^(.*?)(\d+)$/);
        if (match) {
          const prefix = match[1]; // e.g. "EMP-"
          const digits = match[2].length; // e.g. 3
          finalCode = prefix + String(maxCode + 1).padStart(digits, '0');
        } else {
          finalCode = String(maxCode + 1);
        }
      } else {
        finalCode = '1';
      }
    }

    const employee = await createRecord('employees', {
      code: finalCode,
      name,
      department: department || null,
      position: position || null,
      shiftStart: shiftStart || null,
      shiftEnd: shiftEnd || null,
      hireDate: hireDate || null,
      mobile: mobile || null,
      createdById: createdById || null,
    });

    return NextResponse.json(employee, { status: 201 });
  } catch (error) {
    console.error('Create employee error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}