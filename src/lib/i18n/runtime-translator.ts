'use client';

// src/lib/i18n/runtime-translator.ts
// ══════════════════════════════════════════════════════════════
//  §20.1-RUNTIME — the document-level EN/AR translation engine.
//
//  WHY: the app is authored Arabic-first with inline strings across
//  hundreds of components. The keyed `t()` dictionary (§20.1) covers
//  the shell; THIS layer delivers full-system English coverage today
//  by translating the rendered DOM directly, driven by EN_MAP
//  (keyed by the Arabic source text itself):
//
//    • EXACT pass — a text node whose trimmed content equals a key
//      (buttons, chips, table headers, menu items) → whole swap.
//    • BOUNDED PHRASE pass — the Arabic phrase replaced inside longer
//      text ONLY at whole-Arabic-word boundaries (lookbehind/ahead on
//      [\u0600-\u06FF]) — composed labels («القسم: X») translate while
//      numbers, emails and Latin content pass through untouched, and
//      words are never mangled mid-word.
//    • Attributes: placeholder / aria-label / title get the same
//      treatment. Input VALUES are never touched (they are user data).
//
//  SPEED (the §20.1 switching contract):
//    • locale 'ar' → the layer is COMPLETELY INERT (no DOM writes).
//    • locale 'en' → one synchronous pass over the live document
//      (a few thousand text nodes → single-digit milliseconds), then
//      a MutationObserver translates only the INCREMENTAL added
//      subtrees, coalesced per animation frame.
//    • Switching back restores every original node/attribute from the
//      stash kept ON the node itself (GC-friendly — no registry).
//    • Elements carrying data-no-i18n are skipped wholesale.
// ══════════════════════════════════════════════════════════════

import { EN_MAP } from './en-map';

const ARABIC = /[\u0600-\u06FF]/;
const HAS_ARABIC = (s: string) => ARABIC.test(s);

