// src/lib/__tests__/i18n-boundary.test.ts
// ══════════════════════════════════════════════════════════════
//  §I18N-BOUNDARY — the Qnlys localization contract, enforced:
//
//    UI labels (claimed)   → translate
//    business/user data    → PRESERVE, always, in both locales
//
//  The historic bug: the runtime layer scanned the ENTIRE document and
//  phrase-translated any Arabic text node — corrupting stored names
//  («محمد» → «Mohamed») and partially rewriting observation sentences.
//  These tests pin the structural guarantee that user data can never
//  re-enter the translation pipeline.
// ══════════════════════════════════════════════════════════════

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { EN_MAP } from '../i18n/en-map';
import { translateUIText, hasArabic } from '../i18n/ui-text';
import { setDisplayLocale } from '../i18n/format';
import { setRuntimeLocale } from '../i18n/runtime-translator';

// ── Acceptance data (milestone §22) ────────────────────────────
const STORED_NAME = 'محمد';
const STORED_NAME_2 = 'أحمد';
const STORED_SENTENCE = 'تم التواصل مع العميل محمد وسيتم المتابعة غداً';
const STORED_TEAM = "Mostafa's Sales Team";
const STORED_ID = 'EMP-067';
const UI_BUTTON = 'طباعة'; // claimed UI → "Print"

describe('§I18N-BOUNDARY engine purity (translateUIText)', () => {
  it('is identity in the Arabic locale (Arabic is the source language)', () => {
    assert.equal(translateUIText(UI_BUTTON, 'ar'), UI_BUTTON);
  });

  it('translates a claimed UI label in English', () => {
    assert.equal(translateUIText(UI_BUTTON, 'en'), 'Print');
  });

  it('NEVER carries personal-name keys — a name passes through unchanged even if claimed', () => {
    // The boundary is structural, not a blacklist: names were REMOVED
    // from the map, so even a mis-claimed name cannot be rewritten.
    assert.equal(translateUIText(STORED_NAME, 'en'), STORED_NAME);
    assert.equal(translateUIText(STORED_NAME_2, 'en'), STORED_NAME_2);
  });

  it('leaves Latin identifiers and stored team names untouched', () => {
    assert.equal(translateUIText(STORED_ID, 'en'), STORED_ID);
    assert.equal(translateUIText(STORED_TEAM, 'en'), STORED_TEAM);
  });

  it('leaves unmapped claimed strings unchanged (no invented translations)', () => {
    const unmapped = 'زقزقية بندورية منتاشقة'; // fabricated words — no dictionary hits
    assert.equal(translateUIText(unmapped, 'en'), unmapped);
  });

  it('hasArabic gates the engine', () => {
    assert.equal(hasArabic(STORED_NAME), true);
    assert.equal(hasArabic(STORED_ID), false);
  });
});

describe('§I18N-BOUNDARY map hygiene', () => {
  it('EN_MAP contains no personal-name keys (common first names)', () => {
    const forbidden = ['محمد', 'أحمد', 'احمد', 'مصطفى', 'مصطفي', 'سارة', 'علي', 'حسن', 'حسين', 'خالد', 'عمر', 'يوسف'];
    for (const name of forbidden) {
      assert.ok(!(name in EN_MAP), `personal name must never be a translation key: ${name}`);
    }
  });

  it('every EN_MAP value is non-empty', () => {
    for (const [ar, en] of Object.entries(EN_MAP)) {
      assert.ok(typeof en === 'string' && en.trim().length > 0, `empty EN for key ${ar}`);
    }
  });
});

// ── Runtime layer: zone-scoped DOM contract ────────────────────
//
// Minimal DOM stub — just the surface runtime-translator.ts touches.
// The money test: switching to EN must translate CLAIMED UI zones and
// leave everything else (a stored name, a stored observation sentence)
// byte-identical.

interface FakeNode {
  nodeType: number;
  nodeValue?: string;
  children?: FakeNode[];
  parentElement?: FakeNode | null;
  attrs?: Map<string, string>;
  nodeValue_set?: (v: string) => void;
}

