// src/lib/login-errors.ts
// Shared login error contract — the single source of truth for the login
// API (src/app/api/auth/login) and the login UI (LoginPage / AuthContext).
//
// The frontend maps by error CODE — never by matching raw message text —
// so a message change here propagates everywhere without touching logic.

export type LoginErrorField = 'email' | 'password' | 'general';

export const LOGIN_ERROR_CODES = {
  EMAIL_NOT_FOUND: 'EMAIL_NOT_FOUND',
  INVALID_PASSWORD: 'INVALID_PASSWORD',
  INVALID_EMAIL: 'INVALID_EMAIL',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NETWORK_ERROR: 'NETWORK_ERROR',
  SERVER_ERROR: 'SERVER_ERROR',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  ACCOUNT_SUSPENDED: 'ACCOUNT_SUSPENDED',
  FIREBASE_CONFIG: 'FIREBASE_CONFIG',
} as const;

export type LoginErrorCode =
  (typeof LOGIN_ERROR_CODES)[keyof typeof LOGIN_ERROR_CODES];

// ─── Safe, user-facing Arabic messages ─────────────────────────────
// Named constants so client-side validation and server-side defense
// use byte-identical strings.
export const LOGIN_MESSAGES = {
  EMAIL_REQUIRED: 'يرجى إدخال البريد الإلكتروني',
  EMAIL_INVALID: 'يرجى إدخال بريد إلكتروني صحيح',
  PASSWORD_REQUIRED: 'يرجى إدخال كلمة المرور',
  EMAIL_NOT_FOUND: 'البريد الإلكتروني غير صحيح أو غير مسجل',
  INVALID_PASSWORD: 'كلمة المرور غير صحيحة',
  ACCOUNT_LOCKED: 'تم تأمين الحساب مؤقتاً بسبب محاولات فاشلة متعددة',
  ACCOUNT_SUSPENDED: 'هذا الحساب موقوف مؤقتاً. تواصل مع مدير النظام.',
  GENERAL_ERROR: 'حدث خطأ أثناء تسجيل الدخول. يرجى المحاولة مرة أخرى',
} as const;

/** Message to display per error code (all safe — no technical details). */
export const LOGIN_ERROR_MESSAGES: Record<LoginErrorCode, string> = {
  EMAIL_NOT_FOUND: LOGIN_MESSAGES.EMAIL_NOT_FOUND,
  INVALID_PASSWORD: LOGIN_MESSAGES.INVALID_PASSWORD,
  INVALID_EMAIL: LOGIN_MESSAGES.EMAIL_INVALID,
  VALIDATION_ERROR: LOGIN_MESSAGES.GENERAL_ERROR,
  NETWORK_ERROR: LOGIN_MESSAGES.GENERAL_ERROR,
  SERVER_ERROR: LOGIN_MESSAGES.GENERAL_ERROR,
  ACCOUNT_LOCKED: LOGIN_MESSAGES.ACCOUNT_LOCKED,
  ACCOUNT_SUSPENDED: LOGIN_MESSAGES.ACCOUNT_SUSPENDED,
  // Firebase misconfiguration is a system error for the user; the
  // actionable operator message travels in the response `detail` and
  // is logged to the console — never rendered in the UI.
  FIREBASE_CONFIG: LOGIN_MESSAGES.GENERAL_ERROR,
};

/** Which field the error belongs to, for inline display. */
export const LOGIN_ERROR_FIELD: Record<LoginErrorCode, LoginErrorField> = {
  EMAIL_NOT_FOUND: 'email',
  INVALID_EMAIL: 'email',
  INVALID_PASSWORD: 'password',
  VALIDATION_ERROR: 'general',
  NETWORK_ERROR: 'general',
  SERVER_ERROR: 'general',
  ACCOUNT_LOCKED: 'general',
  ACCOUNT_SUSPENDED: 'general',
  FIREBASE_CONFIG: 'general',
};

// Pragmatic email format check — shared by client validation and the
// server's defense-in-depth check so both accept exactly the same set.
const EMAIL_FORMAT_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmailFormat(email: string): boolean {
  return EMAIL_FORMAT_REGEX.test(email);
}
