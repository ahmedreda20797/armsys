'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTheme } from 'next-themes';
import { QnlysAtmosphere } from '@/components/brand/QnlysAtmosphere';
import { useAuth, type LoginResult } from '@/contexts/AuthContext';
import { useLanguage } from '@/lib/i18n/language-context';
import { translate } from '@/lib/i18n/dictionary';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Lock, Mail, Eye, EyeOff, AlertCircle, Globe } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  LOGIN_ERROR_CODES,
  LOGIN_ERROR_MESSAGES,
  LOGIN_MESSAGES,
  isValidEmailFormat,
} from '@/lib/login-errors';

// ── Deterministic year — rendered only on client to avoid mismatch ──
function CopyrightYear() {
  const [year, setYear] = useState<number | null>(null);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration-safe client-only value: reading the clock during render would cause an SSR mismatch.
  useEffect(() => setYear(new Date().getFullYear()), []);
  return <>{year ?? '2024'}</>;
}

// ── Inline field error (RTL, below the input) ──
function FieldError({ id, message }: { id: string; message: string }) {
  return (
    <motion.p
      id={id}
      role="alert"
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      className="flex items-center gap-1.5 text-xs font-medium text-red-400"
    >
      <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />
      <span>{message}</span>
    </motion.p>
  );
}

// ── Official full-lockup logo, theme-aware ──
// §BRAND — the brand statement uses the REAL complete Qnlys asset
// (perfect internal proportions by definition): silver wordmark on
// dark surfaces (qnlys.svg), the official print variant with the
// charcoal wordmark on paper (qnlys-print.svg).
function useQnlysLogo() {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  // Post-mount flip: resolvedTheme is only reliable after hydration.
  useEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(raf);
  }, []);
  const isLight = mounted && resolvedTheme === 'light';
  return { src: isLight ? '/qnlys-print.svg' : '/qnlys.svg', isLight };
}

// ── §BRAND-VIZ — restrained "operational intelligence" cues. ──
// A thin signal path with sparse connected nodes. Decorative only:
// brand-red gradient stroke at low opacity, dash drift + node pulse,
// fully static under prefers-reduced-motion (shared CSS classes).
function SignalDefs({ id }: { id: string }) {
  return (
    <defs>
      <linearGradient id={id} x1="0" y1="0" x2="1" y2="0">
        <stop stopColor="#c22334" stopOpacity="0" />
        <stop offset="0.5" stopColor="#db4a58" stopOpacity="0.6" />
        <stop offset="1" stopColor="#7c1624" stopOpacity="0" />
      </linearGradient>
    </defs>
  );
}

/** Strip under the application descriptor in the brand zone — the
    quiet "live data" element that keeps the area from feeling empty. */
function BrandSignalStrip() {
  return (
    <div aria-hidden="true" dir="ltr" className="mt-7 hidden w-full max-w-[420px] sm:block">
      <svg viewBox="0 0 420 44" className="qnlys-connect h-11 w-full" fill="none">
        <SignalDefs id="qnlys-strip-grad" />
        <path
          className="qnlys-connect-path"
          d="M 6 24 C 80 12 140 34 210 24 S 350 14 414 24"
          stroke="url(#qnlys-strip-grad)"
          strokeWidth="1"
        />
        <circle className="qnlys-node" cx="112" cy="19" r="2" fill="#db4a58" />
        <circle className="qnlys-node" cx="252" cy="26" r="2" fill="#db4a58" style={{ animationDelay: '1.5s' }} />
        <circle className="qnlys-node" cx="356" cy="18" r="2" fill="#db4a58" style={{ animationDelay: '3s' }} />
      </svg>
    </div>
  );
}

/** The perceived connection between the login card and the brand
    area: one faint analytical path drifting through the space
    between the two zones (desktop only, felt rather than seen). */
function ZoneBridge() {
  return (
    <div
      aria-hidden="true"
      dir="ltr"
      className="pointer-events-none absolute left-1/2 top-1/2 z-[5] hidden h-40 w-[min(620px,42vw)] -translate-x-1/2 -translate-y-1/2 lg:block"
    >
      <svg viewBox="0 0 620 160" className="qnlys-connect h-full w-full" fill="none">
        <SignalDefs id="qnlys-bridge-grad" />
        <path
          className="qnlys-connect-path"
          d="M 8 118 C 130 118 160 46 310 46 S 500 112 612 112"
          stroke="url(#qnlys-bridge-grad)"
          strokeWidth="1"
        />
        <circle className="qnlys-node" cx="178" cy="70" r="2" fill="#db4a58" />
        <circle className="qnlys-node" cx="452" cy="87" r="2" fill="#db4a58" style={{ animationDelay: '1.8s' }} />
      </svg>
    </div>
  );
}

