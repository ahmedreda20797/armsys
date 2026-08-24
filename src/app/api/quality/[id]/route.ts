import { NextRequest, NextResponse } from 'next/server';
import { getById, updateRecord, deleteRecord } from '@/lib/db';
import { verifyPermission } from '@/lib/verify-permission';
import { asScopeViewer, employeeInScope } from '@/lib/scope/server';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Check 'update' permission
    const permCheck = await verifyPermission(request, 'quality', 'update');
    if (!permCheck.allowed) {
      return NextResponse.json({ error: permCheck.error }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();

    // ── TARGET RESOURCE + DATA SCOPE (M0.4) ──
    // The stored deduction's employeeId governs (this route cannot
    // reassign it); out-of-scope → 404 identical to the missing
    // record path (anti-enumeration).
    const existing = await getById('qualityDeductions', id);
    if (!existing) {
      return NextResponse.json({ error: 'Quality deduction not found' }, { status: 404 });
    }
    const inScope = await employeeInScope(
      asScopeViewer(permCheck.user!),
      permCheck.user!.permissions,
      existing.employeeId,
    );
    if (!inScope) {
      return NextResponse.json({ error: 'Quality deduction not found' }, { status: 404 });
    }

    const { date, type, description, deductionDays, deductionAmount, evidence, month, relatedCapaId } = body;

    const qualityDeduction = await updateRecord('qualityDeductions', id, {
      ...(date !== undefined && { date }),
      ...(type !== undefined && { type }),
      ...(description !== undefined && { description }),
      ...(deductionDays !== undefined && { deductionDays: Number(deductionDays) }),
      ...(deductionAmount !== undefined && { deductionAmount: Number(deductionAmount) }),
      ...(evidence !== undefined && { evidence }),
      ...(month !== undefined && { month }),
      ...(relatedCapaId !== undefined && { relatedCapaId }),
    });

    return NextResponse.json(qualityDeduction);
  } catch (error) {
    console.error('Update quality deduction error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Check 'delete' permission
    const permCheck = await verifyPermission(request, 'quality', 'delete');
    if (!permCheck.allowed) {
      return NextResponse.json({ error: permCheck.error }, { status: 403 });
    }

    const { id } = await params;

    // ── TARGET RESOURCE + DATA SCOPE (M0.4) ──
    // Resolve the stored deduction's employee BEFORE deleting;
    // out-of-scope → 404 identical to the missing path.
    const existing = await getById('qualityDeductions', id);
    if (!existing) {
      return NextResponse.json({ error: 'Quality deduction not found' }, { status: 404 });
    }
    const inScope = await employeeInScope(
      asScopeViewer(permCheck.user!),
      permCheck.user!.permissions,
      existing.employeeId,
    );
    if (!inScope) {
      return NextResponse.json({ error: 'Quality deduction not found' }, { status: 404 });
    }

    await deleteRecord('qualityDeductions', id);
    return NextResponse.json({ message: 'Quality deduction deleted successfully' });
  } catch (error) {
    console.error('Delete quality deduction error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
