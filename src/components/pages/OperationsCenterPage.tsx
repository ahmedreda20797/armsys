'use client';

// AOCC (ARM Operations Command Center)
// Thin re-export wrapper — preserves the existing import path and default export
// so the dynamic(() => import('@/components/pages/OperationsCenterPage'))
// in src/app/page.tsx keeps working with zero routing change.
// All logic now lives in the modular AOCC components.

export { default } from '@/components/aocc/AoccLayout';
