// ══════════════════════════════════════════════════════════════
//  Actor resolver — centralizes user-name resolution for audit trails
//
//  Replaces the per-route getUsernameById helpers duplicated across
//  several API routes (follow-ups, complaints, etc.). All new routes
//  resolve the actor's display name through this single function.
//
//  Existing routes are untouched (backward compatible); new modules
//  consume this instead of re-implementing it.
// ══════════════════════════════════════════════════════════════

import { getById } from '@/lib/db';

export const SYSTEM_ACTOR_ID = 'system';
export const SYSTEM_ACTOR_NAME = 'النظام';

export interface Actor {
  id: string;
  name: string;
}

/**
 * Resolve a user's display name from their ID, for audit trails.
 * Returns 'النظام' if the user cannot be found or id is empty.
 *
 * @param userId - The authenticated user's ID (from JWT payload).
 */
export async function resolveActorName(userId: string | undefined | null): Promise<string> {
  if (!userId) return SYSTEM_ACTOR_NAME;
  const user = await getById<{ name?: string }>('users', userId);
  return user?.name || SYSTEM_ACTOR_NAME;
}

/**
 * Resolve a full actor { id, name } for audit writes.
 */
export async function resolveActor(userId: string | undefined | null): Promise<Actor> {
  const id = userId || SYSTEM_ACTOR_ID;
  const name = await resolveActorName(userId);
  return { id, name };
}
