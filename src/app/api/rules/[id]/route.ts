import { NextRequest, NextResponse } from 'next/server';
import { getById, updateRecord, deleteRecord } from '@/lib/db';
import { requireAuth } from '@/lib/verify-permission';
import type { AutomationRule } from '@/types';

// ══════════════════════════════════════════════════════════════
//  GET /api/rules/[id] — Fetch single automation rule
// ══════════════════════════════════════════════════════════════
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const rule = await getById<AutomationRule>('automationRules', id);

    if (!rule) {
      return NextResponse.json(
        { error: 'Automation rule not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(rule);
  } catch (error) {
    console.error('[GET /api/rules/:id] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// ══════════════════════════════════════════════════════════════
//  PATCH /api/rules/[id] — Update automation rule
// ══════════════════════════════════════════════════════════════
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();

    const existing = await getById<AutomationRule>('automationRules', id);
    if (!existing) {
      return NextResponse.json(
        { error: 'Automation rule not found' },
        { status: 404 }
      );
    }

    // Build update data with validation
    const updateData: Record<string, any> = {};

    const allowedFields = [
      'name', 'description', 'module', 'priority', 'status',
      'triggerType', 'schedule', 'conditions', 'actions',
      'escalationConfig', 'throttleMinutes',
    ] as const;

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updateData[field] = body[field];
      }
    }

    // Validate enums
    if (updateData.priority) {
      const validPriorities = ['low', 'medium', 'high', 'critical'];
      if (!validPriorities.includes(updateData.priority)) {
        return NextResponse.json(
          { error: `Invalid priority. Must be one of: ${validPriorities.join(', ')}` },
          { status: 400 }
        );
      }
    }

    if (updateData.status) {
      const validStatuses = ['active', 'inactive', 'draft'];
      if (!validStatuses.includes(updateData.status)) {
        return NextResponse.json(
          { error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` },
          { status: 400 }
        );
      }
    }

    if (updateData.triggerType) {
      const validTriggerTypes = [
        'record_created', 'record_updated', 'record_deleted', 'status_changed',
        'date_reached', 'threshold_reached', 'manual', 'scheduled',
      ];
      if (!validTriggerTypes.includes(updateData.triggerType)) {
        return NextResponse.json(
          { error: `Invalid triggerType. Must be one of: ${validTriggerTypes.join(', ')}` },
          { status: 400 }
        );
      }
    }

    if (updateData.throttleMinutes !== undefined) {
      updateData.throttleMinutes = Math.max(0, Number(updateData.throttleMinutes) || 0);
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { error: 'No valid fields to update' },
        { status: 400 }
      );
    }

    const updated = await updateRecord('automationRules', id, updateData);

    return NextResponse.json(updated);
  } catch (error) {
    console.error('[PATCH /api/rules/:id] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// ══════════════════════════════════════════════════════════════
//  DELETE /api/rules/[id] — Delete automation rule
// ══════════════════════════════════════════════════════════════
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    const existing = await getById('automationRules', id);
    if (!existing) {
      return NextResponse.json(
        { error: 'Automation rule not found' },
        { status: 404 }
      );
    }

    await deleteRecord('automationRules', id);

    return NextResponse.json({ message: 'Automation rule deleted successfully' });
  } catch (error) {
    console.error('[DELETE /api/rules/:id] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}