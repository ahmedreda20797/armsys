'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import { AnimatePresence } from 'framer-motion';
import { Skeleton } from '@/components/ui/skeleton';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { NotificationProvider } from '@/contexts/NotificationContext';
import { useAppStore } from '@/lib/store';
import { AppLayout } from '@/components/layout/AppLayout';
import { usePermissions } from '@/hooks/usePermissions';
import { APP_PAGES } from '@/config/permissions';
import { AppShell } from '@/components/shell/AppShell';
import LoginPage from '@/components/pages/LoginPage';
import { ShieldX } from 'lucide-react';

// ─── Page skeleton ────────────────────────────────────────────────────────────
function PageSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-10 w-48 rounded-lg bg-slate-800/60" />
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-[120px] rounded-2xl bg-slate-800/40" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-[400px] rounded-2xl bg-slate-800/40" />
        ))}
      </div>
    </div>
  );
}

// ─── Lazy pages ───────────────────────────────────────────────────────────────
const HomePage             = dynamic(() => import('@/components/pages/HomePage'),             { loading: () => <PageSkeleton />, ssr: false });
const EmployeesPage        = dynamic(() => import('@/components/pages/EmployeesPage'),        { loading: () => <PageSkeleton />, ssr: false });
const BiometricPage        = dynamic(() => import('@/components/pages/BiometricPage'),        { loading: () => <PageSkeleton />, ssr: false });
const AttendancePage       = dynamic(() => import('@/components/pages/AttendancePage'),       { loading: () => <PageSkeleton />, ssr: false });
const RequestsPage         = dynamic(() => import('@/components/pages/RequestsPage'),         { loading: () => <PageSkeleton />, ssr: false });
const RulesPage            = dynamic(() => import('@/components/pages/RulesPage'),            { loading: () => <PageSkeleton />, ssr: false });
const QualityPage          = dynamic(() => import('@/components/pages/QualityPage'),          { loading: () => <PageSkeleton />, ssr: false });
const HrDeductionsPage     = dynamic(() => import('@/components/pages/HrDeductionsPage'),     { loading: () => <PageSkeleton />, ssr: false });
const TravelPage           = dynamic(() => import('@/components/pages/TravelPage'),           { loading: () => <PageSkeleton />, ssr: false });
const ReportsPage          = dynamic(() => import('@/components/pages/ReportsPage'),          { loading: () => <PageSkeleton />, ssr: false });
const ControlPanelPage     = dynamic(() => import('@/components/pages/ControlPanelPage'),     { loading: () => <PageSkeleton />, ssr: false });
const FirebaseSettingsPage = dynamic(() => import('@/components/pages/FirebaseSettingsPage'), { loading: () => <PageSkeleton />, ssr: false });
const FollowUpsPage        = dynamic(() => import('@/components/pages/FollowUpsPage'),        { loading: () => <PageSkeleton />, ssr: false });
const CAPAPage             = dynamic(() => import('@/components/pages/CAPAPage'),             { loading: () => <PageSkeleton />, ssr: false });
const ComplaintsPage       = dynamic(() => import('@/components/pages/ComplaintsPage'),       { loading: () => <PageSkeleton />, ssr: false });
const KnowledgeBasePage    = dynamic(() => import('@/components/pages/KnowledgeBasePage'),    { loading: () => <PageSkeleton />, ssr: false });
const RiskCenterPage       = dynamic(() => import('@/components/pages/RiskCenterPage'),       { loading: () => <PageSkeleton />, ssr: false });
const OperationsCenterPage = dynamic(() => import('@/components/pages/OperationsCenterPage'), { loading: () => <PageSkeleton />, ssr: false });
const NotificationCenterPage = dynamic(() => import('@/components/pages/NotificationCenterPage'), { loading: () => <PageSkeleton />, ssr: false });
const RulesEnginePage      = dynamic(() => import('@/components/pages/RulesEnginePage'),      { loading: () => <PageSkeleton />, ssr: false });

// ─── Background preload ───────────────────────────────────────────────────────
function PreloadPages() {
  React.useEffect(() => {
    const hasIdle = 'requestIdleCallback' in window;
    const id = hasIdle
      ? window.requestIdleCallback(() => {
          import('@/components/pages/EmployeesPage');
          import('@/components/pages/AttendancePage');
        })
      : window.setTimeout(() => {
          import('@/components/pages/EmployeesPage');
          import('@/components/pages/AttendancePage');
        }, 200);
    return () => {
      if (hasIdle) window.cancelIdleCallback(id as number);
      else clearTimeout(id as number);
    };
  }, []);
  return null;
}