let textOf: (n: FakeNode) => string;
let el: (tag: string, attrs: Record<string, string>, ...children: FakeNode[]) => FakeNode;
let txt: (value: string) => FakeNode;

function makeDomHelpers() {
  class FakeElement {
    nodeType = 1;
    attrs: Map<string, string>;
    children: FakeNode[];
    parentElement: FakeNode | null = null;
    constructor(attrs: Record<string, string>, children: FakeNode[]) {
      this.attrs = new Map(Object.entries(attrs));
      this.children = children;
    }
    getAttribute(name: string) { return this.attrs.has(name) ? this.attrs.get(name)! : null; }
    setAttribute(name: string, value: string) { this.attrs.set(name, value); }
    hasAttribute(name: string) { return this.attrs.has(name); }
    matches(selector: string) {
      if (selector.includes('[data-i18n="false"]') && this.attrs.get('data-i18n') === 'false') return true;
      if (selector.includes('[data-no-i18n]') && this.attrs.has('data-no-i18n')) return true;
      if (selector.includes('[data-i18n="true"]') && this.attrs.get('data-i18n') === 'true') return true;
      return false;
    }
    closest(selector: string): FakeNode | null {
      let cur: FakeNode | null = this;
      while (cur) {
        if (cur.nodeType === 1 && (cur as FakeElement).matches(selector)) return cur;
        cur = cur.parentElement ?? null;
      }
      return null;
    }
    querySelectorAll(selector: string) {
      const out: FakeNode[] = [];
      const visit = (n: FakeNode) => {
        for (const c of n.children ?? []) {
          if (c.nodeType === 1) {
            if ((c as FakeElement).matches(selector)) out.push(c);
            visit(c);
          }
        }
      };
      visit(this);
      return out;
    }
  }
  class FakeText {
    nodeType = 3;
    nodeValue: string;
    children: FakeNode[] = [];
    parentElement: FakeNode | null = null;
    constructor(value: string) { this.nodeValue = value; }
  }

  el = (tag, attrs, ...children) => new FakeElement(attrs, children) as unknown as FakeNode;
  txt = (value) => new FakeText(value) as unknown as FakeNode;
  textOf = (n) => (n.nodeType === 3 ? (n.nodeValue ?? '') : (n.children ?? []).map(textOf).join(''));
  // link parents
  const link = (n: FakeNode) => {
    for (const c of n.children ?? []) {
      c.parentElement = n;
      link(c);
    }
  };
  return { el, txt, textOf, link, FakeElement, FakeText };
}

