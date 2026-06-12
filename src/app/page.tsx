'use client';

import dynamic from 'next/dynamic';
import { Skeleton } from '@/components/ui/skeleton';
import { AuthProvider } from '@/contexts/AuthContext';
import { useAuth } from '@/contexts/AuthContext';
import { useAppStore } from '@/lib/store';
import { AppLayout } from '@/components/layout/AppLayout';
import LoginPage from '@/components/pages/LoginPage';

// ═══════════════════════════════════════════════════
//  Lazy-loaded pages — code splitting for faster initial load
//  Only the active page's JS is downloaded & executed
// ═══════════════════════════════════════════════════

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

const HomePage = dynamic(() => import('@/components/pages/HomePage'), { loading: () => <PageSkeleton />, ssr: false });
const EmployeesPage = dynamic(() => import('@/components/pages/EmployeesPage'), { loading: () => <PageSkeleton />, ssr: false });
const BiometricPage = dynamic(() => import('@/components/pages/BiometricPage'), { loading: () => <PageSkeleton />, ssr: false });
const AttendancePage = dynamic(() => import('@/components/pages/AttendancePage'), { loading: () => <PageSkeleton />, ssr: false });
const RequestsPage = dynamic(() => import('@/components/pages/RequestsPage'), { loading: () => <PageSkeleton />, ssr: false });
const RulesPage = dynamic(() => import('@/components/pages/RulesPage'), { loading: () => <PageSkeleton />, ssr: false });
const QualityPage = dynamic(() => import('@/components/pages/QualityPage'), { loading: () => <PageSkeleton />, ssr: false });
const TravelPage = dynamic(() => import('@/components/pages/TravelPage'), { loading: () => <PageSkeleton />, ssr: false });
const ReportsPage = dynamic(() => import('@/components/pages/ReportsPage'), { loading: () => <PageSkeleton />, ssr: false });
const DashboardPage = dynamic(() => import('@/components/pages/DashboardPage'), { loading: () => <PageSkeleton />, ssr: false });
const FirebaseSettingsPage = dynamic(() => import('@/components/pages/FirebaseSettingsPage'), { loading: () => <PageSkeleton />, ssr: false });

// Preload the most-visited pages in background after mount
if (typeof window !== 'undefined') {
  // Preload common pages after idle
  requestIdleCallback?.(() => {
    import('@/components/pages/EmployeesPage');
    import('@/components/pages/AttendancePage');
  });
}

function PageRouter() {
  const currentPage = useAppStore((s) => s.currentPage);

  switch (currentPage) {
    case 'home':
      return <HomePage />;
    case 'employees':
      return <EmployeesPage />;
    case 'biometric':
      return <BiometricPage />;
    case 'attendance':
      return <AttendancePage />;
    case 'requests':
      return <RequestsPage />;
    case 'rules':
      return <RulesPage />;
    case 'quality':
      return <QualityPage />;
    case 'travel':
      return <TravelPage />;
    case 'reports':
      return <ReportsPage />;
    case 'dashboard':
      return <DashboardPage />;
    case 'firebase':
      return <FirebaseSettingsPage />;
    default:
      return <HomePage />;
  }
}

function AppContent() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <div className="flex flex-col items-center gap-4">
          <div className="animate-spin rounded-full h-12 w-12 border-3 border-emerald-500 border-t-transparent" />
          <p className="text-slate-400 text-sm">جاري التحميل...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  return (
    <AppLayout>
      <PageRouter />
    </AppLayout>
  );
}

export default function Home() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
