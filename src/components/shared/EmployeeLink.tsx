'use client';

import React from 'react';
import { useAppStore } from '@/lib/store';
import { usePermissions } from '@/hooks/usePermissions';

// ══════════════════════════════════════════════════════════════
//  EmployeeLink — مكون قابل لإعادة الاستخدام
//  يعرض اسم الموظف كرابط قابل للنقر يفتح ملف الـ 360
//  يفتح كـ overlay فوق الصفحة الحالية
// ══════════════════════════════════════════════════════════════

interface EmployeeLinkProps {
  employeeId: string;
  name?: string;
  code?: string | null;
  department?: string | null;
  /** compact = بدون أفاتار (للجداول المزدحمة) */
  compact?: boolean;
  /** hideAvatar = إخفاء الأفاتار دائماً */
  hideAvatar?: boolean;
  /** className إضافي للحاوية */
  className?: string;
  /** className للنص */
  textClassName?: string;
  /** للأطفال (children ي overrides name) */
  children?: React.ReactNode;
  /** عند النقر - override افتراضي */
  onClick?: (e: React.MouseEvent) => void;
}

export function EmployeeLink({
  employeeId,
  name,
  code,
  department,
  compact = false,
  hideAvatar = false,
  className = '',
  textClassName = '',
  children,
  onClick,
}: EmployeeLinkProps) {
  const openEmployee360 = useAppStore((s) => s.openEmployee360);
  const { canViewPage } = usePermissions('employee360');
  const canOpen = canViewPage('employee360');

  const finalName = children || name || code || employeeId;
  const finalDept = department;

  if (!employeeId) {
    return (
      <span className={`text-slate-500 ${textClassName}`}>
        {finalName}
      </span>
    );
  }

  const initial = (name || code || '?').charAt(0);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onClick) {
      onClick(e);
      return;
    }
    if (!canOpen) return;
    openEmployee360(employeeId);
  };

  const avatarSize = compact ? 'size-5 text-[10px]' : 'size-6 text-xs';
  const avatarColors = [
    'from-emerald-500 to-cyan-600',
    'from-violet-500 to-purple-600',
    'from-blue-500 to-indigo-600',
    'from-orange-500 to-amber-600',
    'from-pink-500 to-rose-600',
    'from-teal-500 to-emerald-600',
  ];
  const colorIndex = initial.charCodeAt(0) % avatarColors.length;
  const avatarGradient = avatarColors[colorIndex];

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`
        inline-flex items-center gap-1.5 rounded-md
        text-white hover:text-violet-400
        transition-colors duration-150
        hover:bg-violet-500/5
        px-1 -mx-1 py-0.5 -my-0.5
        ${canOpen ? 'cursor-pointer group' : 'cursor-default'}
        ${className}
      `}
      title={canOpen ? `عرض ملف ${name || code || employeeId}` : undefined}
    >
      {/* Avatar */}
      {!hideAvatar && (
        <span
          className={`${avatarSize} rounded-full bg-linear-to-br ${avatarGradient} flex items-center justify-center text-white font-bold shrink-0`}
        >
          {initial}
        </span>
      )}

      {/* Name / Code / Children */}
      <span className={`truncate ${textClassName}`}>
        {finalName}
      </span>

      {/* Department subtitle */}
      {!compact && finalDept && (
        <span className="text-slate-500 text-xs truncate hidden sm:inline">
          — {finalDept}
        </span>
      )}
    </button>
  );
}

export default EmployeeLink;
