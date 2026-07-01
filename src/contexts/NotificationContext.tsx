'use client';

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';
import { useAuth } from '@/contexts/AuthContext';
import type { AppNotification } from '@/types';
import { playNotificationSound } from '@/lib/sounds';
import { authFetch } from '@/lib/api-fetch';
import { toast } from 'sonner';

// ══════════════════════════════════════════════════════════════
//  Types
// ══════════════════════════════════════════════════════════════
interface NotificationContextValue {
  /** All loaded notifications (newest first) */
  notifications: AppNotification[];
  /** Unread count */
  unreadCount: number;
  /** Loading state for initial fetch */
  loading: boolean;
  /** Mark single notification as read (updates server + local state) */
  markRead: (id: string) => Promise<void>;
  /** Mark single notification as read without server call (optimistic local) */
  markReadLocal: (id: string) => void;
  /** Mark all as read */
  markAllRead: () => Promise<void>;
  /** Refresh notifications from server */
  refresh: () => Promise<void>;
  /** Remove a notification locally (after delete) */
  removeLocal: (id: string) => void;
  /** Delete notification from server + local */
  deleteNotification: (id: string) => Promise<void>;
  /** Update a notification locally (after patch) */
  updateLocal: (id: string, updates: Partial<AppNotification>) => void;
  /** Add a new notification locally (from real-time listener) */
  addLocal: (notif: AppNotification) => void;
  /** Last notification received via real-time (for header pulse animation) */
  latestNotification: AppNotification | null;
  /** Whether the context is in an error state */
  error: boolean;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

export function useNotificationContext() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotificationContext must be used within NotificationProvider');
  return ctx;
}

// ══════════════════════════════════════════════════════════════
//  Desktop Notification helpers
// ══════════════════════════════════════════════════════════════
async function requestDesktopPermission(): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

