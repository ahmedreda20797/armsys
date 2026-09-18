'use client';

// ══════════════════════════════════════════════════════════════
//  OverflowMenu — the ONE reusable ⋮ action-menu pattern (§6)
//
//  Enterprise rule: primary actions stay visible; secondary and
//  contextual actions are grouped inside the three-dot overflow.
//  Built on the existing Radix DropdownMenu primitives — no second
//  menu implementation. Consumers describe ITEMS declaratively;
//  the component renders the ⋮ trigger + the menu.
// ══════════════════════════════════════════════════════════════

import { MoreVertical } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export interface OverflowMenuItem {
  key: string;
  label: string;
  icon?: React.ReactNode;
  /** Destructive styling (delete/archive). */
  destructive?: boolean;
  /** Visual separator rendered ABOVE this item. */
  separatorBefore?: boolean;
  onSelect: () => void;
}

interface OverflowMenuProps {
  items: OverflowMenuItem[];
  /** Accessible label for the ⋮ trigger. */
  label?: string;
  /** Stop click propagation (record cards open details on click). */
  stopPropagation?: boolean;
  align?: 'start' | 'center' | 'end';
}

export function OverflowMenu({
  items,
  label = 'المزيد من الإجراءات',
  stopPropagation = true,
  align = 'start',
}: OverflowMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={label}
          title={label}
          onClick={(e) => {
            if (stopPropagation) e.stopPropagation();
          }}
          className="p-1.5 rounded-md text-slate-500 hover:text-white hover:bg-slate-700/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
        >
          <MoreVertical className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        sideOffset={4}
        onClick={(e) => {
          if (stopPropagation) e.stopPropagation();
        }}
        className="bg-slate-900 border-slate-700/60 min-w-40"
      >
        {items.map((item) => (
          <div key={item.key}>
            {item.separatorBefore && <DropdownMenuSeparator className="bg-slate-700/50" />}
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                item.onSelect();
              }}
              className={`gap-2 cursor-pointer text-xs ${
                item.destructive
                  ? 'text-red-400 focus:text-red-300 focus:bg-red-500/10'
                  : 'text-slate-300 focus:text-white focus:bg-slate-800'
              }`}
            >
              {item.icon}
              {item.label}
            </DropdownMenuItem>
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
