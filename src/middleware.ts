// src/middleware.ts
// Next.js Middleware — Security Headers + API Route Protection
// Runs on EVERY request before it reaches route handlers

import { NextRequest, NextResponse } from 'next/server';

// ─── Routes that DON'T require authentication ───────────
const PUBLIC_PATHS = [
  '/api/auth/login',
  '/api/auth/refresh',
  // '/api/auth/seed-admin' — REMOVED: now requires auth + env gate
  '/api/health',
];

// ─── Routes that are completely blocked (removed from prod) ─
const BLOCKED_PATHS = [
  '/api/debug-env',
  '/api/seed-test',
  '/api/auth/seed',
  '/api/download',
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // Mutable request headers — the CSP (with its per-request nonce) is
  // set here so the Next.js SSR renderer reads the policy and nonces
  // its own script tags, then the same headers flow downstream.
  const requestHeaders = new Headers(request.headers);
  const response = NextResponse.next({ request: { headers: requestHeaders } });

  // ═══════════════════════════════════════════════════
  //  1. Block removed debug/test routes
  // ═══════════════════════════════════════════════════
  if (BLOCKED_PATHS.some(path => pathname.startsWith(path))) {
    return NextResponse.json(
      { error: 'This endpoint has been removed' },
      { status: 404 }
    );
  }

  // ═══════════════════════════════════════════════════
  //  1.5. Seed-admin: require auth + production block
  // ═══════════════════════════════════════════════════
  if (pathname.startsWith('/api/auth/seed-admin')) {
    // In production, block entirely with security log
    if (process.env.NODE_ENV === 'production') {
      console.error(
        `[SECURITY] Blocked admin-seed access in production. ` +
        `Path: ${pathname}, Method: ${request.method}, ` +
        `Time: ${new Date().toISOString()}`
      );
      return NextResponse.json(
        { error: 'This endpoint is disabled in production' },
        { status: 403 }
      );
    }
    // In non-production, allow through (the route handler itself has additional env gate)
    return response;
  }

  // ═══════════════════════════════════════════════════
  //  2. Security Headers (applied to ALL responses)
  // ═══════════════════════════════════════════════════

  // Content Security Policy — §PHASE0-CSP
  //
  // Phase 0 hardening: production scripts are NONCE-based
  // ('nonce-…' + 'strict-dynamic') instead of 'unsafe-inline'
  // 'unsafe-eval'. The nonce is generated per request and set on the
  // REQUEST headers as well — Next.js reads the request CSP and
  // automatically applies the nonce to its own bootstrap/hydration
  // <script> tags during SSR (the documented Next.js mechanism), so
  // no component code needs to know the nonce.
  //
  // Remaining accepted relaxations (documented, deliberately kept):
  //   • style-src 'unsafe-inline' — Next.js and framer-motion inject
  //     runtime <style> tags; a style nonce is not applied by Next
  //     automatically. CSS injection is not script execution.
  //   • Dev-only 'unsafe-eval' — React Refresh / Next HMR require it.
  //     Never emitted in production builds.
  const isDev = process.env.NODE_ENV !== 'production';
  const devConnect = isDev ? ' http://localhost:* ws://localhost:*  http://127.0.0.1:* ws://127.0.0.1:*' : '';

  // Per-request nonce — middleware runs on the Edge runtime, so the
  // WebCrypto global (crypto.randomUUID) and btoa are used instead of
  // node:crypto/Buffer. base64 keeps the CSP nonce token spec-compliant.
  const nonce = btoa(crypto.randomUUID());

  // In production the script policy is nonce + strict-dynamic: 'self'
  // stays listed only as a legacy-browser fallback (modern browsers
  // honoring strict-dynamic ignore host allowlists). In development
  // the HMR tooling requires inline scripts and eval, so the nonce is
  // added alongside the dev allowances.
  const scriptSrc = isDev
    ? `'self' 'nonce-${nonce}' 'unsafe-inline' 'unsafe-eval'`
    : `'self' 'nonce-${nonce}' 'strict-dynamic'`;

  const cspHeader = [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://firebasestorage.googleapis.com https://*.googleusercontent.com",
    "font-src 'self' data:",
    "connect-src 'self' https://*.firebaseio.com https://*.firebasedatabase.app https://*.googleapis.com wss://*.firebaseio.com wss://*.firebasedatabase.app" + devConnect,
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'self'",
  ].join('; ');

  // The CSP must travel on the REQUEST so the Next.js renderer can
  // nonce its own scripts, and on the RESPONSE so the browser
  // enforces it.
  requestHeaders.set('Content-Security-Policy', cspHeader);
  requestHeaders.set('x-nonce', nonce);
  response.headers.set('Content-Security-Policy', cspHeader);

  // Prevent clickjacking
  response.headers.set('X-Frame-Options', 'DENY');

  // Prevent MIME type sniffing
  response.headers.set('X-Content-Type-Options', 'nosniff');

  // XSS Protection (legacy browsers)
  response.headers.set('X-XSS-Protection', '1; mode=block');

  // Referrer Policy
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Permissions Policy — restrict browser features
  response.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=()'
  );

  // HSTS (HTTP Strict Transport Security) — enforce HTTPS in production
  if (process.env.NODE_ENV === 'production') {
    response.headers.set(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains; preload'
    );
  }

  // ═══════════════════════════════════════════════════
  //  3. API Route Authentication Gate
  // ═══════════════════════════════════════════════════

  // Only gate API routes
  if (pathname.startsWith('/api/')) {
    // Skip public routes
    if (PUBLIC_PATHS.some(path => pathname.startsWith(path))) {
      return response;
    }

    // Check for Authorization header on protected API routes
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Authentication required', errorKey: 'AUTH_REQUIRED' },
        { status: 401 }
      );
    }
  }

  // ═══════════════════════════════════════════════════
  //  4. Static assets & Next.js internals — pass through
  // ═══════════════════════════════════════════════════

  return response;
}

// Run middleware on API routes and page routes
export const config = {
  matcher: [
    // All API routes
    '/api/:path*',
    // All page routes (for security headers on HTML)
    '/((?!_next/static|_next/image|favicon.ico|public).*)',
  ],
};
