import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

/** Parse DD/MM/YYYY to a comparable number YYYYMMDD for sorting */
function parseDateToSortable(dateStr: string): number {
  const parts = dateStr.split('/');
  if (parts.length !== 3) return 0;
  const year = parseInt(parts[2], 10) || 0;
  const month = parseInt(parts[1], 10) || 0;
  const day = parseInt(parts[0], 10) || 0;
  return year * 10000 + month * 100 + day;
}

export async function GET() {
  try {
    const travelDeals = await db.travelDeal.findMany();

    const employeeIds = [...new Set(travelDeals.map((d) => d.employeeId))];
    const employees = await db.employee.findMany({
      where: { id: { in: employeeIds } },
      select: { id: true, name: true, department: true },
    });
    const empMap = new Map(employees.map((e) => [e.id, e]));

    const result = travelDeals
      .map((d) => {
        const emp = empMap.get(d.employeeId);
        return {
          ...d,
          employeeName: emp?.name || 'غير معروف',
          employeeDepartment: emp?.department || null,
        };
      })
      // Sort by nearest departure date first (ascending)
      .sort((a, b) => parseDateToSortable(a.departureDate) - parseDateToSortable(b.departureDate));

    return NextResponse.json(result);
  } catch (error) {
    console.error('Fetch travel deals error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
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

    const travelDeal = await db.travelDeal.create({
      data: {
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
      },
    });

    return NextResponse.json(travelDeal, { status: 201 });
  } catch (error) {
    console.error('Create travel deal error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
