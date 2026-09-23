'use client';

// src/lib/i18n/runtime-translator.ts
// ══════════════════════════════════════════════════════════════
//  §I18N-BOUNDARY — zone-scoped LEGACY translation layer.
//
//  HISTORY / WHY IT SHRANK: this layer used to walk the ENTIRE
//  document and translate every text node containing Arabic (exact +
//  bounded-phrase passes). That is global substring replacement over
//  arbitrary DOM content — it translated USER/BUSINESS DATA (employee
//  names «محمد» → «Mohamed», observation sentences partially rewritten)
//  and is forbidden by the Qnlys localization contract.
//
//  NOW: the layer is COMPLETELY INERT unless a region of the DOM is
//  EXPLICITLY claimed as application-owned UI with:
//
//      data-i18n="true"      ← application-owned UI zone (translatable)
//      data-i18n="false"     ← protected dynamic content (hard skip)
//      data-no-i18n          ← legacy alias of data-i18n="false"
//
//  Only text nodes and translatable attributes INSIDE a claimed zone
//  are processed — through the same engine as <T>/translateUIText
//  (./ui-text.ts). Unmarked DOM — where ALL business data lives — is
//  structurally unreachable. Zones must wrap pure UI and must never
//  wrap tables/lists/dialog bodies that render stored records; the
//  primary mechanism remains explicit source-level claims (<T>,
//  translateUIText, t()).
//
//  Mechanics (unchanged):
//    • locale 'ar' → the layer restores originals and goes inert.
//    • locale 'en' → one synchronous pass over each claimed zone,
//      then a MutationObserver translates only INCREMENTAL changes
//      whose nearest claimed zone exists, coalesced per frame.
//    • Originals are stashed ON the node for GC-friendly restore;
//      §RESTORE-TRUTH — a node React re-writes wins over the stash.
//    • Input VALUES are never touched (they are user data).
// ══════════════════════════════════════════════════════════════

import { translateUIText, hasArabic } from './ui-text';

const ZONE_SELECTOR = '[data-i18n="true"]';
const SKIP_SELECTOR = '[data-i18n="false"], [data-no-i18n]';
const TRANSLATED_ATTRS = ['placeholder', 'aria-label', 'title', 'alt'];

const ORIG_PROP = '__qnlysI18nOrig';
const EN_PROP = '__qnlysI18nEn';
const ATTR_ORIG_PROP = '__qnlysI18nAttrOrig';

function stashText(node: Text, original: string, translated: string): void {
  const w = node as unknown as Record<string, unknown>;
  // §RESTORE-TRUTH — the stash always mirrors what REACT last wrote:
  // a text node re-set by React (characterData) updates the stash, so
  // switching back to 'ar' restores the CURRENT Arabic, never a stale one.
  if (w[ORIG_PROP] !== original) w[ORIG_PROP] = original;
  w[EN_PROP] = translated;
}

function stashAttr(el: Element, name: string, original: string, translated: string): void {
  const w = el as unknown as Record<string, unknown>;
  const stash = (w[ATTR_ORIG_PROP] as Record<string, string> | undefined) ?? {};
  if (stash[name] === undefined || stash[name] !== original) stash[name] = original;
  w[ATTR_ORIG_PROP] = stash;
  const enStash = (w[EN_PROP] as Record<string, string> | undefined) ?? {};
  enStash[name] = translated;
  w[EN_PROP] = enStash;
}

function translateTextNode(node: Text): void {
  const raw = node.nodeValue ?? '';
  const next = translateUIText(raw);
  if (next === raw) return;
  stashText(node, raw, next);
  node.nodeValue = next;
}

function restoreTextNode(node: Text): void {
  const w = node as unknown as Record<string, unknown>;
  const orig = w[ORIG_PROP];
  const en = w[EN_PROP];
  if (typeof orig === 'string') {
    // §RESTORE-TRUTH — restore ONLY if nobody re-wrote the node while we
    // held it (React re-render with fresh text wins over our stash).
    if (typeof en !== 'string' || node.nodeValue === en) {
      node.nodeValue = orig;
    }
    delete w[ORIG_PROP];
  }
  delete w[EN_PROP];
}

function translateElementAttributes(el: Element): void {
  for (const name of TRANSLATED_ATTRS) {
    const value = el.getAttribute(name);
    if (!value) continue;
    const next = translateUIText(value);
    if (next === value) continue;
    stashAttr(el, name, value, next);
    el.setAttribute(name, next);
  }
}

function restoreElementAttributes(el: Element): void {
  const w = el as unknown as Record<string, unknown>;
  const stash = w[ATTR_ORIG_PROP] as Record<string, string> | undefined;
  if (!stash) return;
  const enStash = w[EN_PROP] as Record<string, string> | undefined;
  for (const [name, value] of Object.entries(stash)) {
    const translated = enStash?.[name];
    // §RESTORE-TRUTH (attributes) — same contract as text nodes.
    if (translated === undefined || el.getAttribute(name) === translated) {
      el.setAttribute(name, value);
    }
  }
  delete w[ATTR_ORIG_PROP];
  delete w[EN_PROP];
}

