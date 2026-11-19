// src/lib/connect/index.ts
// ══════════════════════════════════════════════════════════════
//  QNALYS Connect 1.0 — MODULE BARREL
//
//  Server-side consumers (API routes) import services from here.
//  Client code imports ONLY:
//    • '@/lib/connect/types'      (pure type contracts)
//    • '@/lib/connect/constants'  (limits + polling intervals)
//  — everything in this barrel reaches the server-only RTDB layer
//  and MUST stay out of client bundles (the 'server-only' markers in
//  each service make a stray client import fail the build loudly).
// ══════════════════════════════════════════════════════════════

export * from './types';
export * from './constants';
export * from './ids';
export * from './validation';
export * from './membership';
export * from './conversation-service';
export * from './message-service';
export * from './read-state-service';
export * from './sync-service';
export * from './notification-bridge';
export * from './audit-bridge';
