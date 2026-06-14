'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Lock, Mail, Eye, EyeOff, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

const FULL_TEXT = 'نظام إدارة الجودة ARM';

export default function LoginPage() {
  const { login, error, loading, clearError } = useAuth();
  const [splashDone, setSplashDone] = useState(false);
  const [typedText, setTypedText] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [localLoading, setLocalLoading] = useState(false);
  const charIndex = useRef(0);
  const typingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Clear error when user types
  useEffect(() => {
    if (error) clearError();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email, password]);

  useEffect(() => {
    typingRef.current = setInterval(() => {
      if (charIndex.current <= FULL_TEXT.length) {
        setTypedText(FULL_TEXT.slice(0, charIndex.current));
        charIndex.current++;
      } else {
        if (typingRef.current) clearInterval(typingRef.current);
        const timeout = setTimeout(() => setSplashDone(true), 800);
        return () => clearTimeout(timeout);
      }
    }, 100);
    return () => {
      if (typingRef.current) clearInterval(typingRef.current);
    };
  }, []);

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
    <div className="min-h-screen w-full relative overflow-hidden bg-linear-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* Animated background orbs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <motion.div
          className="absolute top-1/4 right-1/4 w-96 h-96 rounded-full bg-emerald-500/10 blur-3xl"
          animate={{ x: [0, 40, 0], y: [0, -30, 0] }}
          transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute bottom-1/4 left-1/4 w-80 h-80 rounded-full bg-teal-500/10 blur-3xl"
          animate={{ x: [0, -30, 0], y: [0, 40, 0] }}
          transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute top-1/2 left-1/2 w-64 h-64 rounded-full bg-cyan-500/8 blur-3xl"
          animate={{ scale: [1, 1.2, 1] }}
          transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>

      {/* Floating particles */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="floating-particle" style={{ bottom: '10%', left: '10%' }} />
        <div className="floating-particle" style={{ bottom: '20%', left: '80%' }} />
        <div className="floating-particle" style={{ bottom: '30%', left: '50%' }} />
        <div className="floating-particle" style={{ bottom: '5%', left: '30%' }} />
        <div className="floating-particle" style={{ bottom: '15%', left: '70%' }} />
        <div className="floating-particle" style={{ bottom: '25%', left: '90%' }} />
        <div className="floating-particle" style={{ bottom: '8%', left: '45%' }} />
        <div className="floating-particle" style={{ bottom: '35%', left: '60%' }} />
      </div>

      <AnimatePresence mode="wait">
        {!splashDone ? (
          <motion.div
            key="splash"
            className="flex flex-col items-center justify-center min-h-screen gap-8 px-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.5 }}
          >
            {/* Logo with pulse - 3D Letter A for loading */}
            <motion.div
              className="relative"
              animate={{ scale: [1, 1.08, 1], rotate: [0, 3, -3, 0] }}
              transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
            >
              <div className="absolute inset-0 rounded-full bg-linear-to-r from-cyan-500/30 to-purple-500/30 blur-3xl scale-150" />
              <div className="relative w-40 h-40 flex items-center justify-center">
                <img
                  src="/logo-letter-a.png"
                  alt="ARM"
                  className="w-36 h-36 object-contain drop-shadow-[0_0_40px_rgba(99,102,241,0.4)]"
                />
              </div>
            </motion.div>

            {/* Typing animation */}
            <div className="text-center">
              <h1 className="text-3xl md:text-4xl font-bold text-white leading-relaxed">
                {typedText}
                <motion.span
                  className="inline-block w-0.5 h-8 bg-indigo-400 mr-1 align-middle"
                  animate={{ opacity: [1, 0] }}
                  transition={{ duration: 0.6, repeat: Infinity }}
                />
              </h1>
            </div>

            {/* Loading dots */}
            <motion.div className="flex gap-2">
              {[0, 1, 2].map((i) => (
                <motion.div
                  key={i}
                  className="w-2.5 h-2.5 rounded-full bg-linear-to-r from-blue-400 to-purple-400"
                  animate={{ y: [0, -8, 0] }}
                  transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.15 }}
                />
              ))}
            </motion.div>
          </motion.div>
        ) : (
          <motion.div
            key="login"
            className="flex items-center justify-center min-h-screen px-4"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
          >
            {/* Glass card */}
            <div dir="rtl" className="w-full max-w-md">
              <motion.div
                className="relative rounded-2xl p-8 md:p-10 shadow-2xl backdrop-blur-2xl bg-white/6 border border-white/8 shadow-black/30"
                initial={{ scale: 0.9, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.1, ease: [0.4, 0, 0.2, 1] }}
              >
                {/* Subtle inner glow */}
                <div className="absolute inset-0 rounded-2xl bg-linear-to-br from-emerald-500/4 via-transparent to-teal-500/4 pointer-events-none" />
                <div className="absolute -inset-px rounded-2xl bg-linear-to-br from-white/6 via-transparent to-white/3 pointer-events-none" />
                {/* Logo - Full ARM Logo */}
                <div className="flex justify-center mb-6">
                  <motion.div
                    animate={{ y: [0, -4, 0] }}
                    transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                  >
                    <img
                      src="/logo-full-clean.png"
                      alt="ARM Logo"
                      className="h-24 w-auto object-contain drop-shadow-[0_0_20px_rgba(99,102,241,0.2)]"
                    />
                  </motion.div>
                </div>

                {/* Title */}
                <h1 className="text-2xl font-bold text-white text-center mb-2">
                  تسجيل الدخول
                </h1>
                <p className="text-slate-400 text-center text-sm mb-8">
                  أدخل بياناتك للوصول إلى النظام
                </p>

                {/* Error */}
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

                {/* Form */}
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
                        className="bg-white/5 border-white/10 text-white placeholder:text-slate-500 pr-10 focus:border-indigo-500/50 focus:ring-indigo-500/20"
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
                        className="bg-white/5 border-white/10 text-white placeholder:text-slate-500 pr-10 pl-10 focus:border-indigo-500/50 focus:ring-indigo-500/20"
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
                    className="w-full h-11 bg-linear-to-l from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white font-semibold text-base rounded-xl transition-all duration-300 shadow-lg shadow-indigo-500/25 hover:shadow-indigo-500/40 disabled:opacity-60"
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
                  نظام إدارة الجودة © {new Date().getFullYear()}
                </p>
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