function sendDesktopNotification(title: string, body: string, priority: string) {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  try {
    const n = new Notification(title, {
      body,
      icon: '/favicon.ico',
      tag: `arm-notif-${Date.now()}`,
      requireInteraction: priority === 'critical',
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
    setTimeout(() => n.close(), priority === 'critical' ? 15000 : 8000);
  } catch {
    // Desktop notifications not available
  }
}

// ══════════════════════════════════════════════════════════════
//  Priority → Sound mapping
// ══════════════════════════════════════════════════════════════
function getSoundForPriority(priority: string): 'travel' | 'request' | 'success' | 'error' {
  switch (priority) {
    case 'critical':
    case 'high':
      return 'error';
    default:
      return 'request';
  }
}

// ══════════════════════════════════════════════════════════════
//  Priority → Toast style
// ══════════════════════════════════════════════════════════════
function showToastForNotification(notif: AppNotification) {
  const isCritical = notif.priority === 'critical';
  const isHigh = notif.priority === 'high';

  toast(notif.title, {
    description: notif.description?.slice(0, 120) + (notif.description?.length > 120 ? '...' : ''),
    duration: isCritical ? 8000 : isHigh ? 6000 : 4000,
    ...(isCritical && {
      className: '!bg-red-500/15 !border-red-500/30 !text-red-400',
    }),
  });
}

// ══════════════════════════════════════════════════════════════
//  Helper: trigger sound + toast + desktop notification for a new alert
// ══════════════════════════════════════════════════════════════
function triggerNewAlertEffects(notif: AppNotification, desktopGranted: boolean) {
  // 1. Toast for ALL new notifications
  showToastForNotification(notif);

  // 2. Sound for ALL priorities (different sounds per priority)
  playNotificationSound(getSoundForPriority(notif.priority));

  // 3. Desktop notification for critical + high
  if (desktopGranted && (notif.priority === 'critical' || notif.priority === 'high')) {
    sendDesktopNotification(notif.title, notif.description || '', notif.priority);
  }
}

// ══════════════════════════════════════════════════════════════
//  Provider
// ══════════════════════════════════════════════════════════════
export function NotificationProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [latestNotification, setLatestNotification] = useState<AppNotification | null>(null);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const listenerRef = useRef<(() => void) | null>(null);
  const desktopPermissionRef = useRef(false);
  const lastFetchCountRef = useRef<number>(0);
  // Ref to avoid re-running effects when user object reference changes
  const userRef = useRef(user);
  userRef.current = user;

  // ── Request desktop notification permission once ──
  useEffect(() => {
    if (userRef.current) {
      requestDesktopPermission().then((granted) => {
        desktopPermissionRef.current = granted;
      });
    }
  }, [!!user]); // Stable boolean — doesn't re-fire on user object recreation

  // ── Fetch notifications and detect new ones (used for both initial + polling) ──
  const refresh = useCallback(async () => {
    try {
      // Fetch unread + recent (last 24h) to keep bell populated even after reading
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const res = await authFetch(`/api/notifications?limit=50&status=unread&dateFrom=${encodeURIComponent(yesterday)}`);
      if (res.ok) {
        const json = await res.json();
        const data: AppNotification[] = json.data || [];

        setNotifications((prev) => {
          const existingIds = new Set(prev.map((n) => n.id));

          // Detect genuinely new notifications (not seen before)
          const newNotifs = data.filter((d) => !existingIds.has(d.id) && !seenIdsRef.current.has(d.id));

          // Merge: new data first, then existing
          const merged = [...data.filter((d) => !existingIds.has(d.id)), ...prev];
          merged.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
          merged.forEach((n) => seenIdsRef.current.add(n.id));
          const result = merged.slice(0, 100);

          // If this is a polling round (not initial load) and we found new notifications
          if (newNotifs.length > 0 && lastFetchCountRef.current > 0) {
            // Process new notifications: sound + toast + desktop
            newNotifs.forEach((notif) => {
              // Only alert for very recent notifications (< 2 min old) to avoid alerting on old data
              const age = Date.now() - new Date(notif.createdAt).getTime();
              if (age < 120000) {
                triggerNewAlertEffects(notif, desktopPermissionRef.current);
              }
            });

            // Set latest for pulse animation
            setLatestNotification(newNotifs[0]);
            setTimeout(() => setLatestNotification(null), 3000);
          }

          lastFetchCountRef.current = result.length;
          return result;
        });
      } else {
        console.warn('[NotificationProvider] refresh() got non-ok response:', res.status);
      }
    } catch (err) {
      console.error('[NotificationProvider] refresh() error:', err);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Initial fetch on login ──
  useEffect(() => {
    if (userRef.current) {
      refresh();
    }
  }, [!!user, refresh]); // !!user is stable boolean

  // ── Real-time Firebase listener + polling fallback ──
  // Uses !!user to avoid re-creating listener/polling on every user object change
  useEffect(() => {
    if (!userRef.current) return;

    let cancelled = false;

    const setupListener = async () => {
      try {
        // Dynamically import Firebase client SDK (browser-only)
        const { ref: dbRef, onChildAdded, off } = await import('firebase/database');
        const { initializeFirebaseClient, getFirebaseDb } = await import('@/lib/firebase-client');

        // Get Firebase config from localStorage (same place FirebaseSettingsPage saves it)
        const savedConfig = localStorage.getItem('firebase_config');
        if (!savedConfig) return;
        const config = JSON.parse(savedConfig);
        if (!config || !config.databaseURL) return;

        // Initialize client
        initializeFirebaseClient(config);
        const db = getFirebaseDb();
        if (!db) return;

        const notifRef = dbRef(db, 'arm_erp/notifications');

        // Query: ordered by createdAt, limitToLast(1) for new ones
        // We use onChildAdded which fires for existing children first, then new ones
        const unsubscribe = onChildAdded(
          notifRef,
          (snapshot) => {
            if (cancelled) return;
            const data = snapshot.val();
            if (!data || !data.id) return;

            const notif = data as AppNotification;

            // Dedup: skip if we've already seen this notification
            if (seenIdsRef.current.has(notif.id)) return;

            // Only process notifications from the last 60 seconds (avoid old ones)
            const notifAge = Date.now() - new Date(notif.createdAt).getTime();
            if (notifAge > 60000) {
              seenIdsRef.current.add(notif.id);
              return;
            }

            seenIdsRef.current.add(notif.id);

            // Add to local state
            setNotifications((prev) => {
              if (prev.some((n) => n.id === notif.id)) return prev;
              const updated = [notif, ...prev].slice(0, 100);
              return updated;
            });

            setLatestNotification(notif);
            setTimeout(() => setLatestNotification(null), 3000);

            // Show toast, play sound, desktop notification for ALL priorities
            triggerNewAlertEffects(notif, desktopPermissionRef.current);
          },
          (error) => {
            // Listener error — silently ignore (might be permissions)
            console.warn('[NotificationProvider] Firebase listener error:', error?.message);
          }
        );

        listenerRef.current = unsubscribe;
      } catch {
        // Firebase client not available — real-time won't work, polling fallback exists
        console.warn('[NotificationProvider] Could not setup real-time listener');
      }
    };

    setupListener();

    // Polling fallback every 45 seconds (Firebase listener is primary)
    const pollInterval = setInterval(() => {
      if (!cancelled) refresh();
    }, 45000);

    return () => {
      cancelled = true;
      if (listenerRef.current) {
        listenerRef.current();
        listenerRef.current = null;
      }
      clearInterval(pollInterval);
    };
  }, [!!user, refresh]); // !!user prevents listener recreation churn

  // ── Mark read (server + local) ──
  const markRead = useCallback(async (id: string) => {
    try {
      await authFetch(`/api/notifications/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'read' }),
      });
    } catch {
      // Silently fail
    }
    markReadLocal(id);
  }, []);

  const markReadLocal = useCallback((id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, status: 'read' as const, readAt: n.readAt || new Date().toISOString() } : n))
    );
  }, []);

  // ── Mark all read ──
  const markAllRead = useCallback(async () => {
    const unreadIds = notifications.filter((n) => n.status === 'unread').map((n) => n.id);
    await Promise.allSettled(unreadIds.map((id) => markRead(id)));
  }, [notifications, markRead]);

  // ── Remove local ──
  const removeLocal = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  // ── Delete notification (server + local) ──
  const deleteNotification = useCallback(async (id: string) => {
    try {
      await authFetch(`/api/notifications/${id}`, { method: 'DELETE' });
    } catch {
      // Silently fail
    }
    removeLocal(id);
  }, [removeLocal]);

  // ── Update local ──
  const updateLocal = useCallback((id: string, updates: Partial<AppNotification>) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, ...updates } : n))
    );
  }, []);

  // ── Add local (from listener) ──
  const addLocal = useCallback((notif: AppNotification) => {
    setNotifications((prev) => {
      if (prev.some((n) => n.id === notif.id)) return prev;
      seenIdsRef.current.add(notif.id);
      return [notif, ...prev].slice(0, 100);
    });
    setLatestNotification(notif);
    setTimeout(() => setLatestNotification(null), 3000);
  }, []);

  const unreadCount = notifications.filter((n) => n.status === 'unread').length;

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        unreadCount,
        loading,
        markRead,
        markReadLocal,
        markAllRead,
        refresh,
        removeLocal,
        deleteNotification,
        updateLocal,
        addLocal,
        latestNotification,
        error,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
}
