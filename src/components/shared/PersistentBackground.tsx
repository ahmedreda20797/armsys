'use client';

import { memo } from 'react';

/**
 * PersistentBackground — renders once, never unmounts.
 * Shared between loading screen, login page, and app shell.
 *
 * §LIGHT-THEME — the decorative canvas is THEME-DRIVEN: the base, the
 * two brand glows, the top sheen and the vignette are CSS classes
 * (qnlys-bg-*) whose values live in globals.css (dark identity by
 * default, refined under html.light so the paper page stays quiet and
 * the glows never compete with content). No inline styles — CSS is
 * the single theming authority.
 *
 * Qnlys visual identity: deep charcoal foundation (dark) / near-white
 * (light) with two very restrained brand-red glows. Static by design;
 * zero hydration risk and zero runtime animation cost.
 */
export const PersistentBackground = memo(function PersistentBackground() {
  return (
    <div
      className="print-never fixed inset-0 overflow-hidden pointer-events-none"
      style={{ zIndex: 0 }}
      aria-hidden="true"
    >
      {/* Foundation — charcoal (dark) / near-white (light) */}
      <div className="qnlys-bg-base absolute inset-0" />

      {/* Subtle brand-red glow — top corner, near the brand mark side */}
      <div className="qnlys-bg-glow-a absolute -top-40 -right-40 h-[620px] w-[620px] rounded-full" />

      {/* Cooler charcoal glow — bottom, keeps the surface from feeling flat */}
      <div className="qnlys-bg-glow-b absolute -bottom-52 -left-40 h-[680px] w-[680px] rounded-full" />

      {/* Soft top sheen for depth */}
      <div className="qnlys-bg-sheen absolute inset-x-0 top-0 h-64" />

      {/* Vignette — focuses attention on content */}
      <div className="qnlys-bg-vignette absolute inset-0" />
    </div>
  );
});
