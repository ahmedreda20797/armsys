#!/usr/bin/env node
// scripts/login-ui-probe.mjs
// ══════════════════════════════════════════════════════════════
//  Headless-Chrome acceptance probe for the Login page error handling.
//
//  Drives the real UI through the login testing checklist:
//   1. empty email / invalid format / empty password → inline Arabic
//      field errors, and NO login request is sent
//   2. server error (Firebase placeholder) → safe general banner
//   3. EMAIL_NOT_FOUND / INVALID_PASSWORD / ACCOUNT_LOCKED /
//      SERVER_ERROR / network failure / abort → correct field or
//      banner feedback via a fetch interceptor (the real API contract
//      for these codes is covered by login-route-errors.test.mts)
//   4. loading state: spinner during the request, always resets
//
//  Zero dependencies — Node's built-in WebSocket + Chrome DevTools
//  Protocol. Requires Chrome (CHROME_PATH env or the default path).
//
//  Usage:  node scripts/login-ui-probe.mjs [baseUrl]
//          baseUrl defaults to http://localhost:3000
// ══════════════════════════════════════════════════════════════

import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE_URL = process.argv[2] || 'http://localhost:3000';
const CHROME =
  process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const ARTIFACTS = mkdtempSync(join(tmpdir(), 'login-ui-probe-'));

