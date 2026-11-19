// src/hooks/use-connect.ts
// ══════════════════════════════════════════════════════════════
//  QNALYS Connect 1.0 — CLIENT DATA LAYER (React Query)
//
//  Every Connect network touch lives here — components never fetch.
//
//  §SYNC — the active conversation runs an incremental sync query
//  (~10s, hidden tabs paused via refetchIntervalInBackground:false);
//  each round MERGES into the messages cache through the pure
//  client-merge functions (new + updated + tombstones) and advances
//  the cursor. Older history is explicit pagination ("load older") —
//  never a full conversation download.
//  §OPTIMISTIC — sends append a temp bubble keyed by clientKey; the
//  idempotent server response replaces it deterministically, so
//  optimistic updates are safe (§SPEC-14).
// ══════════════════════════════════════════════════════════════

'use client';

import { useCallback, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { apiFetch } from '@/lib/query-provider';
import {
  ACCOUNT_SEARCH_MIN,
  ACTIVE_CONVERSATION_POLL_MS,
  CONVERSATION_LIST_POLL_MS,
} from '@/lib/connect/constants';
import { activePollIntervalMs, listPollIntervalMs } from '@/lib/connect/sync-policy';
import {
  applySyncPayload,
  makeInitialCache,
  prependOlderPage,
  type MessagesCacheShape,
} from '@/lib/connect/client-merge';
import type {
  ConnectAccountSummary,
  ConversationMemberView,
  ConversationSyncPayload,
  ConversationView,
  MessageView,
  SendMessageResult,
} from '@/lib/connect/types';

// ─── Query keys ────────────────────────────────────────────────

export const connectKeys = {
  conversations: (includeArchived: boolean) => ['connect', 'conversations', includeArchived ? 'all' : 'active'] as const,
  messages: (conversationId: string) => ['connect', 'messages', conversationId] as const,
  search: (conversationId: string, q: string) => ['connect', 'search', conversationId, q] as const,
};

// ─── Wire types (API envelopes) ────────────────────────────────

interface MessagesPageResponse {
  data: { messages: MessageView[]; hasOlder: boolean; oldestKey: string | null; newestKey: string | null };
}
interface SyncResponse { data: ConversationSyncPayload }
interface ConversationsResponse { data: ConversationView[] }
interface SendResponse { data: SendMessageResult }

// ─── Conversation list ─────────────────────────────────────────

export function useConnectConversations(includeArchived: boolean, enabled = true) {
  return useQuery<ConversationView[]>({
    queryKey: connectKeys.conversations(includeArchived),
    queryFn: async () => {
      const res = await apiFetch<ConversationsResponse>(
        `/api/connect/conversations?limit=100${includeArchived ? '&includeArchived=1' : ''}`,
      );
      return res.data;
    },
    enabled,
    staleTime: 15_000,
    refetchInterval: listPollIntervalMs() || CONVERSATION_LIST_POLL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: 1,
  });
}

// ─── Messages cache + incremental sync ─────────────────────────

export function useConnectMessages(conversationId: string | null, enabled = true) {
  const queryClient = useQueryClient();
  return useQuery<MessagesCacheShape>({
    queryKey: connectKeys.messages(conversationId ?? 'none'),
    enabled: Boolean(conversationId) && enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const res = await apiFetch<MessagesPageResponse>(`/api/connect/conversations/${conversationId}/messages?limit=50`);
      return makeInitialCache(res.data.messages, res.data.hasOlder, res.data.oldestKey, res.data.newestKey);
    },
    // Initial cache reset on conversation switch is handled by the key.
    placeholderData: (prev, prevQuery) =>
      prevQuery?.queryKey[2] === conversationId ? prev : undefined,
  });
}

/**
 * The active-conversation sync loop. Merges each round into the
 * messages cache and returns the LIVE sync payload (typing, pins)
 * for the thread UI. Failures back off via activePollIntervalMs.
 */
