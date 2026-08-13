'use client';

import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Input } from '@/components/ui/input';
import { UserCheck, X } from 'lucide-react';

// ══════════════════════════════════════════════════════════════
//  EmployeeSearchInput — Reusable searchable employee dropdown
//
//  Generic identifier architecture: the component matches against
//  all present, real employee fields and dynamically composes the
//  strongest available disambiguators for the suggestion UI.
//
//  Future schema expansion (e.g. adding `email` to the canonical
//  Employee type) requires zero changes to consuming pages or this
//  component — new fields are picked up automatically.
//
//  Selection contract: display value is presentation-only; onChange
//  always resolves to the real `employeeId`.
// ══════════════════════════════════════════════════════════════

// ─── Local Employee view ──────────────────────────────────────
// Includes `email` as an optional future field so the component
// handles it transparently when present.  This does NOT modify the
// canonical Employee type (src/types/index.ts) or the database
// schema — it is purely the component's local contract.
interface Employee {
  id: string;
  name: string;
  code?: string | null;
  department?: string | null;
  position?: string | null;
  mobile?: string | null;
  /** Future-optional field — automatically supported when present. */
  email?: string | null;
  [key: string]: any;
}

// ─── Generic search field configuration ──────────────────────
// Ordered candidate fields.  Every field is OPTIONAL — the match
// and display logic gracefully skips absent values.  Adding a
// new field here (e.g. `nationalId`) is the ONLY change needed.
const SEARCH_FIELDS = [
  'name',
  'email',
  'code',
  'department',
  'position',
  'mobile',
] as const;

/** Max visible results per variant. */
const MAX_RESULTS = { form: 12, filter: 10 } as const;

// ─── Pure helpers (no hooks, no side effects) ────────────────

function matchesQuery(emp: Employee, query: string): boolean {
  const q = query.toLowerCase();
  return SEARCH_FIELDS.some((f) => {
    const v = emp[f];
    return typeof v === 'string' && v.length > 0 && v.toLowerCase().includes(q);
  });
}

/**
 * Build secondary disambiguating lines for a suggestion.
 *
 * line2 — organizational context (department · position)
 * line3 — personal identifiers (email · code  OR  code · mobile)
 *
 * The function dynamically uses the strongest available identifiers
 * without inventing missing data.
 */
function suggestionLines(
  emp: Employee,
  showDepartment: boolean,
  showPosition: boolean,
): { line2?: string; line3?: string } {
  // line2: department · position
  const line2Parts: string[] = [];
  if (showDepartment && emp.department) line2Parts.push(emp.department);
  if (showPosition && emp.position) line2Parts.push(emp.position);
  const line2 = line2Parts.join(' \u00b7 ') || undefined;

  // line3: email · code  (when email present)
  //        code · mobile   (when email absent)
  const line3Parts: string[] = [];
  if (emp.email) {
    if (emp.email) line3Parts.push(emp.email);
    if (emp.code) line3Parts.push(emp.code);
  } else {
    if (emp.code) line3Parts.push(emp.code);
    if (emp.mobile) line3Parts.push(emp.mobile);
  }
  const line3 = line3Parts.join(' \u00b7 ') || undefined;

  return { line2, line3 };
}

// ─── Props ──────────────────────────────────────────────────

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
  /** Show position alongside name */
  showPosition?: boolean;
  /** Allow clearing the selection */
  allowClear?: boolean;
  /** Label for the clear option */
  clearLabel?: string;
  /** Show "All" option (for filters) */
  showAllOption?: boolean;
  /** Value for the "all" option */
  allOptionValue?: string;
  /** Label for the "all" option */
  allOptionLabel?: string;
  /** 'form' for wider dialog inputs, 'filter' for compact bar inputs */
  variant?: 'form' | 'filter';
  /** Additional CSS classes for the wrapper div */
  className?: string;
  /** col-span class (e.g., 'sm:col-span-2') */
  colSpan?: string;
  /** If true, the input is read-only (shows selected name, no dropdown) */
  readOnly?: boolean;
}

// ─── Component ───────────────────────────────────────────────

