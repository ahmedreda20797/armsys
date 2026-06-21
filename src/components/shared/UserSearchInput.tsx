'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Input } from '@/components/ui/input';
import { ShieldCheck, X } from 'lucide-react';

// ══════════════════════════════════════════════════════════════
//  UserSearchInput — Reusable searchable system-user dropdown
//
//  Users = نظام المستخدمين (فريق الجودة، HR) — NOT employees
//  Users are the people who USE the system to enter data.
//  Employees are the people being tracked/monitored.
//
//  Usage:
//    <UserSearchInput
//      users={users}
//      value={form.responsiblePerson}
//      onChange={(id, name) => setForm(p => ({ ...p, responsiblePerson: id }))}
//      label="المسؤول"
//      placeholder="ابحث عن مستخدم..."
//    />
// ══════════════════════════════════════════════════════════════

interface SystemUser {
  id: string;
  name: string;
  email?: string;
  role?: string;
  [key: string]: any;
}

interface UserSearchInputProps {
  /** List of system users to search from */
  users: SystemUser[];
  /** Currently selected user ID */
  value: string;
  /** Called when selection changes: (userId, userName?) => void */
  onChange: (userId: string, userName?: string) => void;
  /** Label shown above the input */
  label?: string;
  /** Placeholder text */
  placeholder?: string;
  /** Allow clearing the selection */
  allowClear?: boolean;
  /** Label for the clear option */
  clearLabel?: string;
  /** 'form' for dialog inputs, 'filter' for compact filter bar */
  variant?: 'form' | 'filter';
  /** Additional CSS classes */
  className?: string;
  /** col-span class */
  colSpan?: string;
}

export function UserSearchInput({
  users,
  value,
  onChange,
  label,
  placeholder = 'ابحث عن مستخدم...',
  allowClear = false,
  clearLabel = '— بدون —',
  variant = 'form',
  className = '',
  colSpan,
}: UserSearchInputProps) {
  const [searchText, setSearchText] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selectedUser = useMemo(() => {
    if (!value) return null;
    return users.find((u) => u.id === value) || null;
  }, [users, value]);

  useEffect(() => {
    if (selectedUser) {
      setSearchText(selectedUser.name);
    } else if (allowClear && value === '') {
      setSearchText('');
    }
  }, [selectedUser, value, allowClear]);

  const filteredUsers = useMemo(() => {
    if (!searchText) return [];
    const query = searchText.trim().toLowerCase();
    if (!query) return [];
    return users.filter((u) =>
      u.name.toLowerCase().includes(query) ||
      (u.email && u.email.toLowerCase().includes(query)) ||
      (u.role && u.role.toLowerCase().includes(query))
    );
  }, [users, searchText]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    if (showDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showDropdown]);

  const handleSelect = (userId: string, userName?: string) => {
    onChange(userId, userName);
    if (userName && userId !== '') {
      setSearchText(userName);
    }
    setShowDropdown(false);
  };

  const handleClear = () => {
    setSearchText('');
    onChange('', '');
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchText(val);
    if (value) {
      onChange('', '');
    }
    setShowDropdown(true);
  };

  const shouldShowDropdown = showDropdown && searchText && !value;

  const roleLabel = (role?: string) => {
    const map: Record<string, string> = { admin: 'مدير النظام', hr: 'HR', manager: 'مدير', quality: 'جودة', user: 'مستخدم' };
    return map[role || ''] || role || '';
  };

  // Filter variant
  if (variant === 'filter') {
    return (
      <div className={`relative ${className}`} ref={dropdownRef}>
        <div className="relative">
          <ShieldCheck className="absolute right-2.5 top-1/2 -translate-y-1/2 size-3.5 text-violet-400" />
          <Input
            placeholder={placeholder}
            value={searchText}
            onChange={handleInputChange}
            onFocus={() => setShowDropdown(true)}
            className="bg-slate-800/50 border-slate-700/50 text-white text-xs h-8 pr-8 w-36"
          />
          {value && (
            <button onClick={handleClear} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
              <X className="size-3" />
            </button>
          )}
        </div>
        <AnimatePresence>
          {shouldShowDropdown && (
            <motion.div
              initial={{ opacity: 0, y: -5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              className="absolute z-50 top-full mt-1 w-56 max-h-48 overflow-y-auto rounded-lg border border-slate-600 bg-slate-800 shadow-xl"
            >
              {filteredUsers.length === 0 ? (
                <div className="px-3 py-2 text-slate-500 text-xs text-center">لا توجد نتائج</div>
              ) : (
                filteredUsers.slice(0, 10).map((u) => (
                  <button
                    key={u.id}
                    onClick={() => handleSelect(u.id, u.name)}
                    className="w-full text-right px-3 py-2 text-white text-xs hover:bg-violet-500/10 transition-colors flex items-center gap-2"
                  >
                    <div className="size-5 rounded-full bg-violet-500/15 border border-violet-500/30 flex items-center justify-center flex-shrink-0">
                      <span className="text-[9px] font-bold text-violet-400">{u.name.charAt(0)}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate">{u.name}</p>
                      {u.role && <p className="text-slate-500 text-[10px]">{roleLabel(u.role)}</p>}
                    </div>
                  </button>
                ))
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  // Form variant
  return (
    <div className={`relative space-y-2 ${colSpan || ''} ${className}`} ref={dropdownRef}>
      {label && <label className="text-slate-300 text-sm">{label}</label>}
      <div className="relative">
        <ShieldCheck className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-violet-500" />
        <Input
          placeholder={placeholder}
          value={searchText}
          onChange={handleInputChange}
          onFocus={() => setShowDropdown(true)}
          className="bg-slate-800 border-slate-600 text-white pr-9"
        />
        {value && (
          <button onClick={handleClear} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
            <X className="size-3.5" />
          </button>
        )}
      </div>
      <AnimatePresence>
        {shouldShowDropdown && (
          <motion.div
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            className="absolute z-50 top-full mt-1 w-full max-h-48 overflow-y-auto rounded-lg border border-slate-600 bg-slate-800 shadow-xl"
          >
            {allowClear && (
              <button
                onClick={() => handleClear()}
                className="w-full text-right px-3 py-2 text-slate-400 text-sm hover:bg-slate-700/50 hover:text-slate-300 transition-colors border-b border-slate-700/50"
              >
                {clearLabel}
              </button>
            )}
            {filteredUsers.length === 0 ? (
              <div className="px-3 py-3 text-slate-500 text-xs text-center">لا توجد نتائج</div>
            ) : (
              filteredUsers.slice(0, 12).map((u) => (
                <button
                  key={u.id}
                  onClick={() => handleSelect(u.id, u.name)}
                  className="w-full text-right px-3 py-2 text-white text-sm hover:bg-violet-500/10 transition-colors flex items-center gap-2"
                >
                  <div className="size-6 rounded-full bg-violet-500/15 border border-violet-500/30 flex items-center justify-center flex-shrink-0">
                    <span className="text-[10px] font-bold text-violet-400">{u.name.charAt(0)}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate">{u.name}</p>
                    <p className="text-slate-500 text-[10px]">{u.email || roleLabel(u.role)}</p>
                  </div>
                </button>
              ))
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default UserSearchInput;