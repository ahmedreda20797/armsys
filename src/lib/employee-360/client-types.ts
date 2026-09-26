// ══════════════════════════════════════════════════════════════
//  Employee 360 — client-side view of the API payload
//
//  The API response IS the Employee360ViewModel (server-serialized).
//  This alias keeps client imports decoupled from the server module
//  internals while sharing ONE shape (no parallel view-model).
// ══════════════════════════════════════════════════════════════

import type { Employee360ViewModel } from '@/lib/employee-360/view-model';

export type Employee360Data = Employee360ViewModel;
