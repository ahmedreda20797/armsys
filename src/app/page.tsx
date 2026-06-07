'use client';

import { AuthProvider } from '@/contexts/AuthContext';
import { useAuth } from '@/contexts/AuthContext';
import { useAppStore } from '@/lib/store';
import { AppLayout } from '@/components/layout/AppLayout';
import LoginPage from '@/components/pages/LoginPage';
import HomePage from '@/components/pages/HomePage';
import EmployeesPage from '@/components/pages/EmployeesPage';
import BiometricPage from '@/components/pages/BiometricPage';
import AttendancePage from '@/components/pages/AttendancePage';
import RequestsPage from '@/components/pages/RequestsPage';
import RulesPage from '@/components/pages/RulesPage';
import QualityPage from '@/components/pages/QualityPage';
import TravelPage from '@/components/pages/TravelPage';
import ReportsPage from '@/components/pages/ReportsPage';
import DashboardPage from '@/components/pages/DashboardPage';
import FirebaseSettingsPage from '@/components/pages/FirebaseSettingsPage';

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