export function useConnectSync(
  conversationId: string | null,
  enabled: boolean,
): UseQueryResult<ConversationSyncPayload> & { consecutiveFailures: number } {
  const queryClient = useQueryClient();
  const query = useQuery<ConversationSyncPayload>({
    queryKey: ['connect', 'sync', conversationId ?? 'none'],
    enabled: Boolean(conversationId) && enabled,
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: true,
    refetchIntervalInBackground: false,
    // §SYNC-POLICY — healthy rounds poll at the fixed interval; failing
    // rounds back off 1×→8× (capped) via the tested sync-policy helper.
    refetchInterval: (q) => (
      q.state.data ? ACTIVE_CONVERSATION_POLL_MS : activePollIntervalMs(q.state.fetchFailureCount)
    ),
    queryFn: async () => {
      const cache = queryClient.getQueryData<MessagesCacheShape>(connectKeys.messages(conversationId ?? ''));
      const params = new URLSearchParams();
      if (cache?.cursor) params.set('cursor', cache.cursor);
      // §SYNC-CONTINUATION — the composite updated cursor (ms + key,
      // server-provided, advanced only past processed records); falls
      // back to the last round's serverTimeMs before the first
      // updated-window run.
      const sinceMs = cache?.updatedCursorMs ?? cache?.syncedAtMs ?? null;
      if (sinceMs) params.set('sinceMs', String(sinceMs));
      if (cache?.updatedCursorMs && cache?.updatedCursorKey) params.set('sinceKey', cache.updatedCursorKey);
      const res = await apiFetch<SyncResponse>(`/api/connect/conversations/${conversationId}/sync?${params.toString()}`);
      if (cache && conversationId) {
        queryClient.setQueryData<MessagesCacheShape>(
          connectKeys.messages(conversationId),
          (current) => (current ? applySyncPayload(current, res.data) : current),
        );
      }
      return res.data;
    },
  });
  return { ...query, consecutiveFailures: query.failureCount ?? 0 };
}

/** Explicit older-page pagination (the "load older" button). */
export function useLoadOlderMessages(conversationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const cache = queryClient.getQueryData<MessagesCacheShape>(connectKeys.messages(conversationId));
      if (!cache?.oldestKey || !cache.hasOlder) return null;
      const res = await apiFetch<MessagesPageResponse>(
        `/api/connect/conversations/${conversationId}/messages?limit=50&before=${encodeURIComponent(cache.oldestKey)}`,
      );
      queryClient.setQueryData<MessagesCacheShape>(
        connectKeys.messages(conversationId),
        (current) => (current
          ? prependOlderPage(current, res.data.messages, res.data.hasOlder, res.data.oldestKey)
          : current),
      );
      return res.data;
    },
    retry: false,
  });
}

// ─── Mutations ─────────────────────────────────────────────────

export interface SendMessageVars {
  body: string;
  clientKey: string;
  replyToId: string | null;
  mentions: string[] | null;
}

export function useSendMessage(conversationId: string) {
  const queryClient = useQueryClient();

  return useMutation<MessageView, Error, SendMessageVars, { tempId: string }>({
    mutationFn: async (vars) => {
      const res = await apiFetch<SendResponse>(`/api/connect/conversations/${conversationId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body: vars.body,
          clientKey: vars.clientKey,
          replyToId: vars.replyToId,
          mentions: vars.mentions,
        }),
      });
      return res.data.message;
    },
    // §OPTIMISTIC — temp bubble keyed by clientKey; idempotent send
    // makes the reconciliation deterministic (created OR existing).
    onMutate: async (vars) => {
      const tempId = `pending:${vars.clientKey}`;
      const cache = queryClient.getQueryData<MessagesCacheShape>(connectKeys.messages(conversationId));
      if (cache) {
        queryClient.setQueryData<MessagesCacheShape>(connectKeys.messages(conversationId), {
          ...cache,
          messages: [...cache.messages, {
            id: tempId,
            conversationId,
            senderUserId: '__me__',
            senderName: null,
            body: vars.body,
            replyToId: vars.replyToId,
            replyPreview: null,
            mentions: vars.mentions,
            references: null,
            editedAt: null,
            deletedAt: null,
            createdAt: new Date().toISOString(),
            createdAtMs: Date.now(),
          }],
        });
      }
      return { tempId };
    },
    onSuccess: (message, _vars, context) => {
      queryClient.setQueryData<MessagesCacheShape>(
        connectKeys.messages(conversationId),
        (current) => {
          if (!current) return current;
          const withoutTemp = current.messages.filter((m) => m.id !== context?.tempId && m.id !== message.id);
          return {
            ...current,
            messages: [...withoutTemp, message].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
            cursor: current.cursor && current.cursor > message.id ? current.cursor : message.id,
          };
        },
      );
      queryClient.invalidateQueries({ queryKey: ['connect', 'conversations'] });
    },
    onError: (_error, _vars, context) => {
      if (context?.tempId) {
        queryClient.setQueryData<MessagesCacheShape>(
          connectKeys.messages(conversationId),
          (current) => current
            ? { ...current, messages: current.messages.filter((m) => m.id !== context.tempId) }
            : current,
        );
      }
    },
  });
}

export function useEditMessage(conversationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ messageId, body }: { messageId: string; body: string }) => {
      await apiFetch(`/api/connect/conversations/${conversationId}/messages/${encodeURIComponent(messageId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      return { messageId, body };
    },
    onSuccess: ({ messageId, body }) => {
      queryClient.setQueryData<MessagesCacheShape>(connectKeys.messages(conversationId), (current) => {
        if (!current) return current;
        return {
          ...current,
          messages: current.messages.map((m) => (m.id === messageId ? { ...m, body, editedAt: new Date().toISOString() } : m)),
        };
      });
    },
    retry: false,
  });
}

export function useDeleteMessage(conversationId: string, mode: 'tombstone' | 'purge' = 'tombstone') {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ messageId }: { messageId: string }) => {
      await apiFetch(
        `/api/connect/conversations/${conversationId}/messages/${encodeURIComponent(messageId)}?mode=${mode}`,
        { method: 'DELETE' },
      );
      return { messageId };
    },
    onSuccess: ({ messageId }) => {
      queryClient.setQueryData<MessagesCacheShape>(connectKeys.messages(conversationId), (current) => {
        if (!current) return current;
        return {
          ...current,
          messages: current.messages.map((m) => (m.id === messageId
            ? { ...m, body: null, deletedAt: new Date().toISOString(), mentions: null, references: null }
            : m)),
        };
      });
      queryClient.invalidateQueries({ queryKey: ['connect', 'conversations'] });
    },
    retry: false,
  });
}

