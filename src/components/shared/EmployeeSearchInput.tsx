'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Input } from '@/components/ui/input';
import { UserCheck, X } from 'lucide-react';

// ══════════════════════════════════════════════════════════════
//  EmployeeSearchInput — Reusable searchable employee dropdown
//
//  Usage (Form — required):
//    <EmployeeSearchInput
//      employees={employees}
//      value={form.employeeId}
//      onChange={(id, name) => setForm(p => ({ ...p, employeeId: id }))}
//      label="الموظف"
//      placeholder="اكتب اسم أو حرف من اسم الموظف..."
//    />
//
//  Usage (Form — optional with clear):
//    <EmployeeSearchInput
//      employees={employees}
//      value={form.responsiblePersonId}
//      onChange={(id, name) => setForm(p => ({ ...p, responsiblePersonId: id }))}
//      label="المسؤول"
//      allowClear
//      clearLabel="— بدون —"
//    />
//
//  Usage (Filter with "All" option):
//    <EmployeeSearchInput
//      employees={employees}
//      value={filterEmployee}
//      onChange={(id) => setFilterEmployee(id)}
//      showAllOption
//      allOptionValue="all"
//      allOptionLabel="كل الموظفين"
//      placeholder="فلتر حسب الموظف"
//      variant="filter"
//    />
// ══════════════════════════════════════════════════════════════

interface Employee {
  id: string;
  name: string;
  code?: string | null;
  department?: string | null;
  [key: string]: any;
}

interface EmployeeSearchInputProps {
  /** List of employees to search from */
  employees: Employee[];
  /** Currently selected employee ID */
  value: string;
  /** Called when selection changes: (employeeId, employeeName?) => void */
  onChange: (employeeId: string, employeeName?: string) => void;
  /** Label shown above the input */
  label?: string;
  /** Placeholder text in the input */
  placeholder?: string;
  /** Show department alongside name */
  showDepartment?: boolean;
  /** Allow clearing the selection (shows "— بدون —" and X button) */
  allowClear?: boolean;
  /** Label for the clear option */
  clearLabel?: string;
  /** Show "All" option (for filters) */
  showAllOption?: boolean;
  /** Value for the "all" option */
  allOptionValue?: string;
  /** Label for the "all" option */
  allOptionLabel?: string;
  /** 'form' for wider dialog inputs, 'filter' for compact filter bar inputs */
  variant?: 'form' | 'filter';
  /** Additional CSS classes for the wrapper div */
  className?: string;
  /** col-span class (e.g., 'sm:col-span-2') */
  colSpan?: string;
  /** If true, the input is read-only (shows selected name, no dropdown) */
  readOnly?: boolean;
}