// ═══ Login Page — premium two-zone enterprise composition ═══
// Desktop: brand zone (logo + official tagline + atmosphere) beside the
// login card. Mobile: deliberate stacked composition — compact brand
// header, then the card. Foreground only — PersistentBackground is
// mounted once in App Shell (page.tsx); QnlysAtmosphere is this page's
// scoped decorative layer.
//
// §BRAND-HIERARCHY: 1. logo  2. official tagline  3. login interaction
// 4. data atmosphere  5. secondary metadata. Authentication behavior,
// validation and error handling are untouched by this composition.
export default function LoginPage() {
  const { login, error: sessionError, loading: sessionLoading, clearError } = useAuth();
  const { locale, setLocale } = useLanguage();
  const logo = useQnlysLogo();
  const t = (key: Parameters<typeof translate>[0]) => translate(key, locale);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // Editing any field dismisses stale errors (session banner + general
  // form error; per-field errors clear with their own value).
  const handleEmailChange = (value: string) => {
    setEmail(value);
    if (emailError) setEmailError(null);
    if (formError) setFormError(null);
    if (sessionError) clearError();
  };

  const handlePasswordChange = (value: string) => {
    setPassword(value);
    if (passwordError) setPasswordError(null);
    if (formError) setFormError(null);
    if (sessionError) clearError();
  };

  /** Map a structured login failure to inline field errors / general banner. */
  const applyLoginError = (result: LoginResult) => {
    switch (result.errorKey) {
      case LOGIN_ERROR_CODES.EMAIL_NOT_FOUND:
      case LOGIN_ERROR_CODES.INVALID_EMAIL:
        setEmailError(LOGIN_ERROR_MESSAGES[result.errorKey]);
        return;

      case LOGIN_ERROR_CODES.INVALID_PASSWORD:
        setPasswordError(LOGIN_ERROR_MESSAGES[result.errorKey]);
        return;

      case LOGIN_ERROR_CODES.VALIDATION_ERROR:
        // Server-side defense in depth — the client normally catches
        // these first. Show on the field the server hinted at.
        if (result.field === 'email') {
          setEmailError(LOGIN_MESSAGES.EMAIL_REQUIRED);
        } else if (result.field === 'password') {
          setPasswordError(LOGIN_MESSAGES.PASSWORD_REQUIRED);
        } else {
          setFormError(LOGIN_MESSAGES.GENERAL_ERROR);
        }
        return;

      case LOGIN_ERROR_CODES.ACCOUNT_LOCKED: {
        const minutes = result.retryAfterSeconds
          ? Math.max(1, Math.round(result.retryAfterSeconds / 60))
          : null;
        setFormError(
          minutes
            ? `${LOGIN_MESSAGES.ACCOUNT_LOCKED} (يمكنك المحاولة بعد ${minutes} دقيقة)`
            : LOGIN_MESSAGES.ACCOUNT_LOCKED
        );
        return;
      }

      case LOGIN_ERROR_CODES.ACCOUNT_SUSPENDED:
        setFormError(LOGIN_MESSAGES.ACCOUNT_SUSPENDED);
        return;

      // NETWORK_ERROR, SERVER_ERROR, FIREBASE_CONFIG, and anything
      // unrecognized → the safe general message (details stay in console).
      default:
        setFormError(LOGIN_MESSAGES.GENERAL_ERROR);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return; // double-submit guard

    setEmailError(null);
    setPasswordError(null);
    setFormError(null);

    // ─── Client-side validation — the request is never sent until
    //     both fields are present and the email format is valid ───
    const trimmedEmail = email.trim();
    let hasValidationError = false;

    if (!trimmedEmail) {
      setEmailError(LOGIN_MESSAGES.EMAIL_REQUIRED);
      hasValidationError = true;
    } else if (!isValidEmailFormat(trimmedEmail)) {
      setEmailError(LOGIN_MESSAGES.EMAIL_INVALID);
      hasValidationError = true;
    }

    if (!password) {
      setPasswordError(LOGIN_MESSAGES.PASSWORD_REQUIRED);
      hasValidationError = true;
    }

    if (hasValidationError) return;

    // Loading starts ONLY when the request actually starts, and is
    // always reset in finally — success, failure, or timeout.
    setIsSubmitting(true);
    try {
      const result = await login(trimmedEmail, password);
      if (result.ok) {
        toast.success(t('login.success'));
        return;
      }
      applyLoginError(result);
    } catch (err) {
      // Safety net — login() handles its own errors; this guards
      // against anything thrown outside it (e.g. toast failure).
      console.error('[LoginPage] Unexpected error during login:', err);
      setFormError(LOGIN_MESSAGES.GENERAL_ERROR);
    } finally {
      setIsSubmitting(false);
    }
  };

  const busy = isSubmitting || sessionLoading;

  return (
    <div className="relative min-h-dvh w-full overflow-hidden">
      {/* §ATMOSPHERE — scoped data-intelligence layer (grid, signal
          curves, monitoring points); sits between the app-wide
          PersistentBackground and the login content. */}
      <QnlysAtmosphere />

      {/* Faint signal path bridging the card zone and the brand zone */}
      <ZoneBridge />

      {/* §20.1 — language switch on the login screen itself, at the
          document's END edge (English/LTR → top-right, Arabic/RTL →
          top-left — direction-independent by logical property). */}
      <button
        type="button"
        onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')}
        className="absolute top-5 end-5 z-20 inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3.5 text-xs font-bold text-slate-300 transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
      >
        <Globe className="size-3.5" aria-hidden="true" />
        {locale === 'ar' ? 'English' : 'العربية'}
      </button>

      <motion.div
        className="relative z-10 mx-auto flex min-h-dvh w-full max-w-[1560px] flex-col lg:grid lg:grid-cols-[1fr_1.1fr] lg:grid-rows-[1fr_auto]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
      >
        {/* ── Brand zone — logo → official tagline → descriptor ──
            Grid column 2 (inline-END): the brand occupies the side
            OPPOSITE the reading start in both directions — LEFT in
            Arabic/RTL, RIGHT in English/LTR — from one placement, no
            duplicated markup. DOM order is unchanged so mobile keeps
            stacking brand → card. */}
        <div className="relative flex flex-1 flex-col items-center justify-center px-6 pb-10 pt-16 text-center sm:pt-20 lg:col-start-2 lg:row-start-1 lg:px-12 lg:py-0">
          {/* Localized red glow behind the lockup */}
          <div
            aria-hidden="true"
            className="qnlys-login-brand-glow pointer-events-none absolute left-1/2 top-1/2 h-[560px] w-[560px] max-w-full -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl"
          />
          {/* Official complete Qnlys lockup — real asset, perfect
              proportions; gentle entrance rise (§BRAND-HIERARCHY 1). */}
          <motion.img
            src={logo.src}
            alt="Qnlys"
            dir="ltr"
            draggable={false}
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className={cn(
              'h-24 w-auto object-contain sm:h-28 lg:h-36',
              !logo.isLight && 'drop-shadow-[0_0_30px_rgba(180,0,34,0.28)]'
            )}
          />

          {/* Official brand tagline — EXACT approved wording, always
              English regardless of interface language (§BRAND). */}
          <p
            dir="ltr"
            className="mt-7 max-w-[280px] text-sm font-medium leading-relaxed tracking-wide text-slate-300 sm:max-w-[440px] sm:text-base lg:max-w-none lg:text-lg"
          >
            {t('login.tagline')}
          </p>

          <span aria-hidden="true" className="qnlys-brand-divider mt-6" />

          {/* Application descriptor — readable but secondary to the
              official tagline; no letter-spacing in Arabic (it breaks
              the script's joined letterforms). */}
          <p
            className={cn(
              'mt-4 text-[13px] font-semibold text-slate-400',
              locale === 'en' && 'uppercase tracking-[0.3em]'
            )}
          >
            {t('app.tagline')}
          </p>

          {/* Quiet live-data cue under the descriptor */}
          <BrandSignalStrip />
        </div>

        {/* ── Card zone — the refined charcoal login card ──
            Grid column 1 (inline-START): the login sits at the reading
            start in BOTH directions — RIGHT in Arabic/RTL, LEFT in
            English/LTR. The document `dir` drives everything; there is
            no language-specific positioning. */}
        <div className="relative flex flex-1 items-center justify-center px-4 pb-14 sm:px-6 lg:col-start-1 lg:row-start-1 lg:px-10 lg:py-0">
          <motion.div
            className="relative w-full max-w-[440px] rounded-2xl border border-white/[0.08] bg-white/[0.04] p-7 shadow-2xl shadow-black/40 backdrop-blur-2xl sm:p-9"
            initial={{ opacity: 0, y: 24, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.55, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
          >
            {/* Red atmospheric tint inside the card */}
            <div aria-hidden="true" className="qnlys-card-aura absolute inset-0 rounded-2xl" />
            {/* Brand hairline across the top edge */}
            <div aria-hidden="true" className="qnlys-card-topline absolute inset-x-10 top-0 h-px" />

            <div className="relative mb-7">
              <h1 className="text-2xl font-bold tracking-tight text-white">{t('login.title')}</h1>
              <p className="mt-2 text-sm leading-relaxed text-slate-300">{t('login.subtitle')}</p>
            </div>

            {/* General errors — session-level (e.g. suspended account) or
                server/network failures. Never contains technical details. */}
            <AnimatePresence>
              {(formError || sessionError) && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  role="alert"
                  className="relative mb-4 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-center text-sm text-red-400"
                >
                  {formError || sessionError}
                </motion.div>
              )}
            </AnimatePresence>

            {/* noValidate — native browser tooltips are replaced by the
                inline Arabic validation errors below each field */}
            <form onSubmit={handleLogin} noValidate className="relative space-y-5">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-[13px] font-medium text-slate-300">
                  {t('login.email')}
                </Label>
                <div className="relative">
                  <Mail className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="user@qnlys.com"
                    value={email}
                    onChange={(e) => handleEmailChange(e.target.value)}
                    aria-invalid={!!emailError}
                    aria-describedby={emailError ? 'email-error' : undefined}
                    className={cn(
                      'h-11 bg-white/[0.04] border-white/[0.08] text-white placeholder:text-slate-500 pr-10 focus:border-brand-500/50 focus:ring-brand-500/20',
                      emailError && 'border-red-500/60 focus:border-red-500/60 focus:ring-red-500/20'
                    )}
                    dir="ltr"
                    autoComplete="email"
                  />
                </div>
                <AnimatePresence>
                  {emailError && <FieldError id="email-error" message={emailError} />}
                </AnimatePresence>
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-[13px] font-medium text-slate-300">
                  {t('login.password')}
                </Label>
                <div className="relative">
                  <Lock className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => handlePasswordChange(e.target.value)}
                    aria-invalid={!!passwordError}
                    aria-describedby={passwordError ? 'password-error' : undefined}
                    className={cn(
                      'h-11 bg-white/[0.04] border-white/[0.08] text-white placeholder:text-slate-500 pr-10 pl-10 focus:border-brand-500/50 focus:ring-brand-500/20',
                      passwordError && 'border-red-500/60 focus:border-red-500/60 focus:ring-red-500/20'
                    )}
                    dir="ltr"
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 transition-colors hover:text-slate-300"
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                <AnimatePresence>
                  {passwordError && <FieldError id="password-error" message={passwordError} />}
                </AnimatePresence>
              </div>

              <Button
                type="submit"
                disabled={busy}
                className="h-12 w-full rounded-xl bg-linear-to-l from-brand-600 to-brand-700 text-[15px] font-semibold text-white shadow-lg shadow-brand-500/25 transition-all duration-200 hover:-translate-y-px hover:from-brand-700 hover:to-brand-800 hover:shadow-brand-500/40 active:translate-y-0 disabled:opacity-60 disabled:hover:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
              >
                {busy ? (
                  <>
                    <motion.div
                      className="size-4 border-2 border-white/30 border-t-white rounded-full"
                      animate={{ rotate: 360 }}
                      transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
                    />
                    <span>{t('login.submitting')}</span>
                  </>
                ) : (
                  t('login.submit')
                )}
              </Button>
            </form>
          </motion.div>
        </div>

        {/* ── Footer — brand + year (secondary metadata) ──
            Direction-INDEPENDENT centering: flex justify-center keeps
            the line at the viewport center in RTL and LTR alike (the
            unlayered [dir=rtl] text-align rule overrides text-center,
            so text alignment is not used here on purpose). */}
        <div className="relative z-10 flex justify-center py-4 lg:col-span-2 lg:row-start-2">
          <p className="text-[11px] text-slate-600">
            Qnlys © <CopyrightYear />
          </p>
        </div>
      </motion.div>
    </div>
  );
}