/** Is `el` (inclusive) or one of its ancestors below the zone boundary protected dynamic content? */
function insideSkip(el: Element | null, stopAtExcluding: Element | null): boolean {
  for (let cur = el; cur && cur !== stopAtExcluding; cur = cur.parentElement) {
    if (cur.matches(SKIP_SELECTOR)) return true;
  }
  return false;
}

/**
 * Walk ONE claimed zone (`root` must be a data-i18n="true" element).
 *  'en' mode → visit text nodes + every element (attrs), rejecting
 *              data-i18n="false" / data-no-i18n subtrees.
 *  'ar' mode → visit nodes/elements carrying a stash and restore.
 */
function walk(root: ParentNode, mode: 'en' | 'ar'): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      if (node instanceof Element) {
        if (node.matches(SKIP_SELECTOR)) return NodeFilter.FILTER_REJECT;
        if (mode === 'ar') {
          return node[ATTR_ORIG_PROP] !== undefined
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_SKIP;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
      if (mode === 'en') {
        return node.nodeValue && hasArabic(node.nodeValue)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_SKIP;
      }
      return node[ORIG_PROP] !== undefined
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

/** All claimed zones under/including `root` (for incremental walks). */
function zonesWithin(root: Element): Element[] {
  const zones: Element[] = [];
  if (root.matches(ZONE_SELECTOR)) zones.push(root);
  zones.push(...root.querySelectorAll(ZONE_SELECTOR));
  return zones;
}

// ── Observer lifecycle ─────────────────────────────────────────

let observer: MutationObserver | null = null;
let pendingRoots: Set<Node> | null = null;
let frame = 0;

/**
 * Nearest claimed zone for a mutated node, or null when the change is
 * NOT application-owned UI. A node is in scope when it (or its parent)
 * sits inside a data-i18n="true" element AND is not itself inside a
 * data-i18n="false" / data-no-i18n subtree below that zone.
 */
function zoneFor(node: Node): Element | null {
  const el = node instanceof Element ? node : node.parentElement;
  if (!el) return null;
  const zone = el.closest(ZONE_SELECTOR);
  if (!zone) return null;
  // Protected content between the node and its zone wins.
  if (insideSkip(el, zone.parentElement)) return null;
  return zone;
}

function flushRoots(): void {
  frame = 0;
  const roots = pendingRoots;
  pendingRoots = null;
  if (!roots) return;
  for (const node of roots) {
    if (node.nodeType === Node.TEXT_NODE) {
      // Direct text change inside a claimed zone (characterData or an
      // added text node) — translate just this node.
      translateTextNode(node as Text);
      continue;
    }
    const el = node as Element;
    if (el.matches(SKIP_SELECTOR)) continue;
    if (el.matches(ZONE_SELECTOR)) {
      translateElementAttributes(el);
      walk(el, 'en');
      continue;
    }
    const zone = el.closest(ZONE_SELECTOR);
    if (zone) {
      // Incremental change inside an existing zone: the added subtree
      // is zone content — walk it (walk() rejects protected subtrees).
      translateElementAttributes(el);
      walk(el, 'en');
      continue;
    }
    // A newly mounted subtree may CONTAIN claimed zones.
    for (const z of zonesWithin(el)) {
      translateElementAttributes(z);
      walk(z, 'en');
    }
  }
}

function handleMutations(mutations: MutationRecord[]): void {
  if (!observer) return;
  for (const m of mutations) {
    if (m.type === 'childList') {
      for (const node of m.addedNodes) {
        if (node.nodeType !== Node.TEXT_NODE && node.nodeType !== Node.ELEMENT_NODE) continue;
        if (!zoneFor(node)) continue;
        pendingRoots ??= new Set<Node>();
        pendingRoots.add(node);
      }
    } else if (m.type === 'characterData') {
      // §CHAR-DATA — React updates text nodes IN PLACE (node.nodeValue =
      // …), which is a characterData mutation, never childList.
      const t = m.target as Text;
      if (zoneFor(t)) {
        pendingRoots ??= new Set<Node>();
        pendingRoots.add(t);
      }
    } else if (m.type === 'attributes') {
      const el = m.target as Element;
      if (zoneFor(el) && TRANSLATED_ATTRS.includes(m.attributeName ?? '')) {
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
    characterData: true,
    attributes: true,
    attributeFilter: TRANSLATED_ATTRS,
  });
}

function stopObserver(): void {
  if (frame) { cancelAnimationFrame(frame); frame = 0; }
  pendingRoots = null;
  observer?.disconnect();
  observer = null;
}

/**
 * Flip the runtime layer. 'ar' restores claimed-zone originals and goes
 * inert. With no data-i18n="true" zones in the document this layer does
 * NOTHING in either locale — user/business data can never be reached.
 */
export function setRuntimeLocale(locale: 'ar' | 'en'): void {
  if (typeof document === 'undefined' || !document.body) return;
  const zones = document.body.querySelectorAll(ZONE_SELECTOR);
  if (locale === 'en') {
    for (const zone of zones) walk(zone, 'en');
    startObserver();
  } else {
    stopObserver();
    for (const zone of zones) walk(zone, 'ar');
  }
}
