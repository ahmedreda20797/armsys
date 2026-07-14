'use client';

import React from 'react';
import { AnimatePresence } from 'framer-motion';
import { PersistentBackground } from '@/components/shared/PersistentBackground';
import { LoadingOverlay } from './LoadingOverlay';
import { useAuth } from '@/contexts/AuthContext';

/**
 * AppShell — mounts exactly once, never unmounts.
 *
 * Z-layer contract:
 *   z-0   PersistentBackground  — fixed, pointer-events-none, immune to auth state
 *   z-10  children              — app content + login overlay (managed by AppContent)
 *   z-20  LoadingOverlay        — fades in/out over everything during session init
 *
 * Only the LoadingOverlay participates in AnimatePresence here.
 * PersistentBackground is never inside any conditional render or AnimatePresence.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const { loading } = useAuth();

  return (
    <>
      {/* Layer 0 — permanent, never re-renders due to auth state (React.memo) */}
      <PersistentBackground />

      {/* Layer 10 — always mounted; AppContent manages login ↔ ready internally */}
      <div className="relative z-10">{children}</div>

      {/* Layer 20 — loading overlay fades out once session check completes */}
      <AnimatePresence>
        {loading && <LoadingOverlay key="loading" />}
      </AnimatePresence>
    </>
  );
}
