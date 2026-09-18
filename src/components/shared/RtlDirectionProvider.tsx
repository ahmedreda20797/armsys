'use client';

// ══════════════════════════════════════════════════════════════
//  RtlDirectionProvider — teaches every Radix primitive the app's
//  CURRENT direction (§20.1 bilingual).
//
//  Radix (dropdown menus, selects, dialogs, popovers) reads direction
//  ONLY from its own DirectionProvider context — it never inspects
//  document.dir. This provider FOLLOWS the <html dir> attribute set
//  by the LanguageProvider (§20.1): switching Arabic ⇄ English flips
//  every menu/dialog/popover side automatically, with no coupling to
//  provider nesting order.
// ══════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';
import { DirectionProvider } from '@radix-ui/react-direction';

type Dir = 'rtl' | 'ltr';

export function RtlDirectionProvider({ children }: { children: React.ReactNode }) {
  const [dir, setDir] = useState<Dir>('rtl');

  // External-system sync: <html dir> is written by the LanguageProvider;
  // this observer mirrors it into the Radix direction context.
  useEffect(() => {
    const apply = () => {
      const current = document.documentElement.getAttribute('dir');
      if (current === 'rtl' || current === 'ltr') {
        setDir((prev) => (prev === current ? prev : current));
      }
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['dir'] });
    return () => observer.disconnect();
  }, []);

  return <DirectionProvider dir={dir}>{children}</DirectionProvider>;
}
