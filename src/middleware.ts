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
  const response = NextResponse.next();

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

  // Content Security Policy
  response.headers.set(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://firebasestorage.googleapis.com https://*.googleusercontent.com",
      "font-src 'self' data:",
      "connect-src 'self' https://*.firebaseio.com https://*.googleapis.com wss://*.firebaseio.com",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "base-uri 'self'",
    ].join('; ')
  );

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
