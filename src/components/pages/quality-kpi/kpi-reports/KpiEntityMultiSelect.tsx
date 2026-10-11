'use client';

// ══════════════════════════════════════════════════════════════
//  KpiEntityMultiSelect — searchable multi-select with chips
//
//  The scope-selection control for KPI Reports 2.0 (spec §6/§7):
//  employees, teams or departments — NEVER a giant dropdown of the
//  whole directory at once. Built on the house Popover + cmdk
//  pattern (OrgAssignmentPicker):
//
//    • search (Arabic + English, normalization-friendly)
//    • select / deselect / select visible results / clear all
//    • compact removable chips for the selected set
//    • keyboard accessibility via cmdk (arrows + enter + esc)
//    • RTL/LTR safe (logical properties only)
//
//  The value is always canonical ids; labels are derived from the
//  option set the server already authorized.
// ══════════════════════════════════════════════════════════════

import { useMemo, useState } from 'react';
import { Check, ChevronsUpDown, Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Button } from '@/components/ui/button';
import { T } from '@/lib/i18n/T';
import { useLanguage } from '@/lib/i18n/language-context';
import { translateUIText } from '@/lib/i18n/ui-text';

export interface KpiMultiSelectOption {
  id: string;
  label: string;
  /** Secondary line (department, employee count…). */
  hint?: string | null;
}

interface KpiEntityMultiSelectProps {
  options: ReadonlyArray<KpiMultiSelectOption>;
  selected: ReadonlyArray<string>;
  onChange: (next: string[]) => void;
  /** Trigger placeholder when nothing is selected. */
  placeholder: string;
  /** Search box placeholder. */
  searchPlaceholder: string;
  disabled?: boolean;
  className?: string;
  /** Item count cutoff before "keep typing" applies (directory guard). */
  maxVisible?: number;
}

export function KpiEntityMultiSelect({
  options,
  selected,
  onChange,
  placeholder,
  searchPlaceholder,
  disabled = false,
  className,
  maxVisible = 60,
}: KpiEntityMultiSelectProps) {
  const { locale } = useLanguage();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const byId = useMemo(() => new Map(options.map((o) => [o.id, o])), [options]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q
      ? options.filter(
          (o) =>
            o.label.toLowerCase().includes(q) ||
            (o.hint ?? '').toLowerCase().includes(q) ||
            o.id.toLowerCase().includes(q),
        )
      : options;
    return base.slice(0, maxVisible);
  }, [options, query, maxVisible]);

  const toggle = (id: string) => {
    if (selectedSet.has(id)) {
      onChange(selected.filter((s) => s !== id));
    } else {
      onChange([...selected, id]);
    }
  };

  const selectVisible = () => {
    const merged = new Set(selected);
    for (const option of filtered) merged.add(option.id);
    onChange([...merged]);
  };

  const clearAll = () => onChange([]);

  return (
    <div className={cn('min-w-0', className)}>
      {/* Selected chips */}
      {selected.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 mb-1.5">
          {selected.map((id) => {
            const option = byId.get(id);
            return (
              <span
                key={id}
                className="inline-flex items-center gap-1 rounded-full border border-brand-500/30 bg-brand-500/15 px-2 py-0.5 text-[11px] text-brand-200 max-w-[220px]"
              >
                <span className="truncate">{option?.label ?? id}</span>
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={locale === 'en' ? `Remove ${option?.label ?? id}` : `إزالة ${option?.label ?? id}`}
                  onClick={() => toggle(id)}
                  className="rounded-full p-0.5 hover:bg-brand-500/30 disabled:opacity-50"
                >
                  <X className="size-3" />
                </button>
              </span>
            );
          })}
          <button
            type="button"
            disabled={disabled}
            onClick={clearAll}
            className="text-[11px] text-slate-500 hover:text-slate-300 disabled:opacity-50"
          >
            <T>مسح الكل</T>
          </button>
        </div>
      )}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            className="h-8 w-full justify-between border-slate-700/60 bg-slate-900/60 text-xs font-normal hover:bg-slate-800/60"
          >
            <span className="flex items-center gap-1.5 text-slate-300 truncate">
              <Plus className="size-3.5 shrink-0 text-slate-500" />
              <T>{placeholder}</T>
            </span>
            <ChevronsUpDown className="size-3.5 shrink-0 text-slate-500" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder={translateUIText(searchPlaceholder, locale)}
              value={query}
              onValueChange={setQuery}
              className="text-xs"
            />
            <CommandList className="max-h-64">
              <CommandEmpty className="py-4 text-center text-xs text-slate-500">
                <T>لا توجد نتائج</T>
              </CommandEmpty>
              <CommandGroup>
                {filtered.map((option) => {
                  const isSelected = selectedSet.has(option.id);
                  return (
                    <CommandItem
                      key={option.id}
                      value={option.id}
                      onSelect={() => toggle(option.id)}
                      className="text-xs gap-2"
                    >
                      <Check
                        className={cn(
                          'size-3.5 shrink-0',
                          isSelected ? 'text-brand-300' : 'text-transparent',
                        )}
                      />
                      <span className="flex-1 truncate">{option.label}</span>
                      {option.hint && (
                        <span className="text-[10px] text-slate-500 shrink-0">{option.hint}</span>
                      )}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
              {filtered.length > 0 && (
                <div className="border-t border-slate-800 p-1.5 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={selectVisible}
                    className="flex-1 rounded-md px-2 py-1 text-[11px] text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
                  >
                    <T>تحديد الظاهر</T>
                  </button>
                  <button
                    type="button"
                    onClick={clearAll}
                    className="rounded-md px-2 py-1 text-[11px] text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
                  >
                    <T>مسح الكل</T>
                  </button>
                </div>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
