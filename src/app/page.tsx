'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import { motion, AnimatePresence } from 'framer-motion';
import { Skeleton } from '@/components/ui/skeleton';
import { AuthProvider } from '@/contexts/AuthContext';
import { useAuth } from '@/contexts/AuthContext';
import { NotificationProvider } from '@/contexts/NotificationContext';
import { useAppStore } from '@/lib/store';
import { AppLayout } from '@/components/layout/AppLayout';
import { usePermissions } from '@/hooks/usePermissions';
import { APP_PAGES } from '@/config/permissions';
import LoginPage, { CosmicLoadingScreen } from '@/components/pages/LoginPage';
import { ShieldX } from 'lucide-react';

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
const HrDeductionsPage = dynamic(() => import('@/components/pages/HrDeductionsPage'), { loading: () => <PageSkeleton />, ssr: false });
const TravelPage = dynamic(() => import('@/components/pages/TravelPage'), { loading: () => <PageSkeleton />, ssr: false });
const ReportsPage = dynamic(() => import('@/components/pages/ReportsPage'), { loading: () => <PageSkeleton />, ssr: false });
const ControlPanelPage = dynamic(() => import('@/components/pages/ControlPanelPage'), { loading: () => <PageSkeleton />, ssr: false });
const FirebaseSettingsPage = dynamic(() => import('@/components/pages/FirebaseSettingsPage'), { loading: () => <PageSkeleton />, ssr: false });
const FollowUpsPage = dynamic(() => import('@/components/pages/FollowUpsPage'), { loading: () => <PageSkeleton />, ssr: false });
const CAPAPage = dynamic(() => import('@/components/pages/CAPAPage'), { loading: () => <PageSkeleton />, ssr: false });
const ComplaintsPage = dynamic(() => import('@/components/pages/ComplaintsPage'), { loading: () => <PageSkeleton />, ssr: false });
const KnowledgeBasePage = dynamic(() => import('@/components/pages/KnowledgeBasePage'), { loading: () => <PageSkeleton />, ssr: false });
const RiskCenterPage = dynamic(() => import('@/components/pages/RiskCenterPage'), { loading: () => <PageSkeleton />, ssr: false });
const OperationsCenterPage = dynamic(() => import('@/components/pages/OperationsCenterPage'), { loading: () => <PageSkeleton />, ssr: false });
// Employee360 loaded as overlay, not a routed page
const NotificationCenterPage = dynamic(() => import('@/components/pages/NotificationCenterPage'), { loading: () => <PageSkeleton />, ssr: false });
const RulesEnginePage = dynamic(() => import('@/components/pages/RulesEnginePage'), { loading: () => <PageSkeleton />, ssr: false });

// Preload the most-visited pages in background after mount
// Wrapped in useEffect inside a component — never runs on server
function PreloadPages() {
  React.useEffect(() => {
    const id = (window.requestIdleCallback ?? window.setTimeout)(() => {
      import('@/components/pages/EmployeesPage');
      import('@/components/pages/AttendancePage');
    });
    return () => {
      if (window.requestIdleCallback) {
        window.cancelIdleCallback(id as number);
      }
    };
  }, []);
  return null;
}

// ═══════════════════════════════════════════════════
//  Access Denied component — shown when user lacks permission
// ═══════════════════════════════════════════════════
function AccessDenied() {
  const pageConfig = APP_PAGES.find(p => p.id === useAppStore.getState().currentPage);
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

// ═══════════════════════════════════════════════════
//  Page Router with Permission Enforcement
// ═══════════════════════════════════════════════════
function PageRouter() {
  const currentPage = useAppStore((s) => s.currentPage);
  const { canViewPage } = usePermissions();

  // Check if user has permission to view this page
  // 'home' is always accessible to logged-in users
  if (currentPage !== 'home' && !canViewPage(currentPage)) {
    return <AccessDenied key="access-denied" />;
  }

  // key={currentPage} ensures React fully unmounts/remounts
  // when switching pages, so useEffect(() => { fetchData() }, [])
  // runs fresh each time — fixes data disappearing on navigation
  switch (currentPage) {
    case 'home':
      return <HomePage key="home" />;
    case 'employees':
      return <EmployeesPage key="employees" />;
    case 'biometric':
      return <BiometricPage key="biometric" />;
    case 'attendance':
      return <AttendancePage key="attendance" />;
    case 'requests':
      return <RequestsPage key="requests" />;
    case 'rules':
      return <RulesPage key="rules" />;
    case 'quality':
      return <QualityPage key="quality" />;
    case 'hrDeductions':
      return <HrDeductionsPage key="hrDeductions" />;
    case 'travel':
      return <TravelPage key="travel" />;
    case 'reports':
      return <ReportsPage key="reports" />;
    case 'controlPanel':
      return <ControlPanelPage key="controlPanel" />;
    case 'firebase':
      return <FirebaseSettingsPage key="firebase" />;
    case 'followUps':
      return <FollowUpsPage key="followUps" />;
    case 'capa':
      return <CAPAPage key="capa" />;
    case 'complaints':
      return <ComplaintsPage key="complaints" />;
    case 'knowledgeBase':
      return <KnowledgeBasePage key="knowledgeBase" />;
    case 'riskCenter':
      return <RiskCenterPage key="riskCenter" />;
    case 'operationsCenter':
      return <OperationsCenterPage key="operationsCenter" />;
    case 'employee360':
      return <HomePage key="home" />;
    case 'notifications':
      return <NotificationCenterPage key="notifications" />;
    case 'rulesEngine':
      return <RulesEnginePage key="rulesEngine" />;
    default:
      return <HomePage key="home" />;
  }
}

function AppContent() {
  const { user, loading } = useAuth();

  return (
    <>
      <PreloadPages />
      <AnimatePresence mode="wait">
        {loading ? (
          <motion.div key="loading" initial={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
            <CosmicLoadingScreen />
          </motion.div>
        ) : !user ? (
          <motion.div key="login" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
            <LoginPage />
          </motion.div>
        ) : (
          <motion.div key="app" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
            <NotificationProvider>
              <AppLayout>
                <PageRouter />
              </AppLayout>
            </NotificationProvider>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

export default function Home() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
