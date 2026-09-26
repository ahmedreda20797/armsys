'use client';

// ══════════════════════════════════════════════════════════════
//  use-page-header — §HEADER-V3 page→Header registration hooks
//
//  Two lightweight hooks let the CURRENT page feed the global Header
//  (identity + contextual actions) without the Header knowing any
//  page. Registration is page-scoped in the store (stale values from
//  an exiting page can never render for the next page) and is
//  released on unmount.
//
//    usePageIdentity({ title?, description?, icon? })
//      — the page's identity line in the Header. When a page does not
//        register, the Header falls back to the APP_PAGES registry
//        title (shared metadata, no per-page work).
//
//    usePageHeaderActions(actions)
//      — the page's contextual header actions (quick actions,
//        refresh, customize...). Actions must already be
//        permission-filtered by the page. Re-registration is
//        signature-guarded (ids/labels/state) so unrelated page
//        re-renders never churn the Header.
// ══════════════════════════════════════════════════════════════

import { useEffect, useRef } from 'react';
import {
  useAppStore,
  type HeaderContextualAction,
  type PageHeaderIdentity,
} from '@/lib/store';

export function usePageIdentity(identity: PageHeaderIdentity): void {
  const { title, description } = identity;
  // Keep the latest payload (including `icon`, which pages pass as a
  // fresh JSX element EVERY render) reachable without making its
  // per-render identity a re-registration trigger. Registering on
  // every render wrote a new object to the store each time, which
  // store-wide subscribers echoed back as a re-render — an infinite
  // update loop. Same doctrine as usePageHeaderActions below.
  const identityRef = useRef(identity);
  useEffect(() => {
    identityRef.current = identity;
  });

  useEffect(() => {
    const pageId = useAppStore.getState().currentPage;
    useAppStore.getState().setPageIdentity({ pageId, value: identityRef.current });
    return () => {
      // Release only if the registration is still ours (the next page
      // may have registered already).
      const current = useAppStore.getState().pageIdentity;
      if (current?.pageId === pageId) {
        useAppStore.getState().setPageIdentity(null);
      }
    };
    // title/description are the stable registration signature.
  }, [title, description]);
}

export function usePageHeaderActions(actions: HeaderContextualAction[]): void {
  // Signature covers everything the Header can visually react to, so
  // re-registering happens only when the action set actually changes —
  // closures inside `actions` may be recreated every render.
  const signature = actions
    .map((a) => `${a.id}:${a.display ?? 'menu'}:${a.active ? 1 : 0}:${a.disabled ? 1 : 0}`)
    .join('|');
  const actionsRef = useRef(actions);
  // Keep the latest closures reachable to the registration effect
  // without making their per-render identity a re-registration trigger.
  useEffect(() => {
    actionsRef.current = actions;
  });

  useEffect(() => {
    const pageId = useAppStore.getState().currentPage;
    // §UX-STRUCTURE 12A — STALE-CLOSURE FIX. The signature guard means
    // this registration does NOT re-run when only a handler's captured
    // state changed (e.g. the Home customize draft order/hidden set).
    // Registering the raw closures froze the header buttons to the
    // draft AS OF the last signature change — pressing حفظ after a
    // drag saved the PRE-EDIT layout (success toast, then everything
    // "reset" on reload). The registered actions therefore dispatch
    // through the ref: onClick dereferences the LATEST action with the
    // same id at click time, so behavior can never go stale even while
    // the visual signature (and thus re-registration) stays stable.
    const stable: HeaderContextualAction[] = actionsRef.current.map((a) => ({
      ...a,
      onClick: () => {
        const latest = actionsRef.current.find((x) => x.id === a.id);
        latest?.onClick?.();
      },
    }));
    useAppStore.getState().setPageHeaderActions({ pageId, value: stable });
    return () => {
      const current = useAppStore.getState().pageHeaderActions;
      if (current?.pageId === pageId) {
        useAppStore.getState().setPageHeaderActions(null);
      }
    };
  }, [signature]);
}
