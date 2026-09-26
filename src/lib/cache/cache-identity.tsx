'use client';

// ══════════════════════════════════════════════════════════════
//  Cache Identity Gate — user isolation + authorization-context
//  invalidation (§7/§34/§35).
//
//  The browser QueryClient is a singleton that outlives login
//  sessions. This gate makes user isolation STRUCTURAL:
//
//    1. Identity change (login as another user, logout, session
//       expiry) → cancel in-flight protected requests, then CLEAR the
//       whole data cache. No entry — scoped to the previous user's
//       permissions — can ever be served as the next user's data.
//       (User ids are deliberately NOT embedded in keys; see
//       lib/cache/query-keys.ts.)
//
//    2. Same user, changed EFFECTIVE PERMISSIONS (role / position /
//       direct override picked up by the 5-min identity refresh) →
//       invalidate every cached entry. The next server response —
//       which re-enforces scope per request — becomes authoritative.
//       Cached rows are still shown for one paint until the refetch
//       lands; the server remains the security boundary at all times
//       (§3) — the client cache never authorizes anything.
//
//  The signature is computed over sorted keys so it is stable across
//  rebuilds of the permissions object.
// ══════════════════════════════════════════════════════════════

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { permissionsSignature } from '@/lib/cache/permissions-signature';

export { permissionsSignature };

export function QueryCacheIdentityGate(): null {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const prevUserIdRef = useRef<string | null | undefined>(undefined);
  const prevPermSigRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const userId = user?.id ?? null;
    const permSig = user ? permissionsSignature(user.permissions) : null;

    const prevUserId = prevUserIdRef.current;
    const prevPermSig = prevPermSigRef.current;
    prevUserIdRef.current = userId;
    prevPermSigRef.current = permSig;

    // First resolved run — nothing cached yet worth touching.
    if (prevUserId === undefined && prevPermSig === undefined) return;

    // 1. Identity changed → hard isolation (§35).
    if (userId !== prevUserId) {
      queryClient.cancelQueries();
      queryClient.clear();
      return;
    }

    // 2. Same user, authorization context changed → revalidate
    //    everything through the server (§34).
    if (userId && prevPermSig !== undefined && permSig !== prevPermSig) {
      queryClient.invalidateQueries();
    }
  }, [user, queryClient]);

  return null;
}
