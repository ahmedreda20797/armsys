import { NextRequest, NextResponse } from 'next/server';
import { getAll, getById, findWhere, findWhereContains } from '@/lib/db';
import { verifyPermission } from '@/lib/verify-permission';

// ══════════════════════════════════════════════════════════════
//  Safe fetch helper — never throws, returns empty array on failure
// ══════════════════════════════════════════════════════════════
async function safe<T>(promise: Promise<T>): Promise<T | []> {
  try {
    return await promise;
  } catch (err) {
    console.warn('[employee-360] safe fetch failed:', (err as Error).message);
    return [];
  }
}

// ══════════════════════════════════════════════════════════════
//  Employee 360 Profile API
//  Aggregates data from ALL modules for a single employee
//  Uses Promise.allSettled so missing Firebase tables don't crash
// ══════════════════════════════════════════════════════════════

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const permCheck = await verifyPermission(request, 'employees', 'view');
    if (!permCheck.allowed) {
      return NextResponse.json({ error: 'ليس لديك صلاحية' }, { status: 403 });
    }

    const { id: employeeId } = await params;

    if (!employeeId) {
      return NextResponse.json({ error: 'معرف الموظف مطلوب' }, { status: 400 });
    }

    // ═══ Fetch employee base data ═══
    const employee = await getById('employees', employeeId);
    if (!employee) {
      return NextResponse.json({ error: 'الموظف غير موجود' }, { status: 404 });
    }

    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const datePattern = `/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;

    // ═══ Parallel fetch from ALL data sources — using Promise.allSettled ═══
    // Each table that doesn't exist in Firebase will be caught gracefully
    const results = await Promise.allSettled([
      findWhereContains('attendance', 'date', datePattern),
      findWhereContains('biometrics', 'date', datePattern),
      findWhereContains('requests', 'date', datePattern),
      findWhere('qualityDeductions', { month: currentMonth }),
      findWhere('hrDeductions', { month: currentMonth }),
      getAll('followUps'),
      getAll('travelDeals'),
      getAll('complaints'),
      getAll('capaCases'),
    ]);

    // Extract fulfilled results or fall back to empty array
    const allAttendance   = results[0].status === 'fulfilled' ? results[0].value : [];
    const allBiometrics   = results[1].status === 'fulfilled' ? results[1].value : [];
    const allRequests     = results[2].status === 'fulfilled' ? results[2].value : [];
    const allQualityDeductions = results[3].status === 'fulfilled' ? results[3].value : [];
    const allHrDeductions = results[4].status === 'fulfilled' ? results[4].value : [];
    const allFollowUps    = results[5].status === 'fulfilled' ? results[5].value : [];
    const allTravelDeals  = results[6].status === 'fulfilled' ? results[6].value : [];
    const allComplaints   = results[7].status === 'fulfilled' ? results[7].value : [];
    const allCapaCases    = results[8].status === 'fulfilled' ? results[8].value : [];

    // ═══ Filter by employee ═══
    const empAttendance = (allAttendance as any[]).filter((r) => r.employeeId === employeeId);
    const empBiometrics = (allBiometrics as any[]).filter((r) => r.employeeId === employeeId);
    const empRequests = (allRequests as any[]).filter((r) => r.employeeId === employeeId);
    const empQuality = (allQualityDeductions as any[]).filter((r) => r.employeeId === employeeId);
    const empHrDeductions = (allHrDeductions as any[]).filter((r) => r.employeeId === employeeId);
    const empFollowUps = (allFollowUps as any[]).filter((r) => r.employeeId === employeeId);
    const empTravel = (allTravelDeals as any[]).filter((r) => r.employeeId === employeeId);
    const empComplaints = (allComplaints as any[]).filter((r) => r.employeeId === employeeId);
    const empCapa = (allCapaCases as any[]).filter((r) =>
      (r.relatedEmployeeIds || []).includes(employeeId)
    );

    // ═══ Attendance stats ═══
    const totalPresent = empAttendance.filter((a) => a.status === 'present').length;
    const totalLate = empAttendance.filter((a) => a.status === 'late').length;
    const totalAbsent = empAttendance.filter((a) => a.status === 'absent').length;
    const totalExempt = empAttendance.filter((a) => a.status === 'approved').length;
    const totalMinutesLate = empAttendance.reduce((s: number, a: any) => s + (a.minutesLate || 0), 0);

    // ═══ Quality stats ═══
    const qualityDeductionDays = empQuality.reduce((s: number, q: any) => s + (q.deductionDays || 0), 0);
    const qualityDeductionAmount = empQuality.reduce((s: number, q: any) => s + (q.deductionAmount || 0), 0);

    // ═══ HR Deductions stats ═══
    const hrDeductionTotal = empHrDeductions.reduce((s: number, h: any) => {
      return s + (h.unit === 'days' ? 0 : (h.amount || 0));
    }, 0);
    const hrDeductionDays = empHrDeductions.reduce((s: number, h: any) => {
      return s + (h.unit === 'days' ? (h.amount || 0) : 0);
    }, 0);

    // ═══ Follow-ups stats ═══
    const openFollowUps = empFollowUps.filter((f: any) =>
      ['open', 'under_review', 'under_follow_up'].includes(f.status)
    );
    const criticalFollowUps = empFollowUps.filter((f: any) => f.priorityLevel === 'critical' && f.status !== 'closed' && f.status !== 'cancelled');

    // ═══ Requests stats ═══
    const pendingRequests = empRequests.filter((r) => r.status === 'pending');
    const approvedRequests = empRequests.filter((r) => r.status === 'approved');
    const rejectedRequests = empRequests.filter((r) => r.status === 'rejected');

    // ═══ Travel stats ═══
    const activeTrips = empTravel.filter((t) => ['upcoming', 'in_progress'].includes(t.status));
    const completedTrips = empTravel.filter((t) => t.status === 'completed');

    // ═══ Complaints stats ═══
    const openComplaints = empComplaints.filter((c: any) =>
      ['open', 'under_investigation', 'pending_resolution'].includes(c.status)
    );

    // ═══ CAPA stats ═══
    const openCapa = empCapa.filter((c: any) =>
      ['open', 'investigation', 'root_cause_analysis', 'corrective_action', 'preventive_action', 'verification', 'reopened'].includes(c.status)
    );
    const closedCapa = empCapa.filter((c: any) => c.status === 'closed');
    const overdueCapa = empCapa.filter((c: any) => c.overdueDays > 0 && c.status !== 'closed' && c.status !== 'rejected');
    const criticalCapa = empCapa.filter((c: any) => c.priority === 'critical' && c.status !== 'closed' && c.status !== 'rejected');
    const reopenedCapa = empCapa.filter((c: any) => c.status === 'reopened');
    const capaEffectiveness = closedCapa.length > 0
      ? closedCapa.filter((c: any) => c.verificationResult === 'effective').length
      : 0;

    // ═══ Risk Score Calculation (includes CAPA factors) ═══
    let riskScore = 0;

    if (totalAbsent > 4) riskScore += Math.min((totalAbsent - 4) * 3, 20);
    if (totalLate > 5) riskScore += Math.min((totalLate - 5) * 1, 10);
    riskScore += Math.min(qualityDeductionDays * 5, 25);
    riskScore += Math.min(hrDeductionDays * 5, 15);
    riskScore += Math.min(openFollowUps.length * 3, 15);
    riskScore += Math.min(criticalFollowUps.length * 10, 30);
    riskScore += Math.min(openComplaints.length * 5, 20);
    // CAPA risk factors (Task 6)
    riskScore += Math.min(openCapa.length * 3, 15);
    riskScore += Math.min(overdueCapa.length * 5, 20);
    riskScore += Math.min(criticalCapa.length * 10, 30);
    riskScore += Math.min(reopenedCapa.length * 7, 20);

    riskScore = Math.min(riskScore, 100);

    // Risk level
    let riskLevel: 'low' | 'medium' | 'high' | 'critical';
    if (riskScore <= 10) riskLevel = 'low';
    else if (riskScore <= 25) riskLevel = 'medium';
    else if (riskScore <= 50) riskLevel = 'high';
    else riskLevel = 'critical';

    // ═══ Health Score (inverse of risk) ═══
    const healthScore = Math.max(100 - riskScore, 0);

    // ═══ Build chronological timeline ═══
    const timeline: any[] = [];

    for (const a of empAttendance) {
      timeline.push({
        type: 'attendance',
        date: a.date,
        title: a.status === 'present' ? 'حضور' : a.status === 'late' ? 'تأخير' : a.status === 'absent' ? 'غياب' : 'معفي',
        description: a.status === 'late' ? `متأخر ${a.minutesLate || 0} دقيقة` : '',
        status: a.status,
        timestamp: a.createdAt,
      });
    }

    for (const q of empQuality) {
      timeline.push({
        type: 'quality',
        date: q.date,
        title: `خصم جودة: ${q.type}`,
        description: q.description,
        status: 'deduction',
        timestamp: q.createdAt,
      });
    }

    for (const h of empHrDeductions) {
      timeline.push({
        type: 'hrDeduction',
        date: h.deductionDate || h.createdAt,
        title: `خصم HR: ${h.type}`,
        description: h.reason,
        status: h.status,
        timestamp: h.createdAt,
      });
    }

    for (const r of empRequests) {
      timeline.push({
        type: 'request',
        date: r.date,
        title: `طلب: ${r.type}`,
        description: r.reason,
        status: r.status,
        timestamp: r.createdAt,
      });
    }

    for (const f of empFollowUps) {
      timeline.push({
        type: 'followUp',
        date: f.date,
        title: `متابعة: ${f.followUpType}`,
        description: f.subject,
        status: f.status,
        priority: f.priorityLevel,
        timestamp: f.createdAt,
      });
    }

    for (const c of empComplaints) {
      timeline.push({
        type: 'complaint',
        date: c.createdAt?.split('T')[0] || '',
        title: `شكوى: ${c.complaintType}`,
        description: c.description,
        status: c.status,
        severity: c.severity,
        timestamp: c.createdAt,
      });
    }

    for (const t of empTravel) {
      timeline.push({
        type: 'travel',
        date: t.departureDate,
        title: `سفر: ${t.destination}`,
        description: '',
        status: t.status,
        timestamp: t.createdAt,
      });
    }

    // ═══ CAPA timeline events (Task 2) ═══
    for (const capa of empCapa) {
      // Creation event
      timeline.push({
        type: 'capa',
        date: capa.createdAt?.split('T')[0] || '',
        title: `CAPA: ${capa.capaId || capa.title}`,
        description: `تم إنشاء حالة ${capa.title} - الأولوية: ${capa.priority}`,
        status: 'created',
        priority: capa.priority,
        timestamp: capa.createdAt,
        capaId: capa.id,
      });

      // Add timeline events from CAPA case
      if (Array.isArray(capa.timeline)) {
        for (const evt of capa.timeline) {
          timeline.push({
            type: 'capa',
            date: evt.timestamp?.split('T')[0] || '',
            title: `CAPA ${capa.capaId || ''}: ${evt.action}`,
            description: evt.description,
            status: evt.action?.toLowerCase() || 'updated',
            user: evt.performedByName || evt.performedBy || '',
            timestamp: evt.timestamp,
            capaId: capa.id,
          });
        }
      }
    }

    // Sort by date descending
    timeline.sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());

    // ═══ Smart Recommendations ═══
    const recommendations: string[] = [];
    if (totalAbsent > 6) recommendations.push('معدل الغياب مرتفع - يجب عمل خطة تحسين حضور');
    if (totalLate > 5) recommendations.push('تأخير متكرر - يحتاج متابعة دورية');
    if (qualityDeductionDays > 3) recommendations.push('خصومات جودة مرتفعة - يحتاج تدريب إضافي');
    if (openFollowUps.length > 3) recommendations.push('عدد كبير من المتابعات المفتوحة - يجب تسريع الإغلاق');
    if (criticalFollowUps.length > 0) recommendations.push('يوجد حالات حرجة تحتاج تدخل فوري');
    if (openComplaints.length > 0) recommendations.push('شكاوى عملاء مفتوحة - يجب المعالجة بسرعة');
    if (openCapa.length > 0) recommendations.push(`يوجد ${openCapa.length} حالات CAPA مفتوحة - يجب المتابعة`);
    if (overdueCapa.length > 0) recommendations.push(`يوجد ${overdueCapa.length} حالات CAPA متأخرة - يجب التسريع`);
    if (reopenedCapa.length > 0) recommendations.push(`يوجد ${reopenedCapa.length} حالات CAPA معاد فتحها - يجب مراجعة فعالية الحلول`);
    if (healthScore < 40) recommendations.push('مستوى الأداء منخفض جداً - يحتاج خطة تحسين شاملة');

    return NextResponse.json({
      employee: {
        id: employee.id,
        name: employee.name,
        code: employee.code || null,
        department: employee.department || null,
        position: employee.position || null,
        shiftStart: employee.shiftStart || null,
        shiftEnd: employee.shiftEnd || null,
        hireDate: employee.hireDate || null,
        mobile: employee.mobile || null,
        createdById: employee.createdById || null,
      },
      stats: {
        attendance: {
          totalPresent,
          totalLate,
          totalAbsent,
          totalExempt,
          totalMinutesLate,
        },
        quality: {
          totalDeductions: empQuality.length,
          deductionDays: qualityDeductionDays,
          deductionAmount: qualityDeductionAmount,
        },
        hrDeductions: {
          totalDeductions: empHrDeductions.length,
          deductionDays: hrDeductionDays,
          deductionAmount: hrDeductionTotal,
        },
        requests: {
          total: empRequests.length,
          pending: pendingRequests.length,
          approved: approvedRequests.length,
          rejected: rejectedRequests.length,
        },
        followUps: {
          total: empFollowUps.length,
          open: openFollowUps.length,
          critical: criticalFollowUps.length,
        },
        travel: {
          total: empTravel.length,
          active: activeTrips.length,
          completed: completedTrips.length,
        },
        complaints: {
          total: empComplaints.length,
          open: openComplaints.length,
        },
        capa: {
          total: empCapa.length,
          open: openCapa.length,
          closed: closedCapa.length,
          overdue: overdueCapa.length,
          critical: criticalCapa.length,
          reopened: reopenedCapa.length,
          effectiveness: capaEffectiveness,
        },
      },
      risk: {
        score: riskScore,
        level: riskLevel,
        breakdown: {
          attendance: totalAbsent > 4 ? Math.min((totalAbsent - 4) * 3, 20) : 0,
          late: totalLate > 5 ? Math.min((totalLate - 5) * 1, 10) : 0,
          quality: Math.min(qualityDeductionDays * 5, 25),
          hrDeductions: Math.min(hrDeductionDays * 5, 15),
          openFollowUps: Math.min(openFollowUps.length * 3, 15),
          criticalFollowUps: Math.min(criticalFollowUps.length * 10, 30),
          openComplaints: Math.min(openComplaints.length * 5, 20),
          openCapa: Math.min(openCapa.length * 3, 15),
          overdueCapa: Math.min(overdueCapa.length * 5, 20),
          criticalCapa: Math.min(criticalCapa.length * 10, 30),
          reopenedCapa: Math.min(reopenedCapa.length * 7, 20),
        },
      },
      healthScore,
      timeline,
      recommendations,
    });
  } catch (error) {
    console.error('Employee 360 error:', error);
    return NextResponse.json({ error: 'خطأ داخلي في الخادم' }, { status: 500 });
  }
}