/** Whole-Arabic-word boundary pattern for a phrase. */
function phraseRegex(phrase: string): RegExp {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\u0600-\\u06FF])${escaped}(?![\\u0600-\\u06FF])`, 'g');
}

/** Sorted longest-first — longer phrases win over their parts. */
const PHRASES: Array<[string, string, RegExp]> = Object.entries(EN_MAP)
  .filter(([ar]) => ar.length >= 2)
  .sort((a, b) => b[0].length - a[0].length)
  .map(([ar, en]) => [ar, en, phraseRegex(ar)] as [string, string, RegExp]);

/** Exact-match lookup (trimmed). */
const EXACT = new Map<string, string>(Object.entries(EN_MAP));

const ORIG_PROP = '__qnlysI18nOrig';
const ATTR_ORIG_PROP = '__qnlysI18nAttrOrig';

function translateString(raw: string): string | null {
  if (!HAS_ARABIC(raw)) return null;
  const exact = EXACT.get(raw.trim());
  if (exact !== undefined) return exact;
  // Bounded phrase pass — longest first. Cheap substring gate first.
  let out: string | null = null;
  for (const [ar, en, re] of PHRASES) {
    if (!raw.includes(ar)) continue;
    if (out === null) out = raw;
    re.lastIndex = 0;
    out = out.replace(re, en);
  }
  return out;
}

function stashText(node: Text, original: string): void {
  const w = node as unknown as Record<string, unknown>;
  if (w[ORIG_PROP] === undefined) w[ORIG_PROP] = original;
}

function stashAttr(el: Element, name: string, original: string): void {
  const w = el as unknown as Record<string, unknown>;
  const stash = (w[ATTR_ORIG_PROP] as Record<string, string> | undefined) ?? {};
  if (stash[name] === undefined) stash[name] = original;
  w[ATTR_ORIG_PROP] = stash;
}

function translateTextNode(node: Text): void {
  const raw = node.nodeValue ?? '';
  if (!raw || !HAS_ARABIC(raw)) return;
  const next = translateString(raw);
  if (next === null || next === raw) return;
  stashText(node, raw);
  node.nodeValue = next;
}

function restoreTextNode(node: Text): void {
  const w = node as unknown as Record<string, unknown>;
  const orig = w[ORIG_PROP];
  if (typeof orig === 'string') {
    node.nodeValue = orig;
    delete w[ORIG_PROP];
  }
}

function translateElementAttributes(el: Element): void {
  for (const name of ['placeholder', 'aria-label', 'title']) {
    const value = el.getAttribute(name);
    if (!value || !HAS_ARABIC(value)) continue;
    const next = translateString(value);
    if (next === null || next === value) continue;
    stashAttr(el, name, value);
    el.setAttribute(name, next);
  }
}

function restoreElementAttributes(el: Element): void {
  const w = el as unknown as Record<string, unknown>;
  const stash = w[ATTR_ORIG_PROP] as Record<string, string> | undefined;
  if (!stash) return;
  for (const [name, value] of Object.entries(stash)) {
    el.setAttribute(name, value);
  }
  delete w[ATTR_ORIG_PROP];
}

function skipSubtree(node: Node): boolean {
  return node instanceof Element && node.hasAttribute('data-no-i18n');
}

/**
 * Walk a root.
 *  'en' mode → visit text nodes containing Arabic + every element (attrs).
 *  'ar' mode → visit text nodes / elements carrying a stash (translated
 *              ones no longer contain Arabic, so the filter keys on the
 *              stash itself); plain nodes are traversed but skipped.
 */
function walk(root: ParentNode, mode: 'en' | 'ar'): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      if (skipSubtree(node)) return NodeFilter.FILTER_REJECT;
      if (node.nodeType === Node.TEXT_NODE) {
        if (mode === 'en') {
          return node.nodeValue && HAS_ARABIC(node.nodeValue)
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_SKIP;
        }
        return (node as Text)[ORIG_PROP] !== undefined
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_SKIP;
      }
      // element
      if (mode === 'en') return NodeFilter.FILTER_ACCEPT;
      return (node as Element)[ATTR_ORIG_PROP] !== undefined
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_SKIP;
    },
  });

  const textNodes: Text[] = [];
  const elements: Element[] = [];
  let current = walker.nextNode();
  while (current) {
    if (current.nodeType === Node.TEXT_NODE) textNodes.push(current as Text);
    else elements.push(current as Element);
    current = walker.nextNode();
  }

  for (const node of textNodes) {
    if (mode === 'en') translateTextNode(node);
    else restoreTextNode(node);
  }
  for (const el of elements) {
    if (mode === 'en') translateElementAttributes(el);
    else restoreElementAttributes(el);
  }
}

// ── Observer lifecycle ─────────────────────────────────────────

let observer: MutationObserver | null = null;
let pendingRoots: Set<Node> | null = null;
let frame = 0;

function flushRoots(): void {
  frame = 0;
  const roots = pendingRoots;
  pendingRoots = null;
  if (!roots || !observer) return;
  for (const root of roots) {
    if (root.nodeType === Node.TEXT_NODE) {
      translateTextNode(root as Text);
    } else if (root.nodeType === Node.ELEMENT_NODE) {
      const el = root as Element;
      translateElementAttributes(el);
      walk(el, 'en');
    }
  }
}

function handleMutations(mutations: MutationRecord[]): void {
  if (!observer) return;
  for (const m of mutations) {
    if (m.type === 'childList') {
      for (const node of m.addedNodes) {
        if (node.nodeType !== Node.TEXT_NODE && node.nodeType !== Node.ELEMENT_NODE) continue;
        if (node.nodeValue && !HAS_ARABIC(node.nodeValue) &&
            (!(node instanceof Element) || !node.textContent || !HAS_ARABIC(node.textContent))) continue;
        pendingRoots ??= new Set<Node>();
        pendingRoots.add(node);
      }
    } else if (m.type === 'attributes') {
      const el = m.target as Element;
      const v = el.getAttribute(m.attributeName ?? '');
      if (v && HAS_ARABIC(v)) {
        pendingRoots ??= new Set<Node>();
        pendingRoots.add(el);
      }
    }
  }
  if (pendingRoots && !frame) {
    // Coalesce bursts (React commit storms) into one pass per frame.
    frame = requestAnimationFrame(flushRoots);
  }
}

function startObserver(): void {
  if (observer) return;
  observer = new MutationObserver(handleMutations);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['placeholder', 'aria-label', 'title'],
  });
}

function stopObserver(): void {
  if (frame) { cancelAnimationFrame(frame); frame = 0; }
  pendingRoots = null;
  observer?.disconnect();
  observer = null;
}

/** Flip the runtime layer. 'ar' restores originals and goes inert. */
export function setRuntimeLocale(locale: 'ar' | 'en'): void {
  if (typeof document === 'undefined' || !document.body) return;
  if (locale === 'en') {
    walk(document.body, 'en');
    startObserver();
  } else {
    stopObserver();
    walk(document.body, 'ar');
  }
}