export function EmployeeSearchInput({
  employees,
  value,
  onChange,
  label,
  placeholder = 'اكتب اسم أو حرف من اسم الموظف...',
  showDepartment = false,
  showPosition = false,
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
  const [localInput, setLocalInput] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Find the currently selected employee for display name
  const selectedEmployee = useMemo(() => {
    if (!value) return null;
    return employees.find((emp) => emp.id === value) || null;
  }, [employees, value]);

  // Display text is fully derived: selected name takes priority, then all-option
  // label, then whatever the user typed (localInput).
  const displayText = selectedEmployee
    ? selectedEmployee.name
    : showAllOption && value === allOptionValue
      ? allOptionLabel
      : localInput;

  // Filter query: only active when no value is selected (user is searching).
  const filterQuery = !value ? localInput.trim() : '';

  // Filter employees by search text against all candidate fields
  const filteredEmployees = useMemo(() => {
    if (!filterQuery) return [];
    return employees.filter((emp) => matchesQuery(emp, filterQuery));
  }, [employees, filterQuery]);

  // Visible results for render AND keyboard navigation
  const limit = MAX_RESULTS[variant];
  const visibleResults = useMemo(
    () => filteredEmployees.slice(0, limit),
    [filteredEmployees, limit],
  );

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

  // Scroll the active item into view (DOM-only, no setState).
  useEffect(() => {
    if (activeIndex < 0 || !listRef.current) return;
    const active = listRef.current.querySelector(`[data-idx="${activeIndex}"]`);
    if (active) {
      active.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex]);

  const handleSelect = useCallback((empId: string, empName?: string) => {
    onChange(empId, empName);
    setShowDropdown(false);
    setActiveIndex(-1);
    setLocalInput('');
  }, [onChange]);

  const handleClear = useCallback(() => {
    onChange('', '');
    setActiveIndex(-1);
    setLocalInput('');
  }, [onChange]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setLocalInput(val);
    setActiveIndex(-1);
    // Clear the selection when user types
    if (value) {
      onChange('', '');
    }
    setShowDropdown(true);
  };

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape') {
        setShowDropdown(false);
        setActiveIndex(-1);
        return;
      }

      // Don't intercept if dropdown not visible
      if (!showDropdown && !filterQuery) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (!showDropdown) {
          setShowDropdown(true);
        }
        setActiveIndex((i) => Math.min(i + 1, visibleResults.length - 1));
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
        return;
      }

      if (e.key === 'Enter') {
        if (activeIndex >= 0 && activeIndex < visibleResults.length) {
          e.preventDefault();
          const emp = visibleResults[activeIndex];
          handleSelect(emp.id, emp.name);
        }
        return;
      }
    },
    [showDropdown, filterQuery, visibleResults, activeIndex, handleSelect],
  );

  const shouldShowDropdown = !!showDropdown && !!filterQuery && !value && !readOnly;

  // ─── Read-only mode ────────────────────────────────────────
  if (readOnly) {
    return (
      <div className={`space-y-2 ${colSpan || ''} ${className}`}>
        {label && <label className="text-slate-300 text-sm">{label}</label>}
        <Input
          readOnly
          value={selectedEmployee?.name || displayText}
          className="bg-slate-800/50 border-slate-600 text-white"
        />
      </div>
    );
  }

  // ─── Compact filter variant ──────────────────────────────────
  if (variant === 'filter') {
    return (
      <div className={`relative ${className}`} ref={dropdownRef}>
        <div className="relative">
          <UserCheck className="absolute right-2.5 top-1/2 -translate-y-1/2 size-3.5 text-slate-400" />
          <Input
            placeholder={placeholder}
            value={displayText}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onFocus={() => setShowDropdown(true)}
            className="bg-slate-800/50 border-slate-700/50 text-white text-xs h-8 pr-8 w-36"
            role="combobox"
            aria-expanded={shouldShowDropdown}
            aria-haspopup="listbox"
            aria-autocomplete="list"
          />
          {value && value !== allOptionValue && (
            <button
              onClick={handleClear}
              className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
              aria-label="مسح"
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
              ref={listRef}
              role="listbox"
            >
              {showAllOption && (
                <button
                  onClick={() => handleSelect(allOptionValue, allOptionLabel)}
                  className="w-full text-right px-3 py-2 text-slate-400 text-xs hover:bg-violet-500/10 hover:text-violet-400 transition-colors border-b border-slate-700/50"
                >
                  {allOptionLabel}
                </button>
              )}
              {allowClear && (
                <button
                  onClick={handleClear}
                  className="w-full text-right px-3 py-2 text-slate-400 text-xs hover:bg-slate-700/50 hover:text-slate-300 transition-colors border-b border-slate-700/50"
                >
                  {clearLabel}
                </button>
              )}
              {visibleResults.length === 0 && (
                <div className="px-3 py-2 text-slate-500 text-xs text-center">لا توجد نتائج</div>
              )}
              {visibleResults.map((emp, i) => {
                const { line2 } = suggestionLines(emp, showDepartment, showPosition);
                const isActive = i === activeIndex;
                return (
                  <button
                    key={emp.id}
                    data-idx={i}
                    role="option"
                    aria-selected={isActive}
                    onClick={() => handleSelect(emp.id, emp.name)}
                    onMouseEnter={() => setActiveIndex(i)}
                    className={`w-full text-right px-3 py-2 text-xs transition-colors flex items-center gap-2 ${
                      isActive
                        ? 'bg-violet-500/15 text-violet-300'
                        : 'text-white hover:bg-violet-500/10'
                    }`}
                  >
                    <div className="size-5 rounded-full bg-slate-700 flex items-center justify-center flex-shrink-0">
                      <span className="text-[9px] font-bold">{emp.name.charAt(0)}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{emp.name}</p>
                      {line2 && <p className="text-slate-500 text-[10px] truncate">{line2}</p>}
                    </div>
                  </button>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  // ─── Form variant (default — wider, with label) ──────────────
  return (
    <div className={`relative space-y-2 ${colSpan || ''} ${className}`} ref={dropdownRef}>
      {label && <label className="text-slate-300 text-sm">{label}</label>}
      <div className="relative">
        <UserCheck className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-slate-500" />
        <Input
          placeholder={placeholder}
          value={displayText}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => setShowDropdown(true)}
          className="bg-slate-800 border-slate-600 text-white pr-9"
          role="combobox"
          aria-expanded={shouldShowDropdown}
          aria-haspopup="listbox"
          aria-autocomplete="list"
        />
        {/* Clear button */}
        {value && (
          <button
            onClick={handleClear}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
            aria-label="مسح"
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
            className="absolute z-50 top-full mt-1 w-full max-h-60 overflow-y-auto rounded-lg border border-slate-600 bg-slate-800 shadow-xl"
            ref={listRef}
            role="listbox"
          >
            {/* Clear option for optional fields */}
            {allowClear && (
              <button
                onClick={handleClear}
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
            {visibleResults.length === 0 ? (
              <div className="px-3 py-3 text-slate-500 text-xs text-center">لا توجد نتائج</div>
            ) : (
              visibleResults.map((emp, i) => {
                const { line2, line3 } = suggestionLines(emp, showDepartment, showPosition);
                const isActive = i === activeIndex;
                return (
                  <button
                    key={emp.id}
                    data-idx={i}
                    role="option"
                    aria-selected={isActive}
                    onClick={() => handleSelect(emp.id, emp.name)}
                    onMouseEnter={() => setActiveIndex(i)}
                    className={`w-full text-right px-3 py-2 text-sm transition-colors flex items-center gap-2 ${
                      isActive
                        ? 'bg-violet-500/15 text-violet-300'
                        : 'text-white hover:bg-violet-500/10'
                    }`}
                  >
                    <div className="size-6 rounded-full bg-slate-700 flex items-center justify-center flex-shrink-0">
                      <span className="text-[10px] font-bold">{emp.name.charAt(0)}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{emp.name}</p>
                      {line2 && <p className="text-slate-400 text-[10px] truncate">{line2}</p>}
                      {line3 && <p className="text-slate-500 text-[10px] truncate">{line3}</p>}
                    </div>
                  </button>
                );
              })
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default EmployeeSearchInput;
