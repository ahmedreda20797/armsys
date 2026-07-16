/**
 * Universal Visual Builder — Node Template Store (PART 8)
 *
 * Persistence layer for user-authored node templates. Built on localStorage with
 * an in-memory cache + subscribe/notify so multiple components stay in sync.
 *
 * Supports: save, favorite, clone, delete, search, categorize.
 * Pure data operations — no execution.
 */

import type { VBNodeTemplate, VBNodeConfig } from './v2-types';
import { NODE_TEMPLATES } from './v2-catalogs';

const STORAGE_KEY = 'wf_node_templates_v1';
const FAV_KEY = 'wf_node_template_favs_v1';

type Listener = () => void;
const listeners = new Set<Listener>();

/* ─── In-memory cache ────────────────────────────────────────────────────── */

let cache: VBNodeTemplate[] | null = null;
let favCache: Set<string> | null = null;

function load(): VBNodeTemplate[] {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    cache = raw ? (JSON.parse(raw) as VBNodeTemplate[]) : [...NODE_TEMPLATES];
  } catch {
    cache = [...NODE_TEMPLATES];
  }
  return cache!;
}

function persist(): void {
  if (!cache) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    /* quota / SSR — ignore */
  }
  notify();
}

function loadFavs(): Set<string> {
  if (favCache) return favCache;
  try {
    favCache = new Set<string>(JSON.parse(localStorage.getItem(FAV_KEY) ?? '[]'));
  } catch {
    favCache = new Set();
  }
  return favCache!;
}

function persistFavs(): void {
  if (!favCache) return;
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify([...favCache]));
  } catch {
    /* ignore */
  }
}

function notify(): void {
  listeners.forEach((l) => l());
}

/* ─── Public API ─────────────────────────────────────────────────────────── */

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** All templates (built-in + user-saved). */
export function getAllTemplates(): VBNodeTemplate[] {
  return load();
}

/** Favorites are tracked separately so they survive template edits. */
export function getFavorites(): Set<string> {
  return loadFavs();
}

export function isFavorite(id: string): boolean {
  return loadFavs().has(id);
}

export function toggleFavorite(id: string): void {
  const favs = loadFavs();
  if (favs.has(id)) favs.delete(id);
  else favs.add(id);
  persistFavs();
  notify();
}

/** Save a new node template from a configured node. */
export function saveTemplate(input: {
  name: string;
  description: string;
  category: string;
  nodeType: string;
  config: VBNodeConfig;
  tags?: string[];
}): VBNodeTemplate {
  const all = load();
  const tpl: VBNodeTemplate = {
    id: `tpl_user_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    name: input.name,
    description: input.description,
    category: input.category || 'custom',
    nodeType: input.nodeType,
    config: input.config,
    tags: input.tags ?? [],
    favorite: false,
    createdAt: new Date().toISOString(),
    createdBy: 'user',
    usageCount: 0,
  };
  cache = [tpl, ...all];
  persist();
  return tpl;
}

/** Clone an existing template into a new editable copy. */
export function cloneTemplate(id: string): VBNodeTemplate | null {
  const all = load();
  const src = all.find((t) => t.id === id);
  if (!src) return null;
  const clone: VBNodeTemplate = {
    ...src,
    id: `tpl_clone_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    name: `${src.name} (نسخة)`,
    favorite: false,
    createdAt: new Date().toISOString(),
    usageCount: 0,
  };
  cache = [clone, ...all];
  persist();
  return clone;
}

/** Increment usage counter (when applied). */
export function incrementUsage(id: string): void {
  const all = load();
  cache = all.map((t) => (t.id === id ? { ...t, usageCount: t.usageCount + 1 } : t));
  persist();
}

/** Delete a user-saved template. Built-in templates cannot be deleted. */
export function deleteTemplate(id: string): boolean {
  const all = load();
  const target = all.find((t) => t.id === id);
  if (!target) return false;
  const next = all.filter((t) => t.id !== id);
  cache = next;
  persist();
  return true;
}

/** Search templates by text, category, or tags. */
export function searchTemplates(
  query: string,
  opts?: { category?: string | null; favoritesOnly?: boolean },
): VBNodeTemplate[] {
  const all = getAllTemplates();
  const favs = loadFavs();
  const q = query.trim().toLowerCase();
  return all
    .filter((t) => {
      if (opts?.category && t.category !== opts.category) return false;
      if (opts?.favoritesOnly && !favs.has(t.id) && !t.favorite) return false;
      if (!q) return true;
      return (
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.nodeType.toLowerCase().includes(q) ||
        t.tags.some((tag) => tag.toLowerCase().includes(q))
      );
    })
    .sort((a, b) => Number(favs.has(b.id)) - Number(favs.has(a.id)) || b.usageCount - a.usageCount);
}

/** Distinct categories across all templates. */
export function getCategories(): string[] {
  const all = getAllTemplates();
  return [...new Set(all.map((t) => t.category))].sort();
}
