// src/types/index.ts

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
  rank: string;
  permissions: Record<string, any>;
  isSuspended?: boolean;
  suspendedAt?: string;
}

export interface Employee {
  id: string;
  code: string | null;
  name: string;
  department: string | null;
  position: string | null;
  shiftStart: string | null;
  shiftEnd: string | null;
  hireDate: string | null;
  mobile: string | null;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BiometricRecord {
  id: string;
  employeeId: string;
  date: string;
  checkIn: string | null;
  checkOut: string | null;
  createdAt: string;
}

export interface AttendanceRecord {
  id: string;
  employeeId: string;
  date: string;
  status: 'present' | 'late' | 'absent' | 'approved';
  checkIn: string | null;
  checkOut: string | null;
  minutesLate: number;
  notes: string | null;
  approvedRequestId: string | null;
  createdAt: string;
}

export interface RequestRecord {
  id: string;
  employeeId: string;
  type: string;
  date: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

export interface DeductionRule {
  id: string;
  key: string;
  label: string;
  amount: number;
  unit: 'EGP' | 'days';
  createdAt: string;
  updatedAt: string;
}

export interface QualityDeduction {
  id: string;
  employeeId: string;
  date: string;
  type: string;
  description: string;
  deductionDays: number;
  deductionAmount: number;
  evidence: string | null;
  month: string;
  createdAt: string;
}

export interface HrDeduction {
  id: string;
  employeeId: string;
  employeeName?: string;
  type: string;
  amount: number;
  unit: 'days' | 'EGP';
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  approvedBy: string | null;
  approvedAt: string | null;
  month: string;
  deductionDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TravelDeal {
  id: string;
  employeeId: string;
  destination: string;
  departureDate: string;
  returnDate: string | null;
  dealerName: string | null;
  customerNames: string | null;
  hasFlight: boolean;
  hasHotel: boolean;
  hasVisa: boolean;
  hasTours: boolean;
  hasTransportation: boolean;
  flightStatus: string | null;
  hotelStatus: string | null;
  visaStatus: string | null;
  toursStatus: string | null;
  transportationStatus: string | null;
  notes: string | null;
  status: 'upcoming' | 'in_progress' | 'completed' | 'canceled';
  createdAt: string;
}

export type PageId = 'home' | 'employees' | 'biometric' | 'attendance' | 'requests' | 'rules' | 'quality' | 'hrDeductions' | 'travel' | 'reports' | 'dashboard' | 'firebase';

export interface ActivityLog {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  action: string;      // e.g., 'login', 'create_employee', 'update_request', 'delete_rule', etc.
  page: string;        // which page the action was on
  details: string;     // description in Arabic
  timestamp: string;   // ISO date string
  metadata?: Record<string, any>;  // optional extra data (record ID, etc.)
}
