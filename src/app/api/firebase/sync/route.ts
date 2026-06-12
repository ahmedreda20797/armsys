import { NextRequest, NextResponse } from 'next/server';
import { getAll } from '@/lib/db';
import { isFirebaseConfigured, getFirebaseAdmin } from '@/lib/firebase-server';
import { getDatabase } from 'firebase-admin/database';

export async function POST(_request: NextRequest) {
  try {
    if (!isFirebaseConfigured()) {
      return NextResponse.json(
        {
          success: false,
          error: 'Firebase غير مهيأ على الخادم. يرجى إعداد متغيرات البيئة المطلوبة.',
        },
        { status: 503 }
      );
    }

    const app = getFirebaseAdmin();
    const rtdb = getDatabase(app);
    const erpRef = rtdb.ref('erp');

    const [employees, attendance, requests, travelDeals, qualityDeductions, biometric, deductionRules] =
      await Promise.all([
        getAll('employees'),
        getAll('attendance'),
        getAll('requests'),
        getAll('travelDeals'),
        getAll('qualityDeductions'),
        getAll('biometrics'),
        getAll('deductionRules'),
      ]);

    await erpRef.child('employees').set(employees);
    await erpRef.child('attendance').set(attendance);
    await erpRef.child('requests').set(requests);
    await erpRef.child('travelDeals').set(travelDeals);
    await erpRef.child('qualityDeductions').set(qualityDeductions);
    await erpRef.child('biometric').set(biometric);
    await erpRef.child('deductionRules').set(deductionRules);

    return NextResponse.json({
      success: true,
      synced: {
        employees: employees.length,
        attendance: attendance.length,
        requests: requests.length,
        travelDeals: travelDeals.length,
        qualityDeductions: qualityDeductions.length,
        biometric: biometric.length,
        deductionRules: deductionRules.length,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'خطأ غير معروف';
    return NextResponse.json(
      { success: false, error: `فشل المزامنة: ${message}` },
      { status: 500 }
    );
  }
}