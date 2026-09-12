'use client';

// ══════════════════════════════════════════════════════════════
//  RtlDirectionProvider — teaches every Radix primitive the app is RTL
//
//  Radix (dropdown menus, selects, dialogs, popovers) reads direction
//  ONLY from its own DirectionProvider context — it never inspects
//  document.dir. Without this wrapper every menu/dialog positioned
//  itself with LTR assumptions inside the RTL layout (wrong opening
//  side, wrong collision margins). Wrapping the app once here makes
//  ALL RowActionsMenus / selects / dialogs align correctly in RTL.
// ══════════════════════════════════════════════════════════════

import { DirectionProvider } from '@radix-ui/react-direction';

export function RtlDirectionProvider({ children }: { children: React.ReactNode }) {
  return <DirectionProvider dir="rtl">{children}</DirectionProvider>;
}
