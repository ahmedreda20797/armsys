'use client';

import { memo } from 'react';
import { motion } from 'framer-motion';
import { deterministicArray } from '@/lib/ssr-utils';

// ── Deterministic star data (seed=1) — identical on SSR and client ──
const STARS = deterministicArray(120, 1, (rand, i) => ({
  id: i,
  x: rand() * 100,
  y: rand() * 100,
  size: rand() * 2.5 + 0.3,
  duration: rand() * 4 + 3,
  delay: rand() * 5,
  opacity: rand() * 0.7 + 0.15,
}));

// ── Deterministic particle data (seed=2) ──
const PARTICLES = deterministicArray(8, 2, (rand, i) => ({
  id: i,
  x: rand() * 100,
  y: rand() * 100,
  size: rand() * 60 + 20,
  duration: rand() * 20 + 15,
  delay: rand() * 10,
  drift: rand() * 30 + 10,
  hue: rand() > 0.5 ? 'violet' : 'indigo',
}));

/**
 * PersistentBackground — renders once, never unmounts.
 * Shared between loading screen, login page, and app shell.
 * All values are deterministic — zero hydration mismatch.
 */
export const PersistentBackground = memo(function PersistentBackground() {
  return (
    <div
      className="fixed inset-0 overflow-hidden pointer-events-none"
      style={{ zIndex: 0 }}
      aria-hidden="true"
    >
      {/* Base colour */}
      <div className="absolute inset-0 bg-[#050816]" />

      {/* Stars */}
      {STARS.map((star) => (
        <motion.div
          key={star.id}
          className="absolute rounded-full bg-white"
          style={{
            left: `${star.x}%`,
            top: `${star.y}%`,
            width: `${star.size}px`,
            height: `${star.size}px`,
          }}
          animate={{
            opacity: [star.opacity * 0.3, star.opacity, star.opacity * 0.3],
            scale: [0.8, 1, 0.8],
          }}
          transition={{
            duration: star.duration,
            repeat: Infinity,
            delay: star.delay,
            ease: 'easeInOut',
          }}
        />
      ))}

      {/* Floating particles */}
      {PARTICLES.map((p) => (
        <motion.div
          key={p.id}
          className="absolute rounded-full blur-3xl"
          style={{
            left: `${p.x}%`,
            top: `${p.y}%`,
            width: `${p.size}px`,
            height: `${p.size}px`,
            opacity: 0.04,
            background:
              p.hue === 'violet'
                ? 'radial-gradient(circle, rgba(139,92,246,0.5) 0%, rgba(88,28,135,0.2) 40%, transparent 70%)'
                : 'radial-gradient(circle, rgba(99,102,241,0.5) 0%, rgba(67,56,202,0.2) 40%, transparent 70%)',
          }}
          animate={{
            x: [0, p.drift, -p.drift * 0.5, 0],
            y: [-p.drift * 0.3, p.drift * 0.5, -p.drift * 0.3, 0],
            scale: [1, 1.3, 0.9, 1],
          }}
          transition={{
            duration: p.duration,
            repeat: Infinity,
            delay: p.delay,
            ease: 'easeInOut',
          }}
        />
      ))}

      {/* Nebula clouds */}
      <motion.div
        className="absolute -top-32 -right-32 w-[500px] h-[500px] rounded-full opacity-20"
        style={{ background: 'radial-gradient(circle, rgba(139,92,246,0.4) 0%, rgba(88,28,135,0.15) 40%, transparent 70%)' }}
        animate={{ scale: [1, 1.15, 1], rotate: [0, 5, 0] }}
        transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute -bottom-48 -left-48 w-[600px] h-[600px] rounded-full opacity-[0.15]"
        style={{ background: 'radial-gradient(circle, rgba(99,102,241,0.35) 0%, rgba(67,56,202,0.1) 45%, transparent 70%)' }}
        animate={{ scale: [1, 1.1, 1], rotate: [0, -3, 0] }}
        transition={{ duration: 15, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute top-1/3 left-1/3 w-[400px] h-[400px] rounded-full opacity-10"
        style={{ background: 'radial-gradient(circle, rgba(6,182,212,0.3) 0%, rgba(8,145,178,0.08) 50%, transparent 70%)' }}
        animate={{ scale: [1, 1.2, 1] }}
        transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute top-10 left-10 w-[300px] h-[300px] rounded-full opacity-[0.08]"
        style={{ background: 'radial-gradient(circle, rgba(236,72,153,0.2) 0%, transparent 70%)' }}
        animate={{ scale: [1, 1.08, 1] }}
        transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute top-1/2 -translate-y-1/2 -left-20 w-[calc(100%+80px)] h-[300px] rounded-full opacity-[0.06]"
        style={{ background: 'radial-gradient(ellipse, rgba(30,58,138,0.6) 0%, transparent 70%)' }}
        animate={{ scale: [1, 1.05, 1], x: [0, 20, 0] }}
        transition={{ duration: 20, repeat: Infinity, ease: 'easeInOut' }}
      />

      {/* Shooting stars */}
      <motion.div
        className="absolute top-[15%] right-[60%] w-px h-16 origin-top"
        style={{ background: 'linear-gradient(to bottom, rgba(255,255,255,0.7), transparent)' }}
        animate={{ opacity: [0, 1, 0], y: [0, 120] }}
        transition={{ duration: 2.5, repeat: Infinity, repeatDelay: 6, ease: 'easeOut' }}
      />
      <motion.div
        className="absolute top-[35%] right-[20%] w-px h-20 origin-top"
        style={{ background: 'linear-gradient(to bottom, rgba(139,92,246,0.6), transparent)' }}
        animate={{ opacity: [0, 0.8, 0], y: [0, 150] }}
        transition={{ duration: 3, repeat: Infinity, repeatDelay: 9, ease: 'easeOut' }}
      />
      <motion.div
        className="absolute top-[60%] right-[70%] w-px h-12 origin-top"
        style={{ background: 'linear-gradient(to bottom, rgba(99,102,241,0.5), transparent)' }}
        animate={{ opacity: [0, 0.7, 0], y: [0, 100] }}
        transition={{ duration: 2, repeat: Infinity, repeatDelay: 12, ease: 'easeOut' }}
      />

      {/* Sci-fi grid */}
      <div
        className="absolute bottom-0 left-0 right-0 h-[40%] opacity-[0.03]"
        style={{
          backgroundImage: `
            linear-gradient(to right, rgba(139,92,246,0.4) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(139,92,246,0.4) 1px, transparent 1px)
          `,
          backgroundSize: '60px 60px',
          transform: 'perspective(500px) rotateX(40deg)',
          transformOrigin: 'bottom center',
        }}
      />
    </div>
  );
});
