'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Menu, Bell, PanelRightClose, PanelRightOpen, X, Trash2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useIsMobile } from '@/hooks/use-mobile';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';

interface Notification {
  id: string;
  title: string;
  body: string;
  type: string;
  read: boolean;
  createdAt: string;
}

interface HeaderProps {
  title: string;
  onMenuToggle: () => void;
  onToggleSidebarCollapse: () => void;
  sidebarCollapsed: boolean;
}

export function Header({ title, onMenuToggle, onToggleSidebarCollapse, sidebarCollapsed }: HeaderProps) {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [showNotifPanel, setShowNotifPanel] = useState(false);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch('/api/firebase/notifications');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          setNotifications(data.slice(0, 20)); // keep latest 20
        }
      }
    } catch {
      // Firebase not configured - that's fine
    }
  }, []);

  // Poll notifications every 30 seconds
  useEffect(() => {
    const interval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  // Close panel on click outside
  useEffect(() => {
    if (!showNotifPanel) return;
    const handler = () => setShowNotifPanel(false);
    // Delay to avoid immediate close
    const timer = setTimeout(() => {
      document.addEventListener('click', handler);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', handler);
    };
  }, [showNotifPanel]);

  const getNotifIcon = (type: string) => {
    switch (type) {
      case 'travel': return '✈️';
      case 'request': return '📋';
      case 'attendance': return '⏰';
      default: return '🔔';
    }
  };

  const userInitials = user?.name
    ? user.name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    : '??';

  return (
    <motion.header
      className="glass-header sticky top-0 z-30 flex flex-col"
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
    >
      {/* Gradient line under header */}
      <div className="header-gradient-line" />
      <div className="flex items-center justify-between h-16 px-4 md:px-6">
      {/* Left section: menu toggle + title */}
      <div className="flex items-center gap-3">
        {isMobile ? (
          <motion.button
            onClick={onMenuToggle}
            className="p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            whileTap={{ scale: 0.9 }}
            aria-label="Toggle menu"
          >
            <Menu className="h-5 w-5" />
          </motion.button>
        ) : (
          <motion.button
            onClick={onToggleSidebarCollapse}
            className="p-2 rounded-lg text-slate-400 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            whileTap={{ scale: 0.9 }}
            whileHover={{ scale: 1.05 }}
            aria-label="Toggle sidebar"
          >
            {sidebarCollapsed ? (
              <PanelRightOpen className="h-5 w-5" />
            ) : (
              <PanelRightClose className="h-5 w-5" />
            )}
          </motion.button>
        )}
        <h1 className="text-lg font-bold text-slate-800 dark:text-white truncate max-w-xs sm:max-w-md">
          {title}
        </h1>
      </div>

      {/* Right section: notifications + avatar */}
      <div className="flex items-center gap-2">
        {/* Notification Bell with dropdown */}
        <div className="relative">
          <motion.button
            className="relative p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            whileTap={{ scale: 0.9 }}
            whileHover={{ scale: 1.05 }}
            aria-label="Notifications"
            onClick={(e) => {
              e.stopPropagation();
              setShowNotifPanel((p) => !p);
            }}
          >
            <Bell className="h-5 w-5" />
            {unreadCount > 0 && (
              <motion.span
                key={unreadCount}
                initial={{ scale: 0.5 }}
                animate={{ scale: 1 }}
                className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold px-1 ring-2 ring-white dark:ring-slate-900"
              >
                {unreadCount > 9 ? '9+' : unreadCount}
              </motion.span>
            )}
          </motion.button>

          {/* Notifications dropdown panel */}
          <AnimatePresence>
            {showNotifPanel && (
              <motion.div
                initial={{ opacity: 0, y: -8, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.95 }}
                transition={{ duration: 0.15 }}
                className="absolute left-0 top-full mt-2 w-80 sm:w-96 rounded-xl border border-slate-200 dark:border-slate-700/50 bg-white dark:bg-slate-800/90 dark:backdrop-blur-xl shadow-2xl dark:shadow-black/30 z-50 overflow-hidden"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Panel header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700/50">
                  <h3 className="text-sm font-semibold text-slate-800 dark:text-white">
                    الإشعارات
                  </h3>
                  <div className="flex items-center gap-2">
                    {notifications.length > 0 && (
                      <button
                        onClick={() => {
                          setNotifications([]);
                          setShowNotifPanel(false);
                        }}
                        className="text-xs text-slate-400 hover:text-red-400 transition-colors flex items-center gap-1"
                      >
                        <Trash2 className="size-3" />
                        مسح الكل
                      </button>
                    )}
                    <button
                      onClick={() => setShowNotifPanel(false)}
                      className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                    >
                      <X className="size-4 text-slate-400" />
                    </button>
                  </div>
                </div>

                {/* Notifications list */}
                <ScrollArea className="max-h-80">
                  {notifications.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8 px-4">
                      <Bell className="size-8 text-slate-300 dark:text-slate-600 mb-2" />
                      <p className="text-slate-400 dark:text-slate-500 text-sm">لا توجد إشعارات</p>
                      <p className="text-slate-400 dark:text-slate-600 text-xs mt-1">
                        قم بتوصيل Firebase لتفعيل الإشعارات
                      </p>
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100 dark:divide-slate-700/30">
                      {notifications.map((notif) => (
                        <motion.div
                          key={notif.id}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          className={`px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors cursor-pointer ${
                            !notif.read ? 'bg-blue-50/50 dark:bg-blue-500/5' : ''
                          }`}
                          onClick={() => {
                            setNotifications((prev) =>
                              prev.map((n) => (n.id === notif.id ? { ...n, read: true } : n))
                            );
                          }}
                        >
                          <div className="flex items-start gap-3">
                            <span className="text-lg mt-0.5">{getNotifIcon(notif.type)}</span>
                            <div className="flex-1 min-w-0">
                              <p className={`text-sm font-medium truncate ${
                                !notif.read ? 'text-slate-800 dark:text-white' : 'text-slate-600 dark:text-slate-400'
                              }`}>
                                {notif.title}
                              </p>
                              <p className="text-xs text-slate-500 dark:text-slate-500 mt-0.5 line-clamp-2">
                                {notif.body}
                              </p>
                              <p className="text-[10px] text-slate-400 dark:text-slate-600 mt-1" dir="ltr">
                                {new Date(notif.createdAt).toLocaleString('ar-EG')}
                              </p>
                            </div>
                            {!notif.read && (
                              <div className="w-2 h-2 rounded-full bg-blue-500 mt-1.5 shrink-0" />
                            )}
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="flex items-center justify-center w-9 h-9 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-xs font-bold text-white ring-2 ring-slate-200 dark:ring-slate-700 cursor-pointer hover:ring-emerald-400 transition-all">
          {userInitials}
        </div>
      </div>
    </div>
    </motion.header>
  );
}
