'use client';

import { motion } from 'framer-motion';

/**
 * LoadingOverlay — foreground only.
 * PersistentBackground is already mounted beneath this.
 * Contains: logo, spinner, message. Nothing else.
 */
export function LoadingOverlay() {
  return (
    <motion.div
      className="fixed inset-0 z-20 flex flex-col items-center justify-center gap-8"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
    >
      <motion.div
        className="relative w-40 h-40 flex items-center justify-center"
        animate={{ scale: [1, 1.06, 1], rotate: [0, 2, -2, 0] }}
        transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
      >
        <div
          className="absolute inset-0 -m-4 rounded-full blur-2xl"
          style={{
            background:
              'radial-gradient(circle, rgba(139,92,246,0.3) 0%, rgba(99,102,241,0.1) 50%, transparent 70%)',
          }}
        />
        <img
          src="/logo-letter-a.png"
          alt="ARM"
          className="relative w-36 h-36 object-contain drop-shadow-[0_0_60px_rgba(139,92,246,0.3)]"
        />
      </motion.div>

      <div className="relative w-16 h-16">
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
            animate={{
              x: [0, Math.cos((i * 120 * Math.PI) / 180) * 20, 0],
              y: [0, Math.sin((i * 120 * Math.PI) / 180) * 20, 0],
              opacity: [0.3, 1, 0.3],
            }}
            transition={{ duration: 1.5, repeat: Infinity, delay: i * 0.5, ease: 'easeInOut' }}
          >
            <div className="w-2.5 h-2.5 rounded-full bg-gradient-to-r from-violet-400 to-indigo-400 shadow-[0_0_8px_rgba(139,92,246,0.5)]" />
          </motion.div>
        ))}
      </div>

      <p className="text-slate-400 text-sm font-medium">جاري التحميل...</p>
    </motion.div>
  );
}
