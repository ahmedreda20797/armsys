import { NextRequest, NextResponse } from 'next/server';
import { getAll, getAllBatch, withEmployee } from '@/lib/db';
import { verifyPermission } from '@/lib/verify-permission';

/** Parse DD/MM/YYYY to a comparable number YYYYMMDD for sorting */
function parseDateToSortable(dateStr: string): number {
  const parts = dateStr.split('/');
  if (parts.length !== 3) return 0;
  const year = parseInt(parts[2], 10) || 0;
  const month = parseInt(parts[1], 10) || 0;
  const day = parseInt(parts[0], 10) || 0;
  return year * 10000 + month * 100 + day;
}

/** Calculate days remaining from today for DD/MM/YYYY */
function getDaysRemaining(dateStr: string): number {
  try {
    const parts = dateStr.split('/');
    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const year = parseInt(parts[2], 10);
    const target = new Date(year, month, day);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  } catch {
    return 0;
  }
}

function getMonthKey(dateStr: string): string {
  if (!dateStr) return 'غير محدد';
  const p = dateStr.split('/');
  if (p.length !== 3) return 'غير محدد';
  return `${p[2]}-${p[1]}`;
}

function getTripCategory(depDate: string, retDate: string | null): 'upcoming' | 'in_progress' | 'returned' {
  const retDays = retDate ? getDaysRemaining(retDate) : null;
  if (retDays !== null && retDays < 0) return 'returned';
  if (getDaysRemaining(depDate) < 0) return 'in_progress';
  return 'upcoming';
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    // ── Server-side filtering parameters ──
    const tab = searchParams.get('tab') || 'all';           // all | upcoming | in_progress | returned | canceled
    const employeeId = searchParams.get('employeeId') || '';
    const month = searchParams.get('month') || '';
    const search = searchParams.get('search') || '';
    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = parseInt(searchParams.get('pageSize') || '50', 10);
    const countsOnly = searchParams.get('counts') === 'true';

    // ── Fetch all travel deals + employees in parallel ──
    let travelDeals = await getAll('travelDeals');
    travelDeals = await withEmployee(travelDeals as any[]);

    // ── Pre-compute category for all trips (single pass) ──
    const tripsWithCategory = travelDeals.map((t: any) => ({
      ...t,
      _category: getTripCategory(t.departureDate, t.returnDate),
      _daysLeft: getDaysRemaining(t.departureDate),
      _retDays: t.returnDate ? getDaysRemaining(t.returnDate) : null,
      _monthKey: getMonthKey(t.departureDate),
    }));

    // ── Compute tab counts (needed for UI badges) ──
    // Separate canceled trips — excluded from main counts
    const isCanceled = (t: any) => t.status === 'canceled';
    let tabCounts = { all: 0, upcoming: 0, in_progress: 0, returned: 0, canceled: 0 };
    for (const t of tripsWithCategory) {
      if (isCanceled(t)) {
        tabCounts.canceled++;
        continue; // Don't count canceled in 'all'
      }
      tabCounts.all++;
      if (t._category === 'upcoming') tabCounts.upcoming++;
      else if (t._category === 'in_progress') tabCounts.in_progress++;
      else tabCounts.returned++;
    }

    // If only counts requested, return early
    if (countsOnly) {
      return NextResponse.json({ counts: tabCounts });
    }

    // ── Apply filters ──
    let filtered = tripsWithCategory;

    // Tab filter
    if (tab === 'upcoming') {
      filtered = filtered.filter((t) => t._category === 'upcoming' && !isCanceled(t));
    } else if (tab === 'in_progress') {
      filtered = filtered.filter((t) => t._category === 'in_progress' && !isCanceled(t));
    } else if (tab === 'returned') {
      filtered = filtered.filter((t) => t._category === 'returned' && !isCanceled(t));
    } else if (tab === 'canceled') {
      filtered = filtered.filter((t) => isCanceled(t));
    } else {
      // 'all' — exclude canceled
      filtered = filtered.filter((t) => !isCanceled(t));
    }

    // Employee filter
    if (employeeId) {
      filtered = filtered.filter((t) => t.employeeId === employeeId);
    }

    // Month filter
    if (month && month !== 'all') {
      filtered = filtered.filter((t) => t._monthKey === month);
    }

    // Search filter
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      filtered = filtered.filter((t) =>
        [t.employeeName, t.destination, t.dealerName || '', t.customerNames || '', t.departureDate, t.returnDate || '', t.notes || '']
          .some((f) => String(f).toLowerCase().includes(q))
      );
    }

    // ── Sort: nearest travel first ──
    filtered.sort((a, b) => {
      if (tab === 'returned' || tab === 'canceled') {
        // Most recently returned/canceled first
        return parseDateToSortable(b.returnDate || b.departureDate) - parseDateToSortable(a.returnDate || a.departureDate);
      }
      if (tab === 'in_progress') {
        // Soonest return date first
        const retA = a._retDays || a._daysLeft;
        const retB = b._retDays || b._daysLeft;
        return retA - retB;
      }
      // For 'all' and 'upcoming' tabs: upcoming/in_progress first (nearest), then returned
      const categoryOrder: Record<string, number> = { upcoming: 0, in_progress: 1, returned: 2 };
      const catA = categoryOrder[a._category] ?? 2;
      const catB = categoryOrder[b._category] ?? 2;
      if (catA !== catB) return catA - catB;
      // Within same category: nearest first
      return a._daysLeft - b._daysLeft;
    });

    // ── Compute available months from ALL trips (before pagination) ──
    const monthSet = new Set<string>();
    for (const t of tripsWithCategory) {
      if (t._monthKey !== 'غير محدد') monthSet.add(t._monthKey);
    }
    const availableMonths = Array.from(monthSet).sort((a, b) => {
      const now = new Date();
      const cy = now.getFullYear(), cm = now.getMonth() + 1;
      const distA = Math.abs((parseInt(a.split('-')[0]) - cy) * 12 + parseInt(a.split('-')[1]) - cm);
      const distB = Math.abs((parseInt(b.split('-')[0]) - cy) * 12 + parseInt(b.split('-')[1]) - cm);
      return distA - distB;
    });

    // ── Urgent trips (upcoming within 14 days, not canceled) ──
    const urgentTrips = tripsWithCategory
      .filter((t) => t._category === 'upcoming' && !isCanceled(t) && t._daysLeft >= 0 && t._daysLeft <= 14)
      .sort((a, b) => a._daysLeft - b._daysLeft)
      .map(({ _category, _daysLeft, _retDays, _monthKey, ...rest }) => rest);

    // ── Pagination ──
    const totalFiltered = filtered.length;
    const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
    const safePage = Math.min(page, totalPages);
    const startIdx = (safePage - 1) * pageSize;
    const pageData = filtered.slice(startIdx, startIdx + pageSize);

    // Clean internal fields before sending
    const cleanData = pageData.map(({ _category, _daysLeft, _retDays, _monthKey, ...rest }: any) => rest);

    return NextResponse.json({
      data: cleanData,
      pagination: {
        page: safePage,
        pageSize,
        total: totalFiltered,
        totalPages,
      },
      counts: tabCounts,
      availableMonths,
      urgentTrips,
    });
  } catch (error) {
    console.error('Fetch travel deals error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    // Verify permission: need 'create' on 'travel'
    const permCheck = await verifyPermission(request, 'travel', 'create');
    if (!permCheck.allowed) {
      return NextResponse.json({ error: permCheck.error }, { status: 403 });
    }

    const body = await request.json();
    const {
      employeeId,
      destination,
      departureDate,
      returnDate,
      dealerName,
      customerNames,
      hasFlight,
      hasHotel,
      hasVisa,
      hasTours,
      hasTransportation,
      flightStatus,
      hotelStatus,
      visaStatus,
      toursStatus,
      transportationStatus,
      notes,
      status,
    } = body;

    if (!employeeId || !destination || !departureDate) {
      return NextResponse.json({ error: 'Employee ID, destination, and departure date are required' }, { status: 400 });
    }

    const { createRecord } = await import('@/lib/db');
    const travelDeal = await createRecord('travelDeals', {
      employeeId,
      destination,
      departureDate,
      returnDate: returnDate || null,
      dealerName: dealerName || null,
      customerNames: customerNames || null,
      hasFlight: hasFlight || false,
      hasHotel: hasHotel || false,
      hasVisa: hasVisa || false,
      hasTours: hasTours || false,
      hasTransportation: hasTransportation || false,
      flightStatus: flightStatus || null,
      hotelStatus: hotelStatus || null,
      visaStatus: visaStatus || null,
      toursStatus: toursStatus || null,
      transportationStatus: transportationStatus || null,
      notes: notes || null,
      status: status || 'upcoming',
    });

    return NextResponse.json(travelDeal, { status: 201 });
  } catch (error) {
    console.error('Create travel deal error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