// ─── Access denied ────────────────────────────────────────────────────────────
function AccessDenied() {
  const pageConfig = APP_PAGES.find((p) => p.id === useAppStore.getState().currentPage);
  return (
    <div dir="rtl" className="flex flex-col items-center justify-center py-24">
      <div className="w-20 h-20 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-6">
        <ShieldX className="w-10 h-10 text-red-400" />
      </div>
      <h2 className="text-xl font-bold text-slate-200 mb-2">صلاحية غير كافية</h2>
      <p className="text-slate-400 text-center max-w-md">
        ليس لديك صلاحية للوصول إلى {pageConfig?.title || 'هذه الصفحة'}.
        يرجى التواصل مع مدير النظام إذا كنت تعتقد أن هذا خطأ.
      </p>
    </div>
  );
}

// ─── Page router ──────────────────────────────────────────────────────────────
function PageRouter() {
  const currentPage = useAppStore((s) => s.currentPage);
  const { canViewPage } = usePermissions();

  if (currentPage !== 'home' && !canViewPage(currentPage)) {
    return <AccessDenied key="access-denied" />;
  }

  switch (currentPage) {
    case 'home':             return <HomePage             key="home" />;
    case 'employees':        return <EmployeesPage        key="employees" />;
    case 'biometric':        return <BiometricPage        key="biometric" />;
    case 'attendance':       return <AttendancePage       key="attendance" />;
    case 'requests':         return <RequestsPage         key="requests" />;
    case 'rules':            return <RulesPage            key="rules" />;
    case 'quality':          return <QualityPage          key="quality" />;
    case 'hrDeductions':     return <HrDeductionsPage     key="hrDeductions" />;
    case 'travel':           return <TravelPage           key="travel" />;
    case 'reports':          return <ReportsPage          key="reports" />;
    case 'controlPanel':     return <ControlPanelPage     key="controlPanel" />;
    case 'firebase':         return <FirebaseSettingsPage key="firebase" />;
    case 'followUps':        return <FollowUpsPage        key="followUps" />;
    case 'capa':             return <CAPAPage             key="capa" />;
    case 'complaints':       return <ComplaintsPage       key="complaints" />;
    case 'knowledgeBase':    return <KnowledgeBasePage    key="knowledgeBase" />;
    case 'riskCenter':       return <RiskCenterPage       key="riskCenter" />;
    case 'operationsCenter': return <OperationsCenterPage key="operationsCenter" />;
    case 'notifications':    return <NotificationCenterPage key="notifications" />;
    case 'rulesEngine':      return <RulesEnginePage      key="rulesEngine" />;
    default:                 return <HomePage             key="home" />;
  }
}

// ─── App content ──────────────────────────────────────────────────────────────
// Rendered inside AppShell's z-10 layer.
// AppShell handles the loading overlay (z-20) independently.
// This component only manages the login ↔ ready transition.
function AppContent() {
  const { user, loading } = useAuth();

  // While loading, render nothing — AppShell's LoadingOverlay covers the screen.
  // Once loading resolves, animate in either login or the app.
  if (loading) return null;

  return (
    <>
      <PreloadPages />

      {/* Login overlay — fades in/out above the persistent background */}
      <AnimatePresence>
        {!user && <LoginPage key="login" />}
      </AnimatePresence>

      {/* App — mounts after login, unmounts on logout */}
      {user && (
        <NotificationProvider>
          <AppLayout>
            <PageRouter />
          </AppLayout>
        </NotificationProvider>
      )}
    </>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────
export default function Home() {
  return (
    <AuthProvider>
      {/*
       * AppShell mounts once. It owns:
       *   - PersistentBackground (z-0, React.memo, never re-renders)
       *   - LoadingOverlay       (z-20, AnimatePresence, fades out after session check)
       *
       * AppContent (z-10) manages login ↔ ready with its own AnimatePresence.
       * The two AnimatePresence instances are siblings, not nested.
       */}
      <AppShell>
        <AppContent />
      </AppShell>
    </AuthProvider>
  );
}