const results = [];
function record(name, pass, detail = '') {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  →  ${detail}` : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Miniature CDP client ─────────────────────────────────────
class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 0;
    this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description || 'page evaluate failed');
    }
    return r.result?.value;
  }
  async screenshot(name) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    const file = join(ARTIFACTS, `${name}.png`);
    writeFileSync(file, Buffer.from(r.data, 'base64'));
    return file;
  }
}

async function waitFor(cdp, expression, timeoutMs = 30000, label = expression) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const v = await cdp.evaluate(expression);
      if (v) return v;
    } catch {
      /* page mid-navigation — retry */
    }
    await sleep(250);
  }
  // Attach the full page state to timeout errors so failures are
  // diagnosable from the probe output alone.
  let diag = '';
  try {
    diag = JSON.stringify(await readState());
  } catch {
    /* page gone */
  }
  throw new Error(`waitFor timeout: ${label}${diag ? `  [state=${diag}]` : ''}`);
}

// ─── Page-side helpers (injected as expressions) ──────────────
function installFetchHook() {
  return cdp.evaluate(`
    (() => {
      if (!window.__realFetch) window.__realFetch = window.fetch.bind(window);
      window.__loginCalls = 0;
      window.__loginInterceptor = null;
      window.fetch = (input, init) => {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        if (String(url).includes('/api/auth/login')) {
          window.__loginCalls += 1;
          if (window.__loginInterceptor) return window.__loginInterceptor();
        }
        return window.__realFetch(input, init);
      };
    })()
  `);
}

function setInterceptor(kind) {
  return cdp.evaluate(`
    (() => {
      const respond = (status, body) =>
        Promise.resolve(new Response(JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json' },
        }));
      const kinds = {
        EMAIL_NOT_FOUND: () => respond(401, { error: 'x', errorKey: 'EMAIL_NOT_FOUND', field: 'email', remainingAttempts: 4 }),
        INVALID_PASSWORD: () => respond(401, { error: 'x', errorKey: 'INVALID_PASSWORD', field: 'password', remainingAttempts: 4 }),
        SERVER_ERROR: () => respond(500, { error: 'x', errorKey: 'SERVER_ERROR' }),
        ACCOUNT_LOCKED: () => respond(429, { error: 'x', errorKey: 'ACCOUNT_LOCKED', retryAfterSeconds: 1800 }),
        NETWORK_REJECT: () => Promise.reject(new TypeError('Failed to fetch')),
        ABORT: () => Promise.reject(new DOMException('The operation was aborted.', 'AbortError')),
        SLOW: () => new Promise((resolve) =>
          setTimeout(() => resolve(respond(401, { error: 'x', errorKey: 'SERVER_ERROR' })), 1500)),
        SUCCESS: () => respond(200, {
          accessToken: 'probe-access-token',
          refreshToken: 'probe-refresh-token',
          user: {
            id: 'probe-u1',
            email: 'user@arm.com',
            name: 'مدير الاختبار',
            role: 'admin',
            permissions: {},
            positionId: null,
            positionPermissions: null,
            linkedEmployeeId: null,
            rank: 'مدير النظام',
            isSuspended: false,
            suspendedAt: null,
            requiresPasswordChange: false,
          },
        }),
      };
      // The fetch hook (installFetchHook) consults this when a login
      // request is made; arming it replaces the real API response.
      window.__loginInterceptor = kinds[${JSON.stringify(kind)}] || null;
    })()
  `);
}

function setField(id, value) {
  return cdp.evaluate(`
    (() => {
      const el = document.getElementById(${JSON.stringify(id)});
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
    })()
  `);
}

async function submit() {
  await cdp.evaluate(`document.querySelector('form').requestSubmit()`);
}

function readState() {
  return cdp.evaluate(`({
    emailError: document.getElementById('email-error')?.textContent?.trim() || null,
    passwordError: document.getElementById('password-error')?.textContent?.trim() || null,
    banner: document.querySelector('div[role="alert"]')?.textContent?.trim() || null,
    buttonDisabled: document.querySelector('button[type="submit"]')?.disabled ?? null,
    buttonText: document.querySelector('button[type="submit"]')?.textContent?.trim() || null,
    loginCalls: window.__loginCalls ?? -1,
    hookInstalled: typeof window.__realFetch === 'function' && window.fetch !== window.__realFetch,
    interceptorArmed: typeof window.__loginInterceptor === 'function',
  })`);
}

async function reload() {
  // Tag the current document; the tag vanishes when navigation replaces
  // it. Waiting for the tag to disappear guarantees the fetch hook is
  // installed on the NEW page — installing on the outgoing document
  // would get wiped and the real API would answer instead of the mock.
  await cdp.evaluate(`window.__probeTag = ${Date.now()}`);
  await cdp.send('Page.navigate', { url: BASE_URL });
  await waitFor(
    cdp,
    `document.readyState === 'complete' && !!document.getElementById('email') && !!document.querySelector('form') && !window.__probeTag`,
    60000,
    'login form (fresh document)'
  );
  await installFetchHook();
  // Give React a moment to finish hydration so the submit handler is live.
  await sleep(500);
}

// ─── Launch Chrome + connect ──────────────────────────────────
const userDataDir = mkdtempSync(join(tmpdir(), 'login-ui-probe-profile-'));
const chrome = spawn(
  CHROME,
  [
    '--remote-debugging-port=0', // actual port resolved below via DevToolsActivePort
    `--user-data-dir=${userDataDir}`,
    '--headless=new',
    '--no-first-run',
    '--disable-gpu',
    '--window-size=1280,900',
    'about:blank',
  ],
  { stdio: 'ignore' }
);

let cdp;
try {
  // --remote-debugging-port=0 lets the OS pick a free port; Chrome writes
  // the actual port to <user-data-dir>/DevToolsActivePort.
  const portFile = join(userDataDir, 'DevToolsActivePort');
  let debugPort = null;
  for (let i = 0; i < 60 && !debugPort; i++) {
    try {
      debugPort = parseInt(readFileSync(portFile, 'utf8').split('\n')[0].trim(), 10);
    } catch {
      await sleep(300);
    }
  }
  if (!debugPort) throw new Error('Chrome DevTools port file never appeared');

  // Wait for the DevTools endpoint
  let target = null;
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${debugPort}/json/new?url=about:blank`, { method: 'PUT' });
      target = await res.json();
      break;
    } catch {
      await sleep(300);
    }
  }
  if (!target?.webSocketDebuggerUrl) throw new Error('Chrome DevTools endpoint never came up');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
  });
  cdp = new Cdp(ws);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  // Navigate and wait for the app to compile + render the login form
  await cdp.send('Page.navigate', { url: BASE_URL });
  await waitFor(cdp, `!!document.getElementById('email') && !!document.querySelector('form')`, 120000, 'login form');
  await installFetchHook();

  const M = {
    EMAIL_REQUIRED: 'يرجى إدخال البريد الإلكتروني',
    EMAIL_INVALID: 'يرجى إدخال بريد إلكتروني صحيح',
    PASSWORD_REQUIRED: 'يرجى إدخال كلمة المرور',
    EMAIL_NOT_FOUND: 'البريد الإلكتروني غير صحيح أو غير مسجل',
    INVALID_PASSWORD: 'كلمة المرور غير صحيحة',
    ACCOUNT_LOCKED: 'تم تأمين الحساب مؤقتاً بسبب محاولات فاشلة متعددة',
    GENERAL: 'حدث خطأ أثناء تسجيل الدخول. يرجى المحاولة مرة أخرى',
  };

  // ── 1. Everything empty → inline validation, no request ──
  await reload();
  await submit();
  let s = await waitFor(cdp, `!!document.getElementById('email-error')`, 10000, 'email error');
  s = await readState();
  record(
    'empty email → inline email error + no request',
    s.emailError === M.EMAIL_REQUIRED && s.loginCalls === 0 && !s.banner,
    `emailError=${JSON.stringify(s.emailError)} calls=${s.loginCalls}`
  );
  record(
    'empty password → inline password error (shown together with email error)',
    s.passwordError === M.PASSWORD_REQUIRED,
    `passwordError=${JSON.stringify(s.passwordError)}`
  );
  await cdp.screenshot('01-empty-fields-inline-errors');

  // ── 2. Invalid email format + empty password ──
  await reload();
  await setField('email', 'not-an-email');
  await submit();
  await waitFor(cdp, `!!document.getElementById('email-error')`, 10000, 'email format error');
  s = await readState();
  record(
    'invalid email format → format error, no request',
    s.emailError === M.EMAIL_INVALID && s.loginCalls === 0,
    `emailError=${JSON.stringify(s.emailError)} calls=${s.loginCalls}`
  );
  await cdp.screenshot('02-invalid-email-format');

  // ── 3. Valid email + empty password → only password error, no request ──
  await reload();
  await setField('email', 'user@arm.com');
  await submit();
  await waitFor(cdp, `!!document.getElementById('password-error')`, 10000, 'password error');
  s = await readState();
  record(
    'valid email + empty password → password error, no request',
    s.passwordError === M.PASSWORD_REQUIRED && !s.emailError && s.loginCalls === 0,
    `passwordError=${JSON.stringify(s.passwordError)} emailError=${JSON.stringify(s.emailError)} calls=${s.loginCalls}`
  );

  // ── 4. Editing a field clears its inline error (poll — framer-motion
  //       keeps the element mounted through its exit animation) ──
  await setField('password', 'some-password');
  await waitFor(
    cdp,
    `!document.getElementById('password-error') && !document.getElementById('email-error') && !document.querySelector('div[role="alert"]')`,
    8000,
    'inline errors cleared after edit'
  );
  s = await readState();
  record('editing a field clears its inline error', !s.passwordError && !s.emailError && !s.banner);

  // ── 5. Real request against the dev server (Firebase placeholder) →
  //       safe general banner, loading resets ──
  await submit();
  await waitFor(cdp, `!!document.querySelector('div[role="alert"]')`, 30000, 'general banner');
  s = await readState();
  record(
    'server (Firebase) error → safe general banner, field errors absent',
    s.banner === M.GENERAL && !s.emailError && !s.passwordError,
    `banner=${JSON.stringify(s.banner)}`
  );
  record(
    'loading state resets after the request finishes',
    s.buttonDisabled === false && s.buttonText === 'تسجيل الدخول',
    `disabled=${s.buttonDisabled} text=${JSON.stringify(s.buttonText)}`
  );
  await cdp.screenshot('03-server-error-general-banner');

  // ── 6. EMAIL_NOT_FOUND → email field error ──
  await reload();
  await setInterceptor('EMAIL_NOT_FOUND');
  await setField('email', 'ghost@arm.com');
  await setField('password', 'whatever123');
  await submit();
  await waitFor(cdp, `!!document.getElementById('email-error')`, 10000, 'EMAIL_NOT_FOUND error');
  s = await readState();
  record(
    'EMAIL_NOT_FOUND → email field error',
    s.emailError === M.EMAIL_NOT_FOUND && !s.passwordError && !s.banner && s.loginCalls === 1,
    `emailError=${JSON.stringify(s.emailError)} calls=${s.loginCalls}`
  );
  await cdp.screenshot('04-email-not-found');

  // ── 7. INVALID_PASSWORD → password field error ──
  await reload();
  await setInterceptor('INVALID_PASSWORD');
  await setField('email', 'user@arm.com');
  await setField('password', 'wrong-pass');
  await submit();
  await waitFor(cdp, `!!document.getElementById('password-error')`, 10000, 'INVALID_PASSWORD error');
  s = await readState();
  record(
    'INVALID_PASSWORD → password field error (email field untouched)',
    s.passwordError === M.INVALID_PASSWORD && !s.emailError && !s.banner,
    `passwordError=${JSON.stringify(s.passwordError)}`
  );
  await cdp.screenshot('05-invalid-password');

  // ── 8. SERVER_ERROR 500 → general banner ──
  await reload();
  await setInterceptor('SERVER_ERROR');
  await setField('email', 'user@arm.com');
  await setField('password', 'whatever123');
  await submit();
  await waitFor(cdp, `!!document.querySelector('div[role="alert"]')`, 10000, '500 banner');
  s = await readState();
  record(
    'SERVER_ERROR → safe general banner',
    s.banner === M.GENERAL && !s.emailError && !s.passwordError,
    `banner=${JSON.stringify(s.banner)}`
  );

  // ── 9. ACCOUNT_LOCKED → banner includes retry window ──
  await reload();
  await setInterceptor('ACCOUNT_LOCKED');
  await setField('email', 'user@arm.com');
  await setField('password', 'whatever123');
  await submit();
  await waitFor(cdp, `!!document.querySelector('div[role="alert"]')`, 10000, 'locked banner');
  s = await readState();
  record(
    'ACCOUNT_LOCKED → banner message incl. retry minutes',
    s.banner?.startsWith(M.ACCOUNT_LOCKED) && s.banner.includes('30'),
    `banner=${JSON.stringify(s.banner)}`
  );

  // ── 10. Network failure → general banner ──
  await reload();
  await setInterceptor('NETWORK_REJECT');
  await setField('email', 'user@arm.com');
  await setField('password', 'whatever123');
  await submit();
  await waitFor(cdp, `!!document.querySelector('div[role="alert"]')`, 10000, 'network banner');
  s = await readState();
  record(
    'network failure → safe general banner, loading resets',
    s.banner === M.GENERAL && s.buttonDisabled === false,
    `banner=${JSON.stringify(s.banner)}`
  );

  // ── 11. Abort (timeout path) → general banner, no stuck spinner ──
  await reload();
  await setInterceptor('ABORT');
  await setField('email', 'user@arm.com');
  await setField('password', 'whatever123');
  await submit();
  await waitFor(cdp, `!!document.querySelector('div[role="alert"]')`, 10000, 'abort banner');
  s = await readState();
  record(
    'timeout/abort → safe general banner, loading resets',
    s.banner === M.GENERAL && s.buttonDisabled === false,
    `banner=${JSON.stringify(s.banner)}`
  );

  // ── 12. Loading spinner during a slow request, then reset ──
  await reload();
  await setInterceptor('SLOW');
  await setField('email', 'user@arm.com');
  await setField('password', 'whatever123');
  await submit();
  await waitFor(
    cdp,
    `document.querySelector('button[type="submit"]')?.textContent?.includes('جاري تسجيل الدخول')`,
    10000,
    'spinner state'
  );
  s = await readState();
  record(
    'loading state active during request (spinner + disabled)',
    s.buttonDisabled === true && s.buttonText.includes('جاري تسجيل الدخول'),
    `text=${JSON.stringify(s.buttonText)}`
  );
  await cdp.screenshot('06-loading-spinner');
  await waitFor(
    cdp,
    `document.querySelector('button[type="submit"]')?.disabled === false`,
    10000,
    'loading reset'
  );
  s = await readState();
  record(
    'loading state resets after slow request completes',
    s.buttonDisabled === false && s.buttonText === 'تسجيل الدخول' && !!s.banner,
    `text=${JSON.stringify(s.buttonText)} banner=${JSON.stringify(s.banner)}`
  );

  // ── 13. Successful login → tokens stored, form unmounts, app mounts ──
  await reload();
  await setInterceptor('SUCCESS');
  await setField('email', 'user@arm.com');
  await setField('password', 'correct-password');
  await submit();
  await waitFor(
    cdp,
    `!document.querySelector('form') && !document.getElementById('email')`,
    15000,
    'login form unmounted after success'
  );
  s = await readState();
  const storage = await cdp.evaluate(
    `localStorage.getItem('erp_access_token') && localStorage.getItem('erp_user')`
  );
  record(
    'successful login → form unmounts + tokens/user stored (app layout mounts)',
    !s.emailError && !s.passwordError && !s.banner && !!storage && s.loginCalls === 1,
    `loginCalls=${s.loginCalls} storage=${!!storage}`
  );

  // ── Summary ──
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  console.log(`Screenshots: ${ARTIFACTS}`);
  process.exitCode = failed.length === 0 ? 0 : 1;
} catch (err) {
  console.error('PROBE ERROR:', err.message);
  process.exitCode = 2;
} finally {
  try { chrome.kill(); } catch {}
}
