'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/query-provider';
import { usePermissions } from '@/hooks/usePermissions';
import { queryKeys } from '@/hooks/use-queries';

// ═══════════════════════════════════════════════════════════════
//  AOCC-specific hooks — 30s polling for Operations Center
//  These are the first consumers of these endpoints in the app
// ═══════════════════════════════════════════════════════════════

const AOCC_REFETCH = 30_000; // 30 seconds
const AOCC_STALE = 15_000;   // 15 seconds

// ── Response types (matching API routes) ──

interface RiskCenterEmployee {
  employeeId: string;
  employeeName: string;
  department: string;
  position: string;
  riskScore: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  breakdown: Record<string, number>;
  openCases: number;
  lastActivity: string;
  trend: 'improving' | 'stable' | 'declining';
  recommendations: string[];
  capaIds: string[];
}

interface RiskCenterResponse {
  employees: RiskCenterEmployee[];
  summary: {
    totalEmployees: number;
    lowRiskCount: number;
    mediumRiskCount: number;
    highRiskCount: number;
    criticalRiskCount: number;
    openCasesTotal: number;
    immediateActionCount: number;
  };
  departmentAnalysis: Record<string, {
    count: number;
    avgScore: number;
    totalScore: number;
    openCases: number;
    qualityViolations: number;
    attendanceIssues: number;
    openCapas: number;
    overdueCapas: number;
  }>;
}

interface NotificationStatsResponse {
  total: number;
  unread: number;
  critical: number;
  todayCount: number;
  overdueCount: number;
  escalatedCount: number;
  todayGenerated: number;
  rulesTriggeredToday: number;
}

interface OnlineUser {
  userId: string;
  userName: string;
  userEmail: string;
  lastActivity: string;
  currentPage: string;
  lastAction: string;
  ipAddress: string;
  browser: string;
  device: string;
  sessionStart: string;
  status: 'active' | 'idle' | 'away';
  durationLabel: string;
}

// ═══════════════════════════════════════════════════════════════
//  1. Risk Center
// ═══════════════════════════════════════════════════════════════

export function useRiskCenter(params?: { department?: string; level?: string }) {
  const qs = (() => {
    const sp = new URLSearchParams();
    if (params?.department && params.department !== 'all') sp.set('department', params.department);
    if (params?.level && params.level !== 'all') sp.set('level', params.level);
    const str = sp.toString();
    return str ? `?${str}` : '';
  })();

  return useQuery<RiskCenterResponse>({
    queryKey: [...queryKeys.riskCenter, params],
    queryFn: () => apiFetch<RiskCenterResponse>(`/api/risk-center${qs}`),
    refetchInterval: AOCC_REFETCH,
    staleTime: AOCC_STALE,
  });
}

// ═══════════════════════════════════════════════════════════════
//  2. Notification Stats
// ═══════════════════════════════════════════════════════════════

export function useNotificationStats() {
  return useQuery<NotificationStatsResponse>({
    queryKey: ['notification-stats'],
    queryFn: () => apiFetch<NotificationStatsResponse>('/api/notification-stats'),
    refetchInterval: AOCC_REFETCH,
    staleTime: AOCC_STALE,
  });
}

// ═══════════════════════════════════════════════════════════════
//  3. Online Users (admin-gated — controlPanel:view)
// ═══════════════════════════════════════════════════════════════

export function useOnlineUsers(minutes = 2) {
  const { canViewPage } = usePermissions();

  return useQuery<OnlineUser[]>({
    queryKey: ['activity-logs', 'online', minutes],
    queryFn: () => apiFetch<OnlineUser[]>(`/api/activity-logs/online?minutes=${minutes}`),
    enabled: canViewPage('controlPanel'),
    refetchInterval: AOCC_REFETCH,
    staleTime: AOCC_STALE,
  });
}

// Re-export types for consumers
export type { RiskCenterEmployee, RiskCenterResponse, NotificationStatsResponse, OnlineUser };
