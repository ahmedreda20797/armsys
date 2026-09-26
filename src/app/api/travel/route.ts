import { NextRequest, NextResponse } from 'next/server';
import { getAll, withEmployee } from '@/lib/db';
import { verifyPermission, requireAuth } from '@/lib/verify-permission';
import { asScopeViewer, employeeInScope, authScopeViewer, filterRowsByEmployeeScope, resolveEmployeeScopeFromDb } from '@/lib/scope/server';
// §TRAVEL-THRESHOLD — the ONE canonical DD/MM/YYYY day-delta helper
// (DST-safe); the route must not keep its own copy.
import { getDaysRemaining } from '@/lib/date-utils';
import { isDepartureAttention, isReturnAttention } from '@/lib/travel-status';
// §DEAL-DATES — canonical deal date dimensions + the DEFAULT DATE =
// TODAY doctrine (dealClosedAt default).
import { todayDisplayDate, isValidDisplayDate } from '@/lib/date-utils';
// §TRAVEL-FILTERS — the ONE canonical Travel filter pipeline (Home and
// Travel answer the same question through the same pure functions).
import {
  applyTravelFilters,
  availableMonthsForBasis,
  getTripCategory,
  isCanceledDeal,
  parseTravelQueryFilters,
  sortTravelDeals,
} from '@/lib/travel-filters';
// §BOOKING-ITEMS — canonical dynamic booking model + legacy projection.
import { normalizeBookingItems, projectLegacyServiceFields, sanitizeBookingItems } from '@/lib/booking-items';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const countsOnly = searchParams.get('counts') === 'true';

    // ── Canonical filters (fail-closed parsing) ──
    const filters = parseTravelQueryFilters(searchParams);

    // ── Fetch all travel deals + employees in parallel ──
    let travelDeals = await getAll('travelDeals');

    // ── READ SCOPE (M0.5) ──
    // Trips are employee-linked through their STORED employeeId.
    // Scope runs at the retrieval boundary — BEFORE category
    // computation, tab COUNTS, filters, month list, urgent list and
    // pagination — so counts, sort positions and pages all derive
    // from the authorized dataset only (authorized → filter → sort
    // → paginate). The employeeId/month/search query params can only
    // NARROW the authorized set.
    const scopeCtx = await resolveEmployeeScopeFromDb(authScopeViewer(auth), undefined, auth.permissions);
    travelDeals = filterRowsByEmployeeScope(travelDeals as Array<{ employeeId?: string | null }>, scopeCtx);

    travelDeals = await withEmployee(travelDeals as any[]);

    // ── Compute tab counts (needed for UI badges) ──
    // Separate canceled trips — excluded from main counts
    let tabCounts = { all: 0, upcoming: 0, in_progress: 0, returned: 0, canceled: 0 };
    for (const t of travelDeals as any[]) {
      if (isCanceledDeal(t)) {
        tabCounts.canceled++;
      } else {
        const category = getTripCategory(t.departureDate, t.returnDate);
        if (category === 'upcoming') tabCounts.upcoming++;
        else if (category === 'in_progress') tabCounts.in_progress++;
        else tabCounts.returned++;
      }
      tabCounts.all++; // 'all' includes everything
    }

    // If only counts requested, return early
    if (countsOnly) {
      return NextResponse.json({ counts: tabCounts });
    }

    // ── THE canonical filter pipeline (dedup → filters) ──
    const filtered = applyTravelFilters(travelDeals as any[], filters);

    // ── Sort: nearest travel first (canonical, tab-aware) ──
    const sorted = sortTravelDeals(filtered, filters.tab, (t) => getTripCategory(t.departureDate, t.returnDate));

    // ── §DEAL-DATES — months WITH data on the SELECTED basis (no
    // fabricated months; unattributable deals contribute no bucket) ──
    const availableMonths = availableMonthsForBasis(travelDeals as any[], filters.dateBasis);

    // ── Urgent trips (Phase 6 §6 + §TRAVEL-THRESHOLD) — include BOTH
    //     upcoming DEPARTURES and upcoming RETURNS, each with its OWN
    //     independent attention window from src/lib/travel-status.ts:
    //       departure → DEPARTURE_ATTENTION_DAYS (10 = the قريب rule)
    //       return    → RETURN_ATTENTION_DAYS (14, deliberately its own
    //                   concept — a return in 2 days IS a real attention
    //                   item even when the departure already passed).
    //     Each urgent entry carries `urgentType: 'departure' | 'return'`
    //     so the consumer labels the event correctly. ──
    const urgentTripsRaw = (travelDeals as any[])
      .filter((t) => !isCanceledDeal(t))
      .flatMap((t) => {
        const daysLeft = getDaysRemaining(t.departureDate);
        const retDays = t.returnDate ? getDaysRemaining(t.returnDate) : null;
        const out: Array<{ t: any; daysLeft: number; urgentType: 'departure' | 'return' }> = [];
        if (isDepartureAttention(daysLeft)) {
          out.push({ t, daysLeft, urgentType: 'departure' });
        }
        if (typeof retDays === 'number' && isReturnAttention(retDays)) {
          out.push({ t, daysLeft: retDays, urgentType: 'return' });
        }
        return out;
      })
      .sort((a, b) => a.daysLeft - b.daysLeft);

    const urgentTrips = urgentTripsRaw.map(({ t, urgentType }) => ({ ...t, urgentType }));

    // ── Pagination ──
    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = parseInt(searchParams.get('pageSize') || '50', 10);
    const totalFiltered = sorted.length;
    const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
    const safePage = Math.min(page, totalPages);
    const startIdx = (safePage - 1) * pageSize;
    const pageData = sorted.slice(startIdx, startIdx + pageSize);

    return NextResponse.json({
      data: pageData,
      pagination: {
        page: safePage,
        pageSize,
        total: totalFiltered,
        totalPages,
      },
      counts: tabCounts,
      availableMonths,
      dateBasis: filters.dateBasis,
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
      // New fields (preferred)
      hasInternationalFlight,
      hasDomesticFlight,
      internationalFlightStatus,
      domesticFlightStatus,
      hasHotel,
      hasVisa,
      hasTours,
      hasTransportation,
      hotelStatus,
      visaStatus,
      toursStatus,
      transportationStatus,
      notes,
      status,
      // Legacy fields (backward compat)
      hasFlight,
      flightStatus,
    } = body;

    if (!employeeId || !destination || !departureDate) {
      return NextResponse.json({ error: 'Employee ID, destination, and departure date are required' }, { status: 400 });
    }

    // ── §DEAL-DATES (DEAL_CLOSED) — تاريخ تقفيل الديل ──
    // The business date the deal was closed with the employee and
    // entered into Qnalys. Defaults to TODAY (the DEFAULT DATE = TODAY
    // doctrine); an explicit client value must be a real display date.
    // NOT derived from createdAt/departureDate/closedAt.
    let dealClosedAt = todayDisplayDate();
    if (body.dealClosedAt != null && body.dealClosedAt !== '') {
      if (typeof body.dealClosedAt !== 'string' || !isValidDisplayDate(body.dealClosedAt)) {
        return NextResponse.json({ error: 'تاريخ تقفيل الديل غير صالح — الصيغة DD/MM/YYYY' }, { status: 400 });
      }
      dealClosedAt = body.dealClosedAt;
    }

    // ── §BOOKING-ITEMS — canonical items from the payload; legacy
    // six-field payloads normalize into items (old clients keep working).
    // The stored legacy fields are the PROJECTION of the items (first
    // item per legacy-backed type), so every existing reader stays correct.
    let bookingItemsResult = normalizeBookingItems({
      hasInternationalFlight: hasInternationalFlight ?? hasFlight ?? false,
      hasDomesticFlight: hasDomesticFlight ?? false,
      hasHotel: hasHotel ?? false,
      hasVisa: hasVisa ?? false,
      hasTours: hasTours ?? false,
      hasTransportation: hasTransportation ?? false,
      internationalFlightStatus: internationalFlightStatus ?? flightStatus ?? null,
      domesticFlightStatus: domesticFlightStatus ?? null,
      hotelStatus: hotelStatus ?? null,
      visaStatus: visaStatus ?? null,
      toursStatus: toursStatus ?? null,
      transportationStatus: transportationStatus ?? null,
    } as any);
    if (body.bookingItems !== undefined) {
      const sanitized = sanitizeBookingItems(body.bookingItems);
      if (!sanitized.ok) {
        return NextResponse.json({ error: sanitized.error }, { status: 400 });
      }
      bookingItemsResult = sanitized.items;
    }

    // ── TARGET-EMPLOYEE SCOPE (M0.4) ──
    // Travel deals are employee-linked records: the target employee
    // (body.employeeId) must be inside the caller's employee scope
    // BEFORE the record is created; existence is not revealed to
    // out-of-scope callers.
    const inScope = await employeeInScope(
      asScopeViewer(permCheck.user!),
      permCheck.user!.permissions,
      employeeId,
    );
    if (!inScope) {
      return NextResponse.json({ error: 'صلاحية غير كافية' }, { status: 403 });
    }

    // Validate employee exists and is active
    const { validateEmployeeId } = await import('@/lib/validate-employee');
    const empValidation = await validateEmployeeId(employeeId, true);
    if (!empValidation.valid) {
      return NextResponse.json({ error: empValidation.error }, { status: 400 });
    }

    const legacyProjection = projectLegacyServiceFields(bookingItemsResult);

    const { createRecord } = await import('@/lib/db');
    const travelDeal = await createRecord('travelDeals', {
      employeeId,
      destination,
      departureDate,
      returnDate: returnDate || null,
      dealerName: dealerName || null,
      customerNames: customerNames || null,
      hasInternationalFlight: legacyProjection.hasInternationalFlight ?? false,
      hasDomesticFlight: legacyProjection.hasDomesticFlight ?? false,
      hasHotel: legacyProjection.hasHotel ?? false,
      hasVisa: legacyProjection.hasVisa ?? false,
      hasTours: legacyProjection.hasTours ?? false,
      hasTransportation: legacyProjection.hasTransportation ?? false,
      internationalFlightStatus: legacyProjection.internationalFlightStatus ?? null,
      domesticFlightStatus: legacyProjection.domesticFlightStatus ?? null,
      hotelStatus: legacyProjection.hotelStatus ?? null,
      visaStatus: legacyProjection.visaStatus ?? null,
      toursStatus: legacyProjection.toursStatus ?? null,
      transportationStatus: legacyProjection.transportationStatus ?? null,
      bookingItems: bookingItemsResult,
      notes: notes || null,
      status: status || 'upcoming',
      // §DEAL-DATES (DEAL_CLOSED) — تاريخ تقفيل الديل (defaults to today).
      dealClosedAt,
      // §DEAL-DATES — creation is the CREATED dimension; even a
      // created-as-completed record has no trustworthy closure
      // moment, so closedAt starts null (unknown, never fabricated).
      closedAt: null,
    });

    return NextResponse.json(travelDeal, { status: 201 });
  } catch (error) {
    console.error('Create travel deal error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