export function useMarkRead(conversationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (messageId: string | null) => {
      await apiFetch(`/api/connect/conversations/${conversationId}/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(messageId ? { messageId } : {}),
      });
    },
    onSuccess: () => {
      // Badge refresh — the list recomputes unread counts server-side.
      queryClient.invalidateQueries({ queryKey: ['connect', 'conversations'] });
    },
    retry: false,
  });
}

export function useTypingPing(conversationId: string) {
  return useMutation({
    mutationFn: async () => {
      await apiFetch(`/api/connect/conversations/${conversationId}/typing`, { method: 'POST' });
    },
    retry: false,
    gcTime: 0,
  });
}

export function useTogglePin(conversationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ messageId, pinned }: { messageId: string; pinned: boolean }) => {
      await apiFetch(`/api/connect/conversations/${conversationId}/pins`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId, pinned }),
      });
      return { messageId, pinned };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['connect', 'sync', conversationId] });
    },
    retry: false,
  });
}

export function useCreateConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const res = await apiFetch<{ data: { id: string }; created: boolean }>('/api/connect/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      return res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['connect', 'conversations'] });
    },
    retry: false,
  });
}

export function useConversationMutation(conversationId: string) {
  const queryClient = useQueryClient();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['connect', 'conversations'] });
    queryClient.invalidateQueries({ queryKey: ['connect', 'detail', conversationId] });
  };
  return {
    invalidate,
    patch: useMutation({
      mutationFn: async (payload: Record<string, unknown>) => {
        await apiFetch(`/api/connect/conversations/${encodeURIComponent(conversationId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      },
      onSuccess: invalidate,
      retry: false,
    }),
    leave: useMutation({
      mutationFn: async () => {
        await apiFetch(`/api/connect/conversations/${encodeURIComponent(conversationId)}`, { method: 'DELETE' });
      },
      onSuccess: invalidate,
      retry: false,
    }),
    addMembers: useMutation({
      mutationFn: async (userIds: string[]) => {
        await apiFetch(`/api/connect/conversations/${encodeURIComponent(conversationId)}/members`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userIds }),
        });
      },
      onSuccess: invalidate,
      retry: false,
    }),
    removeMember: useMutation({
      mutationFn: async (memberId: string) => {
        await apiFetch(`/api/connect/conversations/${encodeURIComponent(conversationId)}/members/${encodeURIComponent(memberId)}`, {
          method: 'DELETE',
        });
      },
      onSuccess: invalidate,
      retry: false,
    }),
    changeRole: useMutation({
      mutationFn: async ({ memberId, role }: { memberId: string; role: 'admin' | 'member' }) => {
        await apiFetch(`/api/connect/conversations/${encodeURIComponent(conversationId)}/members/${encodeURIComponent(memberId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role }),
        });
      },
      onSuccess: invalidate,
      retry: false,
    }),
  };
}

// ─── Search (in-conversation only) ─────────────────────────────

interface SearchResponse {
  data: { messages: MessageView[]; scannedCount: number; partialCoverage: boolean };
}

export function useConversationSearch(conversationId: string | null, query: string) {
  const trimmed = query.trim();
  return useQuery({
    queryKey: connectKeys.search(conversationId ?? 'none', trimmed),
    enabled: Boolean(conversationId) && trimmed.length >= 2,
    staleTime: 10_000,
    retry: 1,
    queryFn: async () => {
      const res = await apiFetch<SearchResponse>(
        `/api/connect/conversations/${conversationId}/search?q=${encodeURIComponent(trimmed)}`,
      );
      return res.data;
    },
  });
}

// ─── Details + members (detail dialog) ─────────────────────────

interface DetailsResponse {
  data: ConversationView & { members: ConversationMemberView[]; pinnedMessageIds: string[]; deptNodeId: string | null };
}

export function useConversationDetails(conversationId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['connect', 'detail', conversationId ?? 'none'],
    enabled: Boolean(conversationId) && enabled,
    staleTime: 15_000,
    retry: 1,
    queryFn: async () => {
      const res = await apiFetch<DetailsResponse>(`/api/connect/conversations/${encodeURIComponent(conversationId ?? '')}`);
      return res.data;
    },
  });
}

// ─── Account search (the ONLY direct-chat entry workflow) ────────

interface AccountSearchResponse {
  data: { accounts: ConnectAccountSummary[] };
}

/**
 * Server-side USER-ACCOUNT search for starting a direct conversation.
 * Debounced by the caller (panel input); results are a minimal
 * display projection ({ id, name, photoUrl }) — never emails, roles,
 * or private fields. Not an employee-directory source.
 */
export function useConnectAccountSearch(query: string, enabled = true) {
  const trimmed = query.trim();
  return useQuery<ConnectAccountSummary[]>({
    queryKey: ['connect', 'account-search', trimmed],
    enabled: enabled && trimmed.length >= ACCOUNT_SEARCH_MIN,
    staleTime: 30_000,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const res = await apiFetch<AccountSearchResponse>(
        `/api/connect/users?query=${encodeURIComponent(trimmed)}`,
      );
      return res.data.accounts;
    },
  });
}

export interface UseOpenDirectConversationResult {
  openDirect: (otherUserId: string) => Promise<string>;
  pendingUserId: string | null;
}

/**
 * Select-to-open-or-create: resolves THE direct conversation with the
 * picked account through the existing secure get-or-create API and
 * returns its id. Dedup/concurrency/self-DM are server guarantees;
 * the hook coalesces overlapping selections onto ONE in-flight
 * request per account, so repeated clicks never duplicate requests.
 */
export function useOpenDirectConversation(onError: (message: string) => void): UseOpenDirectConversationResult {
  const queryClient = useQueryClient();
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);
  const inFlightRef = useRef<Map<string, Promise<string>>>(new Map());

  const openDirect = useCallback((otherUserId: string): Promise<string> => {
    const existing = inFlightRef.current.get(otherUserId);
    if (existing) return existing;

    const request = (async () => {
      try {
        const res = await apiFetch<{ data: { id: string }; created: boolean }>('/api/connect/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'direct', otherUserId }),
        });
        // The list now contains the conversation (server wrote both
        // members' index entries); refresh badges/ordering.
        queryClient.invalidateQueries({ queryKey: ['connect', 'conversations'] });
        return res.data.id;
      } catch (error) {
        onError(error instanceof Error ? error.message : 'تعذر فتح المحادثة');
        throw error;
      } finally {
        inFlightRef.current.delete(otherUserId);
      }
    })();
    inFlightRef.current.set(otherUserId, request);
    setPendingUserId(otherUserId);
    request.finally(() => {
      if (inFlightRef.current.size === 0) setPendingUserId(null);
    }).catch(() => undefined); // rejection handled by the caller
    return request;
  }, [onError, queryClient]);

  return { openDirect, pendingUserId };
}