export function EmployeeSearchInput({
  employees,
  value,
  onChange,
  label,
  placeholder = 'اكتب اسم أو حرف من اسم الموظف...',
  showDepartment = false,
  allowClear = false,
  clearLabel = '— بدون —',
  showAllOption = false,
  allOptionValue = 'all',
  allOptionLabel = 'كل الموظفين',
  variant = 'form',
  className = '',
  colSpan,
  readOnly = false,
}: EmployeeSearchInputProps) {
  const [searchText, setSearchText] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Find the currently selected employee for display name
  const selectedEmployee = useMemo(() => {
    if (!value) return null;
    return employees.find((emp) => emp.id === value) || null;
  }, [employees, value]);

  // Sync display text when value changes externally
  useEffect(() => {
    if (selectedEmployee) {
      setSearchText(selectedEmployee.name);
    } else if (showAllOption && value === allOptionValue) {
      setSearchText(allOptionLabel);
    } else if (allowClear && value === '') {
      setSearchText('');
    }
  }, [selectedEmployee, value, showAllOption, allOptionValue, allowClear, allOptionLabel]);

  // Filter employees by search text
  const filteredEmployees = useMemo(() => {
    if (!searchText || searchText === allOptionLabel) return [];
    const query = searchText.trim().toLowerCase();
    if (!query) return [];
    return employees.filter((emp) =>
      emp.name.toLowerCase().includes(query) ||
      (emp.code && emp.code.toLowerCase().includes(query)) ||
      (emp.department && emp.department.toLowerCase().includes(query))
    );
  }, [employees, searchText, allOptionLabel]);

  // Close dropdown when clicking outside
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

  const handleSelect = (empId: string, empName?: string) => {
    onChange(empId, empName);
    if (empName && empId !== allOptionValue && empId !== '') {
      setSearchText(empName);
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
    // Clear the selection when user types
    if (value) {
      onChange('', '');
    }
    setShowDropdown(true);
  };

  const shouldShowDropdown = showDropdown && searchText && !value && !readOnly;

  // Read-only mode: just show the name
  if (readOnly) {
    return (
      <div className={`space-y-2 ${colSpan || ''} ${className}`}>
        {label && <label className="text-slate-300 text-sm">{label}</label>}
        <Input
          readOnly
          value={selectedEmployee?.name || searchText || ''}
          className="bg-slate-800/50 border-slate-600 text-white"
        />
      </div>
    );
  }

  // Compact filter variant
  if (variant === 'filter') {
    return (
      <div className={`relative ${className}`} ref={dropdownRef}>
        <div className="relative">
          <UserCheck className="absolute right-2.5 top-1/2 -translate-y-1/2 size-3.5 text-slate-400" />
          <Input
            placeholder={placeholder}
            value={searchText}
            onChange={handleInputChange}
            onFocus={() => setShowDropdown(true)}
            className="bg-slate-800/50 border-slate-700/50 text-white text-xs h-8 pr-8 w-36"
          />
          {value && value !== allOptionValue && (
            <button
              onClick={handleClear}
              className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
            >
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
              {showAllOption && (
                <button
                  onClick={() => handleSelect(allOptionValue, allOptionLabel)}
                  className="w-full text-right px-3 py-2 text-slate-400 text-xs hover:bg-violet-500/10 hover:text-violet-400 transition-colors border-b border-slate-700/50"
                >
                  {allOptionLabel}
                </button>
              )}
              {filteredEmployees.length === 0 && !showAllOption ? (
                <div className="px-3 py-2 text-slate-500 text-xs text-center">لا توجد نتائج</div>
              ) : filteredEmployees.length === 0 ? (
                <div className="px-3 py-2 text-slate-500 text-xs text-center">لا توجد نتائج</div>
              ) : (
                filteredEmployees.slice(0, 10).map((emp) => (
                  <button
                    key={emp.id}
                    onClick={() => handleSelect(emp.id, emp.name)}
                    className="w-full text-right px-3 py-2 text-white text-xs hover:bg-violet-500/10 transition-colors flex items-center gap-2"
                  >
                    <div className="size-5 rounded-full bg-slate-700 flex items-center justify-center flex-shrink-0">
                      <span className="text-[9px] font-bold">{emp.name.charAt(0)}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate">{emp.name}</p>
                      {showDepartment && emp.department && <p className="text-slate-500 text-[10px]">{emp.department}</p>}
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

  // Form variant (default — wider, with label)
  return (
    <div className={`relative space-y-2 ${colSpan || ''} ${className}`} ref={dropdownRef}>
      {label && <label className="text-slate-300 text-sm">{label}</label>}
      <div className="relative">
        <UserCheck className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-slate-500" />
        <Input
          placeholder={placeholder}
          value={searchText}
          onChange={handleInputChange}
          onFocus={() => setShowDropdown(true)}
          className="bg-slate-800 border-slate-600 text-white pr-9"
        />
        {/* Clear button */}
        {value && (
          <button
            onClick={handleClear}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
      {/* Dropdown */}
      <AnimatePresence>
        {shouldShowDropdown && (
          <motion.div
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            className="absolute z-50 top-full mt-1 w-full max-h-48 overflow-y-auto rounded-lg border border-slate-600 bg-slate-800 shadow-xl"
          >
            {/* Clear option for optional fields */}
            {allowClear && (
              <button
                onClick={() => handleClear()}
                className="w-full text-right px-3 py-2 text-slate-400 text-sm hover:bg-slate-700/50 hover:text-slate-300 transition-colors border-b border-slate-700/50"
              >
                {clearLabel}
              </button>
            )}
            {/* All option for filters */}
            {showAllOption && (
              <button
                onClick={() => handleSelect(allOptionValue, allOptionLabel)}
                className="w-full text-right px-3 py-2 text-slate-400 text-sm hover:bg-violet-500/10 hover:text-violet-400 transition-colors border-b border-slate-700/50"
              >
                {allOptionLabel}
              </button>
            )}
            {/* Employee results */}
            {filteredEmployees.length === 0 ? (
              <div className="px-3 py-3 text-slate-500 text-xs text-center">لا توجد نتائج</div>
            ) : (
              filteredEmployees.slice(0, 12).map((emp) => (
                <button
                  key={emp.id}
                  onClick={() => handleSelect(emp.id, emp.name)}
                  className="w-full text-right px-3 py-2 text-white text-sm hover:bg-violet-500/10 transition-colors flex items-center gap-2"
                >
                  <div className="size-6 rounded-full bg-slate-700 flex items-center justify-center flex-shrink-0">
                    <span className="text-[10px] font-bold">{emp.name.charAt(0)}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate">{emp.name}</p>
                    {showDepartment && emp.department && (
                      <p className="text-slate-500 text-[10px]">{emp.department}</p>
                    )}
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

export default EmployeeSearchInput;
