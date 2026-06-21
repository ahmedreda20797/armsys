'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Lock, Mail, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';

const FULL_TEXT = 'نظام إدارة الجودة ARM';

// ═══ Stars Generator ═══
function generateStars(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    x: Math.random() * 100,
    y: Math.random() * 100,
    size: Math.random() * 2.5 + 0.3,
    duration: Math.random() * 4 + 3,
    delay: Math.random() * 5,
    opacity: Math.random() * 0.7 + 0.15,
  }));
}

const stars = generateStars(120);

// ═══ Floating particles generator ═══
function generateParticles(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    x: Math.random() * 100,
    y: Math.random() * 100,
    size: Math.random() * 60 + 20,
    duration: Math.random() * 20 + 15,
    delay: Math.random() * 10,
    drift: Math.random() * 30 + 10,
    hue: Math.random() > 0.5 ? 'violet' : 'indigo',
  }));
}

const particles = generateParticles(8);

// ═══ Cosmic loading screen component (reusable) ═══
export function CosmicLoadingScreen() {
  return (
    <div className="min-h-screen w-full relative overflow-hidden bg-[#050816]">
      {/* Stars */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {stars.map((star) => (
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
      </div>

      {/* Floating cosmic dust */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <motion.div
          className="absolute -top-32 -right-32 w-[500px] h-[500px] rounded-full opacity-20"
          style={{
            background: 'radial-gradient(circle, rgba(139,92,246,0.4) 0%, rgba(88,28,135,0.15) 40%, transparent 70%)',
          }}
          animate={{ scale: [1, 1.15, 1], rotate: [0, 5, 0] }}
          transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute -bottom-48 -left-48 w-[600px] h-[600px] rounded-full opacity-15"
          style={{
            background: 'radial-gradient(circle, rgba(99,102,241,0.35) 0%, rgba(67,56,202,0.1) 45%, transparent 70%)',
          }}
          animate={{ scale: [1, 1.1, 1], rotate: [0, -3, 0] }}
          transition={{ duration: 15, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute top-1/3 left-1/3 w-[400px] h-[400px] rounded-full opacity-10"
          style={{
            background: 'radial-gradient(circle, rgba(6,182,212,0.3) 0%, rgba(8,145,178,0.08) 50%, transparent 70%)',
          }}
          animate={{ scale: [1, 1.2, 1] }}
          transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute top-10 left-10 w-[300px] h-[300px] rounded-full opacity-[0.08]"
          style={{
            background: 'radial-gradient(circle, rgba(236,72,153,0.2) 0%, transparent 70%)',
          }}
          animate={{ scale: [1, 1.08, 1] }}
          transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>

      {/* Center content */}
      <div className="relative flex flex-col items-center justify-center min-h-screen gap-8 px-4">
        {/* Logo with cosmic glow */}
        <motion.div
          className="relative"
          animate={{ scale: [1, 1.06, 1], rotate: [0, 2, -2, 0] }}
          transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
        >
          {/* Outer glow rings */}
          <div className="absolute inset-0 -m-8">
            <motion.div
              className="absolute inset-0 rounded-full opacity-20"
              style={{
                background: 'conic-gradient(from 0deg, transparent, rgba(139,92,246,0.5), transparent, rgba(99,102,241,0.5), transparent)',
              }}
              animate={{ rotate: 360 }}
              transition={{ duration: 8, repeat: Infinity, ease: 'linear' }}
            />
          </div>
          {/* Inner glow */}
          <div
            className="absolute inset-0 -m-4 rounded-full blur-2xl"
            style={{
              background: 'radial-gradient(circle, rgba(139,92,246,0.3) 0%, rgba(99,102,241,0.1) 50%, transparent 70%)',
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

        {/* Orbital loading dots */}
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
    <div className="min-h-screen w-full relative overflow-hidden bg-[#050816]">
      {/* ═══ Star field (120 stars, richer) ═══ */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {stars.map((star) => (
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
      </div>

      {/* ═══ Floating cosmic dust particles ═══ */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {particles.map((p) => (
          <motion.div
            key={p.id}
            className={`absolute rounded-full opacity-[0.04] blur-3xl`}
            style={{
              left: `${p.x}%`,
              top: `${p.y}%`,
              width: `${p.size}px`,
              height: `${p.size}px`,
              background: p.hue === 'violet'
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
      </div>

      {/* ═══ Nebula clouds — deeper and more layered ═══ */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {/* Main violet nebula - top right */}
        <motion.div
          className="absolute -top-32 -right-32 w-[500px] h-[500px] rounded-full opacity-20"
          style={{
            background: 'radial-gradient(circle, rgba(139,92,246,0.4) 0%, rgba(88,28,135,0.15) 40%, transparent 70%)',
          }}
          animate={{ scale: [1, 1.15, 1], rotate: [0, 5, 0] }}
          transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }}
        />
        {/* Indigo nebula - bottom left */}
        <motion.div
          className="absolute -bottom-48 -left-48 w-[600px] h-[600px] rounded-full opacity-15"
          style={{
            background: 'radial-gradient(circle, rgba(99,102,241,0.35) 0%, rgba(67,56,202,0.1) 45%, transparent 70%)',
          }}
          animate={{ scale: [1, 1.1, 1], rotate: [0, -3, 0] }}
          transition={{ duration: 15, repeat: Infinity, ease: 'easeInOut' }}
        />
        {/* Teal/cyan accent nebula - center */}
        <motion.div
          className="absolute top-1/3 left-1/3 w-[400px] h-[400px] rounded-full opacity-10"
          style={{
            background: 'radial-gradient(circle, rgba(6,182,212,0.3) 0%, rgba(8,145,178,0.08) 50%, transparent 70%)',
          }}
          animate={{ scale: [1, 1.2, 1] }}
          transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
        />
        {/* Subtle pink nebula - top left */}
        <motion.div
          className="absolute top-10 left-10 w-[300px] h-[300px] rounded-full opacity-[0.08]"
          style={{
            background: 'radial-gradient(circle, rgba(236,72,153,0.2) 0%, transparent 70%)',
          }}
          animate={{ scale: [1, 1.08, 1] }}
          transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
        />
        {/* Deep blue cosmic band — horizontal */}
        <motion.div
          className="absolute top-1/2 -translate-y-1/2 -left-20 w-[calc(100%+80px)] h-[300px] rounded-full opacity-[0.06]"
          style={{
            background: 'radial-gradient(ellipse, rgba(30,58,138,0.6) 0%, transparent 70%)',
          }}
          animate={{ scale: [1, 1.05, 1], x: [0, 20, 0] }}
          transition={{ duration: 20, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>

      {/* ═══ Shooting stars — more frequent ═══ */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <motion.div
          className="absolute top-[15%] right-[60%] w-px h-16 origin-top"
          style={{
            background: 'linear-gradient(to bottom, rgba(255,255,255,0.7), transparent)',
          }}
          animate={{ opacity: [0, 1, 0], y: [0, 120] }}
          transition={{ duration: 2.5, repeat: Infinity, repeatDelay: 6, ease: 'easeOut' }}
        />
        <motion.div
          className="absolute top-[35%] right-[20%] w-px h-20 origin-top"
          style={{
            background: 'linear-gradient(to bottom, rgba(139,92,246,0.6), transparent)',
          }}
          animate={{ opacity: [0, 0.8, 0], y: [0, 150] }}
          transition={{ duration: 3, repeat: Infinity, repeatDelay: 9, ease: 'easeOut' }}
        />
        <motion.div
          className="absolute top-[60%] right-[70%] w-px h-12 origin-top"
          style={{
            background: 'linear-gradient(to bottom, rgba(99,102,241,0.5), transparent)',
          }}
          animate={{ opacity: [0, 0.7, 0], y: [0, 100] }}
          transition={{ duration: 2, repeat: Infinity, repeatDelay: 12, ease: 'easeOut' }}
        />
      </div>

      {/* ═══ Grid lines — subtle sci-fi grid on the floor ═══ */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
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
            {/* Logo with cosmic glow */}
            <motion.div
              className="relative"
              animate={{ scale: [1, 1.06, 1], rotate: [0, 2, -2, 0] }}
              transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
            >
              {/* Outer glow rings */}
              <div className="absolute inset-0 -m-8">
                <motion.div
                  className="absolute inset-0 rounded-full opacity-20"
                  style={{
                    background: 'conic-gradient(from 0deg, transparent, rgba(139,92,246,0.5), transparent, rgba(99,102,241,0.5), transparent)',
                  }}
                  animate={{ rotate: 360 }}
                  transition={{ duration: 8, repeat: Infinity, ease: 'linear' }}
                />
              </div>
              {/* Pulsing ring */}
              <div className="absolute inset-0 -m-6">
                <motion.div
                  className="absolute inset-0 rounded-full border border-violet-500/20"
                  animate={{ scale: [1, 1.15, 1], opacity: [0.3, 0.1, 0.3] }}
                  transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                />
              </div>
              {/* Inner glow */}
              <div
                className="absolute inset-0 -m-4 rounded-full blur-2xl"
                style={{
                  background: 'radial-gradient(circle, rgba(139,92,246,0.35) 0%, rgba(99,102,241,0.15) 50%, transparent 70%)',
                }}
              />
              <div className="relative w-40 h-40 flex items-center justify-center">
                <img
                  src="/logo-letter-a.png"
                  alt="ARM"
                  className="w-36 h-36 object-contain drop-shadow-[0_0_60px_rgba(139,92,246,0.4)]"
                />
              </div>
            </motion.div>

            {/* Typing animation */}
            <div className="text-center">
              <h1 className="text-3xl md:text-4xl font-bold text-white leading-relaxed">
                {typedText}
                <motion.span
                  className="inline-block w-0.5 h-8 bg-violet-400 mr-1 align-middle"
                  animate={{ opacity: [1, 0] }}
                  transition={{ duration: 0.6, repeat: Infinity }}
                />
              </h1>
            </div>

            {/* Orbital loading dots */}
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
                className="relative rounded-2xl p-8 md:p-10 shadow-2xl backdrop-blur-2xl bg-white/[0.03] border border-white/[0.06] shadow-black/40"
                initial={{ scale: 0.9, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.1, ease: [0.4, 0, 0.2, 1] }}
              >
                {/* Subtle inner glow */}
                <div
                  className="absolute inset-0 rounded-2xl pointer-events-none"
                  style={{
                    background: 'radial-gradient(ellipse at top, rgba(139,92,246,0.08), transparent 50%), radial-gradient(ellipse at bottom, rgba(99,102,241,0.05), transparent 50%)',
                  }}
                />
                <div className="absolute -inset-px rounded-2xl pointer-events-none" style={{
                  background: 'linear-gradient(135deg, rgba(139,92,246,0.15), transparent 40%, transparent 60%, rgba(99,102,241,0.1))',
                }} />

                {/* Logo - Full ARM Logo */}
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
