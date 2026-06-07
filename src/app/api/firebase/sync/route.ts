import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { isFirebaseConfigured, getFirebaseAdmin } from '@/lib/firebase-server';
import { getDatabase } from 'firebase-admin/database';

// ──────────────────────────────────────────────
// POST — sync all Prisma tables to Firebase RTDB
// ──────────────────────────────────────────────
export async function POST(_request: NextRequest) {
  try {
    // Check Firebase is configured server-side
    if (!isFirebaseConfigured()) {
      return NextResponse.json(
        {
          success: false,
          error: 'Firebase غير مهيأ على الخادم. يرجى إعداد متغيرات البيئة المطلوبة.',
        },
        { status: 503 }
      );
    }

    // Get Firebase RTDB reference
    const app = getFirebaseAdmin();
    const rtdb = getDatabase(app);
    const erpRef = rtdb.ref('erp');

    // Fetch all data from Prisma in parallel
    const [employees, attendance, requests, travelDeals, qualityDeductions, biometric, deductionRules] =
      await Promise.all([
        db.employee.findMany(),
        db.attendance.findMany(),
        db.request.findMany(),
        db.travelDeal.findMany(),
        db.qualityDeduction.findMany(),
        db.biometric.findMany(),
        db.deductionRule.findMany(),
      ]);

    // Convert Date objects to ISO strings for JSON serialization
    const serialize = (data: unknown[]) =>
      data.map((item) => {
        const serialized: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(item as Record<string, unknown>)) {
          if (value instanceof Date) {
            serialized[key] = value.toISOString();
          } else {
            serialized[key] = value;
          }
        }
        return serialized;
      });

    // Write each table to Firebase RTDB at /erp/{tableName}
    await erpRef.child('employees').set(serialize(employees));
    await erpRef.child('attendance').set(serialize(attendance));
    await erpRef.child('requests').set(serialize(requests));
    await erpRef.child('travelDeals').set(serialize(travelDeals));
    await erpRef.child('qualityDeductions').set(serialize(qualityDeductions));
    await erpRef.child('biometric').set(serialize(biometric));
    await erpRef.child('deductionRules').set(serialize(deductionRules));

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
