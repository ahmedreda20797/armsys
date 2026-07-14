'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Lock, Mail, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';

// Deterministic year — client-only to avoid hydration mismatch
function CopyrightYear() {
  const [year, setYear] = useState<number | null>(null);
  useEffect(() => setYear(new Date().getFullYear()), []);
  return <>{year ?? '2024'}</>;
}

/**
 * LoginPage — foreground only.
 * PersistentBackground is mounted once in AppShell above this.
 * No stars, no nebula, no background — shell provides all of that.
 */
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
    if (success) toast.success('تم تسجيل الدخول بنجاح!');
  };

  return (
    <motion.div
      className="fixed inset-0 z-20 flex items-center justify-center px-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
    >
      <div dir="rtl" className="w-full max-w-md">
        <motion.div
          className="relative rounded-2xl p-8 md:p-10 shadow-2xl backdrop-blur-2xl bg-white/[0.03] border border-white/[0.06] shadow-black/40"
          initial={{ scale: 0.92, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1, ease: [0.4, 0, 0.2, 1] }}
        >
          {/* Inner glow */}
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

          {/* Brand */}
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

          {/* Footer */}
          <p className="mt-6 text-center text-slate-500 text-xs">
            نظام إدارة الجودة © <CopyrightYear />
          </p>
        </motion.div>
      </div>
    </motion.div>
  );
}
