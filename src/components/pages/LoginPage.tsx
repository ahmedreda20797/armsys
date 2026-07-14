'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Lock, Mail, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import { PersistentBackground } from '@/components/shared/PersistentBackground';

// ── Deterministic year — rendered only on client to avoid mismatch ──
function CopyrightYear() {
  const [year, setYear] = useState<number | null>(null);
  useEffect(() => setYear(new Date().getFullYear()), []);
  return <>{year ?? '2024'}</>;
}

// ═══ Cosmic loading screen — reuses PersistentBackground ═══
export function CosmicLoadingScreen() {
  return (
    <div className="min-h-screen w-full relative overflow-hidden">
      <PersistentBackground />
      <div className="relative z-10 flex flex-col items-center justify-center min-h-screen gap-8 px-4">
        {/* Logo with cosmic glow */}
        <motion.div
          className="relative"
          animate={{ scale: [1, 1.06, 1], rotate: [0, 2, -2, 0] }}
          transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
        >
          <div className="absolute inset-0 -m-8">
            <motion.div
              className="absolute inset-0 rounded-full opacity-20"
              style={{
                background:
                  'conic-gradient(from 0deg, transparent, rgba(139,92,246,0.5), transparent, rgba(99,102,241,0.5), transparent)',
              }}
              animate={{ rotate: 360 }}
              transition={{ duration: 8, repeat: Infinity, ease: 'linear' }}
            />
          </div>
          <div
            className="absolute inset-0 -m-4 rounded-full blur-2xl"
            style={{
              background:
                'radial-gradient(circle, rgba(139,92,246,0.3) 0%, rgba(99,102,241,0.1) 50%, transparent 70%)',
            }}
          />
          <div className="relative w-40 h-40 flex items-center justify-center">
            <img
              src="/logo-letter-a.png"
              alt="ARM"
              className="w-36 h-36 object-contain drop-shadow-[0_0_60px_rgba(139,92,246,0.3)]"
            />
          </div>
        </motion.div>

        {/* Orbital loading dots — deterministic positions */}
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
              transition={{
                duration: 1.5,
                repeat: Infinity,
                delay: i * 0.5,
                ease: 'easeInOut',
              }}
            >
              <div className="w-2.5 h-2.5 rounded-full bg-gradient-to-r from-violet-400 to-indigo-400 shadow-[0_0_8px_rgba(139,92,246,0.5)]" />
            </motion.div>
          ))}
        </div>

        <p className="text-slate-400 text-sm font-medium">جاري التحميل...</p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  const { login, error, loading, clearError } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [localLoading, setLocalLoading] = useState(false);

  useEffect(() => {
    if (error) clearError();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email, password]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalLoading(true);
    const success = await login(email, password);
    setLocalLoading(false);
    if (success) {
      toast.success('تم تسجيل الدخول بنجاح!');
    }
  };

  return (
    <div className="min-h-screen w-full relative overflow-hidden">
      {/* Shared background — no duplicate DOM */}
      <PersistentBackground />

      <motion.div
        className="relative z-10 flex items-center justify-center min-h-screen px-4"
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
      >
        <div dir="rtl" className="w-full max-w-md">
          <motion.div
            className="relative rounded-2xl p-8 md:p-10 shadow-2xl backdrop-blur-2xl bg-white/[0.03] border border-white/[0.06] shadow-black/40"
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1, ease: [0.4, 0, 0.2, 1] }}
          >
            {/* Subtle inner glow */}
            <div
              className="absolute inset-0 rounded-2xl pointer-events-none"
              style={{
                background:
                  'radial-gradient(ellipse at top, rgba(139,92,246,0.08), transparent 50%), radial-gradient(ellipse at bottom, rgba(99,102,241,0.05), transparent 50%)',
              }}
            />
            <div
              className="absolute -inset-px rounded-2xl pointer-events-none"
              style={{
                background:
                  'linear-gradient(135deg, rgba(139,92,246,0.15), transparent 40%, transparent 60%, rgba(99,102,241,0.1))',
              }}
            />

            {/* Logo */}
            <div className="flex justify-center mb-6">
              <motion.div
                animate={{ y: [0, -4, 0] }}
                transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
              >
                <img
                  src="/logo-full-clean.png"
                  alt="ARM Logo"
                  className="h-24 w-auto object-contain drop-shadow-[0_0_30px_rgba(139,92,246,0.25)]"
                />
              </motion.div>
            </div>

            <h1 className="text-2xl font-bold text-white text-center mb-2">تسجيل الدخول</h1>
            <p className="text-slate-400 text-center text-sm mb-8">أدخل بياناتك للوصول إلى النظام</p>

            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm text-center"
                >
                  {error}
                </motion.div>
              )}
            </AnimatePresence>

            <form onSubmit={handleLogin} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-slate-300 text-sm">
                  البريد الإلكتروني
                </Label>
                <div className="relative">
                  <Mail className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="user@arm.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="bg-white/[0.04] border-white/[0.08] text-white placeholder:text-slate-500 pr-10 focus:border-violet-500/50 focus:ring-violet-500/20"
                    required
                    dir="ltr"
                    autoComplete="email"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-slate-300 text-sm">
                  كلمة المرور
                </Label>
                <div className="relative">
                  <Lock className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="bg-white/[0.04] border-white/[0.08] text-white placeholder:text-slate-500 pr-10 pl-10 focus:border-violet-500/50 focus:ring-violet-500/20"
                    required
                    dir="ltr"
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-300 transition-colors"
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                disabled={localLoading || loading}
                className="w-full h-11 bg-linear-to-l from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white font-semibold text-base rounded-xl transition-all duration-300 shadow-lg shadow-violet-500/25 hover:shadow-violet-500/40 disabled:opacity-60"
              >
                {localLoading || loading ? (
                  <>
                    <motion.div
                      className="size-4 border-2 border-white/30 border-t-white rounded-full"
                      animate={{ rotate: 360 }}
                      transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
                    />
                    <span>جاري تسجيل الدخول...</span>
                  </>
                ) : (
                  'تسجيل الدخول'
                )}
              </Button>
            </form>

            <p className="mt-6 text-center text-slate-500 text-xs">
              نظام إدارة الجودة © <CopyrightYear />
            </p>
          </motion.div>
        </div>
      </motion.div>
    </div>
  );
}