function installDomStubs() {
  const { el, txt, textOf, link, FakeElement, FakeText } = makeDomHelpers();

  class FakeTreeWalker {
    private flat: FakeNode[] = [];
    private idx = 0;
    constructor(root: FakeNode, filter: { acceptNode: (n: FakeNode) => number }) {
      const FILTER = { ACCEPT: 1, REJECT: 2, SKIP: 3 } as const;
      const visit = (n: FakeNode) => {
        for (const c of n.children ?? []) {
          const verdict = filter.acceptNode(c);
          if (verdict === FILTER.REJECT) continue; // skip whole subtree
          if (verdict === FILTER.ACCEPT) this.flat.push(c);
          visit(c); // ACCEPT and SKIP both descend
        }
      };
      visit(root);
    }
    nextNode(): FakeNode | null {
      return this.idx < this.flat.length ? this.flat[this.idx++] : null;
    }
  }

  (globalThis as Record<string, unknown>).Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };
  (globalThis as Record<string, unknown>).NodeFilter = { SHOW_TEXT: 4, SHOW_ELEMENT: 2, FILTER_ACCEPT: 1, FILTER_REJECT: 2, FILTER_SKIP: 3 };
  (globalThis as Record<string, unknown>).Element = FakeElement;
  (globalThis as Record<string, unknown>).Text = FakeText;
  (globalThis as Record<string, unknown>).MutationObserver = class { observe() {} disconnect() {} };
  (globalThis as Record<string, unknown>).requestAnimationFrame = (cb: FrameRequestCallback) => { cb(0); return 0; };
  (globalThis as Record<string, unknown>).cancelAnimationFrame = () => {};

  // The document under test:
  //   zone (data-i18n="true")
  //     ├─ <button>طباعة</button>                     → claimed UI → "Print"
  //     ├─ <div data-i18n="false">مغلق</div>          → protected → untouched
  //     └─ <button>محمد</button>                      → name inside a UI zone — no key → untouched
  //   outside any zone:
  //     ├─ <div>محمد</div>                            → stored name → untouched
  //     └─ <div>تم التواصل مع العميل محمد …</div>     → stored free text → untouched
  const zoneButton = txt(UI_BUTTON);
  const protectedValue = txt('مغلق'); // «مغلق» IS an EN_MAP key ('Closed') — must stay
  const nameInZone = txt(STORED_NAME);
  const nameOutside = txt(STORED_NAME);
  const sentenceOutside = txt(STORED_SENTENCE);

  const zone = el('section', { 'data-i18n': 'true' },
    el('button', {}, zoneButton),
    el('div', { 'data-i18n': 'false' }, protectedValue),
    el('button', {}, nameInZone),
  );
  const plainName = el('div', {}, nameOutside);
  const plainSentence = el('div', {}, sentenceOutside);
  const body = el('body', {}, zone, plainName, plainSentence);
  link(body);

  (globalThis as Record<string, unknown>).document = {
    body,
    createTreeWalker: (root: FakeNode, _what: number, filter: { acceptNode: (n: FakeNode) => number }) =>
      new FakeTreeWalker(root, filter),
  };

  return {
    buttonNode: zoneButton,
    protectedNode: protectedValue,
    nameInZoneNode: nameInZone,
    nameOutsideNode: nameOutside,
    sentenceOutsideNode: sentenceOutside,
    textOf,
  };
}

describe('§I18N-BOUNDARY runtime layer is zone-scoped', () => {
  const dom = {} as ReturnType<typeof installDomStubs>;

  before(() => {
    Object.assign(dom, installDomStubs());
  });

  it('EN mode translates claimed zones and leaves ALL business data byte-identical', () => {
    setDisplayLocale('en');
    setRuntimeLocale('en');

    // A. claimed UI label translates
    assert.equal(dom.textOf(dom.buttonNode), 'Print');
    // C/H. stored free text — UNTOUCHED (the historic corruption)
    assert.equal(dom.textOf(dom.sentenceOutsideNode), STORED_SENTENCE);
    // A. stored name outside any zone — UNTOUCHED
    assert.equal(dom.textOf(dom.nameOutsideNode), STORED_NAME);
    // A. a name inside a claimed zone is STILL untouched (purged from map)
    assert.equal(dom.textOf(dom.nameInZoneNode), STORED_NAME);
    // data-i18n="false" inside a zone — protected even though «مغلق» is a key
    assert.equal(dom.textOf(dom.protectedNode), 'مغلق');
  });

  it('AR mode restores claimed-zone originals exactly', () => {
    setRuntimeLocale('ar');
    assert.equal(dom.textOf(dom.buttonNode), UI_BUTTON);
    assert.equal(dom.textOf(dom.sentenceOutsideNode), STORED_SENTENCE);
    assert.equal(dom.textOf(dom.nameOutsideNode), STORED_NAME);
  });
});

describe('§I18N-BOUNDARY source contract', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, '../i18n/runtime-translator.ts'), 'utf8');

  it('the runtime layer never walks the document body wholesale', () => {
    assert.ok(!src.includes('walk(document.body'), 'global DOM scanning must stay removed');
    assert.ok(src.includes('[data-i18n="true"]'), 'zone selector contract missing');
  });

  it('the claim mechanisms exist and reference the same engine', () => {
    const t = readFileSync(join(here, '../i18n/T.tsx'), 'utf8');
    assert.ok(t.includes('translateUIText'), '<T> must route through the boundary engine');
  });
});
