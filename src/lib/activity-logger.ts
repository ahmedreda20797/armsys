// src/lib/activity-logger.ts
// Client-side utility to log activities - silent failures only

export async function logActivity(action: string, page: string, details: string, metadata?: Record<string, any>) {
  try {
    // Get user from localStorage
    const stored = localStorage.getItem('erp_user');
    if (!stored) return;
    const user = JSON.parse(stored);

    await fetch('/api/activity-logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        action,
        page,
        details,
        metadata,
      }),
    });
  } catch {
    // Silent fail - don't block user actions
  }
}

// Auto-log page visits
export function logPageVisit(page: string) {
  logActivity('page_visit', page, `زيارة صفحة ${page}`);
}

// Auto-log CRUD operations
export function logCreate(page: string, recordType: string, recordName: string) {
  logActivity('create', page, `إنشاء ${recordType}: ${recordName}`);
}

export function logUpdate(page: string, recordType: string, recordName: string) {
  logActivity('update', page, `تعديل ${recordType}: ${recordName}`);
}

export function logDelete(page: string, recordType: string, recordName: string) {
  logActivity('delete', page, `حذف ${recordType}: ${recordName}`);
}

export function logApprove(page: string, recordType: string, recordName: string, status: string) {
  logActivity('approve', page, `${status === 'approved' ? 'قبول' : 'رفض'} ${recordType}: ${recordName}`);
}

export function logLogin(userName: string) {
  logActivity('login', 'home', `تسجيل دخول: ${userName}`);
}

export function logLogout(userName: string) {
  logActivity('logout', 'home', `تسجيل خروج: ${userName}`);
}
