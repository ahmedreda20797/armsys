import { NextRequest, NextResponse } from 'next/server';
import { updateRecord, deleteRecord, getById, getEmployeeMap, invalidateCache } from '@/lib/db';
import { createSmartNotification } from '@/lib/rules-engine';
import type { CAPACase } from '@/types';

// ══════════════════════════════════════════════════════════════
//  GET /api/capa-cases/[id] — Fetch single CAPA case
// ══════════════════════════════════════════════════════════════
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const capaCase = await getById<CAPACase>('capaCases', id);
    if (!capaCase) {
      return NextResponse.json({ error: 'CAPA case not found' }, { status: 404 });
    }
    return NextResponse.json(capaCase);
  } catch (error) {
    console.error('[GET /api/capa-cases/:id] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ══════════════════════════════════════════════════════════════
//  PUT /api/capa-cases/[id] — Update CAPA case
// ══════════════════════════════════════════════════════════════
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { verifyPermission } = await import('@/lib/verify-permission');
    const permCheck = await verifyPermission(request, 'capa', 'update');
    if (!permCheck.allowed) {
      return NextResponse.json({ error: permCheck.error }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();

    const existing = await getById<CAPACase>('capaCases', id);
    if (!existing) {
      return NextResponse.json({ error: 'CAPA case not found' }, { status: 404 });
    }

    // Build update data
    const updateData: Record<string, any> = {};
    const allowedFields = [
      'title', 'department', 'employeeId', 'relatedFollowUpId', 'relatedRiskId',
      'relatedComplaintId', 'relatedQualityDeductionId', 'relatedHrDeductionId',
      'issueCategory', 'problemDescription', 'impactLevel',
      'impactDescription', 'rootCauseCategory', 'rootCauseDescription',
      'rootCauseVerification', 'correctiveAction', 'correctiveAssignedTo',
      'correctiveDueDate', 'correctiveStatus', 'correctiveEvidence',
      'preventiveAction', 'preventiveAssignedTo', 'preventiveDueDate',
      'preventiveStatus', 'preventiveVerificationMethod', 'verificationDate',
      'verifiedBy', 'verificationResult', 'verificationNotes', 'status',
      'priority', 'assignedTo', 'finalComments', 'relatedEmployeeIds',
      'source', 'lessonsLearned', 'attachments',
    ] as const;

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updateData[field] = body[field];
      }
    }

    // Auto-set closure fields
    if (body.status === 'closed' && existing.status !== 'closed') {
      updateData.closedAt = new Date().toISOString();
      updateData.closureDate = new Date().toISOString().split('T')[0];
    }

    // Enrich names
    const empMap = await getEmployeeMap();
    if (updateData.assignedTo) {
      updateData.assignedToName = empMap.get(updateData.assignedTo)?.name || null;
    }
    if (updateData.correctiveAssignedTo) {
      updateData.correctiveAssignedToName = empMap.get(updateData.correctiveAssignedTo)?.name || null;
    }
    if (updateData.preventiveAssignedTo) {
      updateData.preventiveAssignedToName = empMap.get(updateData.preventiveAssignedTo)?.name || null;
    }
    if (updateData.verifiedBy) {
      updateData.verifiedByName = empMap.get(updateData.verifiedBy)?.name || null;
    }

    // Add timeline event for status change
    if (body.status && body.status !== existing.status) {
      const existingTimeline = existing.timeline || [];
      const newEvent = {
        id: `tl-${Date.now()}`,
        action: 'status_changed',
        description: `تم تغيير الحالة من "${existing.status}" إلى "${body.status}"`,
        performedBy: body.updatedBy || 'system',
        performedByName: body.updatedByName || 'النظام',
        timestamp: new Date().toISOString(),
      };
      updateData.timeline = [...existingTimeline, newEvent];
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    const updated = await updateRecord('capaCases', id, updateData);
    invalidateCache('capaCases');

    // ══════════════════════════════════════════════════════════
    //  Task C4: CAPA Effectiveness Workflow
    //  When verificationResult = not_effective, generate high-priority
    //  notification and recommend reopening the CAPA case.
    // ══════════════════════════════════════════════════════════
    const rec = updated || existing;
    if (
      body.verificationResult === 'not_effective' &&
      existing.verificationResult !== 'not_effective'
    ) {
      try {
        await createSmartNotification({
          title: `فعالية غير كافية — حالة كابا: ${rec.title}`,
          description: `نتيجة التحقق من حالة كابا (${rec.capaId || ''}) هي "غير فعّال". يُنصح بإعادة فتح الحالة ومراجعة السبب الجذري والإجراءات التصحيحية. يرجى النقر لمراجعة الحالة.`,
          priority: 'high',
          category: 'capa',
          sourceModule: 'capa',
          sourceRecordId: id,
          employeeId: rec.employeeId || null,
          employeeName: rec.employeeName || null,
          assignedTo: rec.assignedTo || null,
          assignedToName: rec.assignedToName || null,
          actionUrl: `capa:${id}`,
        });
      } catch (effErr) {
        console.error('[PUT /api/capa-cases/:id] Effectiveness notification error (non-blocking):', effErr);
      }
    }

    // ══════════════════════════════════════════════════════════
    //  Task 3: CAPA Lifecycle Notifications on status changes
    // ══════════════════════════════════════════════════════════
    const newStatus = body.status;
    const oldStatus = existing.status;
    if (newStatus && newStatus !== oldStatus) {
      try {
        const caseTitle = rec.title || '';
        const capaIdRef = rec.capaId || '';
        const empId = rec.employeeId || null;
        const empName = rec.employeeName || null;
        const assignedId = rec.assignedTo || null;
        const assignedName = rec.assignedToName || null;

        const STATUS_NOTIFICATIONS: Record<string, { title: string; desc: string; priority: string }> = {
          investigation: {
            title: `بدء التحقيق — حالة كابا: ${caseTitle}`,
            desc: `تم بدء مرحلة التحقيق لحالة كابا (${capaIdRef}). يرجى جمع الأدلة والشهادات ذات الصلة.`,
            priority: 'medium',
          },
          root_cause_analysis: {
            title: `بدء تحليل السبب الجذري — حالة كابا: ${caseTitle}`,
            desc: `تم الانتقال إلى مرحلة تحليل السبب الجذري لحالة كابا (${capaIdRef}). استخدم أدوات تحليل السبب الجذري المناسبة.`,
            priority: 'medium',
          },
          corrective_action: {
            title: `بدء الإجراء التصحيحي — حالة كابا: ${caseTitle}`,
            desc: `تم بدء مرحلة الإجراء التصحيحي لحالة كابا (${capaIdRef}). يرجى تنفيذ الإجراءات المخططة وتوثيقها.`,
            priority: 'high',
          },
          preventive_action: {
            title: `بدء الإجراء الوقائي — حالة كابا: ${caseTitle}`,
            desc: `تم الانتقال إلى مرحلة الإجراء الوقائي لحالة كابا (${capaIdRef}). يرجى تحديد الإجراءات الوقائية لمنع تكرار المشكلة.`,
            priority: 'high',
          },
          reopened: {
            title: `تم إعادة فتح حالة كابا: ${caseTitle}`,
            desc: `تم إعادة فتح حالة كابا (${capaIdRef}) التي كانت مغلقة. يرجى مراجعة الأسباب واتخاذ الإجراءات اللازمة.`,
            priority: 'high',
          },
          verification: {
            title: `بدء مرحلة التحقق — حالة كابا: ${caseTitle}`,
            desc: `تم الانتقال إلى مرحلة التحقق من فعالية الإجراءات لحالة كابا (${capaIdRef}). يرجى التحقق من تنفيذ الإجراءات وفعاليتها.`,
            priority: 'medium',
          },
          verified: {
            title: `تم التحقق من حالة كابا: ${caseTitle}`,
            desc: `تم التحقق من حالة كابا (${capaIdRef}) بنجاح. النتيجة: ${body.verificationResult || 'قيد المراجعة'}.`,
            priority: 'medium',
          },
          closed: {
            title: `تم إغلاق حالة كابا: ${caseTitle}`,
            desc: `تم إغلاق حالة كابا (${capaIdRef}) بنجاح. الدروس المستفادة تم توثيقها.`,
            priority: 'low',
          },
        };

        const notifConfig = STATUS_NOTIFICATIONS[newStatus];
        if (notifConfig) {
          await createSmartNotification({
            title: notifConfig.title,
            description: notifConfig.desc,
            priority: notifConfig.priority as any,
            category: 'capa',
            sourceModule: 'capa',
            sourceRecordId: id,
            employeeId: empId,
            employeeName: empName,
            assignedTo: assignedId,
            assignedToName: assignedName,
            actionUrl: `capa:${id}`,
          });
        }

        // Notification for assignee changes
        if (updateData.assignedTo && updateData.assignedTo !== existing.assignedTo) {
          await createSmartNotification({
            title: `تم تعيينك لحالة كابا: ${caseTitle}`,
            description: `تم تعيينك لحالة كابا (${capaIdRef}) بأولوية ${rec.priority || existing.priority}. يرجى البدء بالمعالجة.`,
            priority: 'medium',
            category: 'capa',
            sourceModule: 'capa',
            sourceRecordId: id,
            employeeId: updateData.assignedTo,
            employeeName: updateData.assignedToName || null,
            assignedTo: updateData.assignedTo,
            assignedToName: updateData.assignedToName || null,
            actionUrl: `capa:${id}`,
          });
        }
      } catch (notifErr) {
        console.error('[PUT /api/capa-cases/:id] Notification error (non-blocking):', notifErr);
      }
    }

    return NextResponse.json(updated);
  } catch (error) {
    console.error('[PUT /api/capa-cases/:id] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ══════════════════════════════════════════════════════════════
//  DELETE /api/capa-cases/[id] — Delete CAPA case
// ══════════════════════════════════════════════════════════════
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { verifyPermission } = await import('@/lib/verify-permission');
    const permCheck = await verifyPermission(request, 'capa', 'delete');
    if (!permCheck.allowed) {
      return NextResponse.json({ error: permCheck.error }, { status: 403 });
    }

    const { id } = await params;
    await deleteRecord('capaCases', id);
    invalidateCache('capaCases');
    return NextResponse.json({ message: 'CAPA case deleted successfully' });
  } catch (error) {
    console.error('[DELETE /api/capa-cases/:id] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
