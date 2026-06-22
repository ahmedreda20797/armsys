import { NextRequest, NextResponse } from 'next/server';
import { getAll, createRecord, TTL } from '@/lib/db';
import { requireAuth } from '@/lib/verify-permission';
import type { AutomationRule } from '@/types';

// ══════════════════════════════════════════════════════════════
//  GET /api/rules — Fetch automation rules with filtering
// ══════════════════════════════════════════════════════════════
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);

    const status = searchParams.get('status');
    const module = searchParams.get('module');
    const priority = searchParams.get('priority');
    const triggerType = searchParams.get('triggerType');
    const search = searchParams.get('search');
    const isTemplate = searchParams.get('isTemplate');
    const templateCategory = searchParams.get('templateCategory');
    const limit = parseInt(searchParams.get('limit') || '100', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    let records = await getAll<AutomationRule>('automationRules', TTL.LONG);

    // Server-side filters
    if (status) records = records.filter((r) => r.status === status);
    if (module) records = records.filter((r) => r.module === module);
    if (priority) records = records.filter((r) => r.priority === priority);
    if (triggerType) records = records.filter((r) => r.triggerType === triggerType);
    if (isTemplate !== null) records = records.filter((r) => ((r as any).isTemplate === true) === (isTemplate === 'true'));
    if (templateCategory) records = records.filter((r) => (r as any).templateCategory === templateCategory);
    if (search) {
      const lowerSearch = search.toLowerCase();
      records = records.filter(
        (r) =>
          r.name.toLowerCase().includes(lowerSearch) ||
          r.description.toLowerCase().includes(lowerSearch) ||
          r.module.toLowerCase().includes(lowerSearch)
      );
    }

    // Sort by createdAt descending (newest first)
    records.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    // Apply pagination
    const paginated = records.slice(offset, offset + limit);

    return NextResponse.json({
      data: paginated,
      total: records.length,
      limit,
      offset,
    });
  } catch (error) {
    console.error('[GET /api/rules] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// ══════════════════════════════════════════════════════════════
//  POST /api/rules — Create new automation rule
// ══════════════════════════════════════════════════════════════
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const {
      name,
      description,
      module,
      priority,
      status,
      triggerType,
      schedule,
      conditions,
      actions,
      escalationConfig,
      throttleMinutes,
      createdById,
      createdByName,
    } = body;

    // Validation
    if (!name || !module) {
      return NextResponse.json(
        { error: 'name and module are required' },
        { status: 400 }
      );
    }

    if (!conditions || !conditions.logic || !Array.isArray(conditions.conditions)) {
      return NextResponse.json(
        { error: 'Valid conditions object with logic and conditions array is required' },
        { status: 400 }
      );
    }

    if (!actions || !Array.isArray(actions) || actions.length === 0) {
      return NextResponse.json(
        { error: 'At least one action is required' },
        { status: 400 }
      );
    }

    const validPriorities = ['low', 'medium', 'high', 'critical'];
    const validStatuses = ['active', 'inactive', 'draft'];
    const validTriggerTypes = [
      'record_created', 'record_updated', 'record_deleted', 'status_changed',
      'date_reached', 'threshold_reached', 'manual', 'scheduled',
    ];

    const rule = await createRecord<AutomationRule>('automationRules', {
      name,
      description: description || '',
      module,
      priority: validPriorities.includes(priority) ? priority : 'medium',
      status: validStatuses.includes(status) ? status : 'draft',
      triggerType: validTriggerTypes.includes(triggerType) ? triggerType : 'manual',
      schedule: schedule || null,
      conditions,
      actions,
      escalationConfig: escalationConfig || null,
      throttleMinutes: typeof throttleMinutes === 'number' ? throttleMinutes : 0,
      lastRunAt: null,
      lastTriggeredBy: null,
      totalExecutions: 0,
      successCount: 0,
      failCount: 0,
      createdById: createdById || 'system',
      createdByName: createdByName || 'النظام',
    });

    return NextResponse.json(rule, { status: 201 });
  } catch (error) {
    console.error('[POST /api/rules] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}