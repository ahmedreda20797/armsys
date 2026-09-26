// src/lib/api-fetch.ts
// ══════════════════════════════════════════════════════════════
//  CANONICAL client fetch layer (§UNIFIED-FETCH).
//
//  Every client → API request goes through here:
//    • apiFetch<T> — JSON contract: Bearer token, one 401 auto-retry
//      through the shared token-refresh mutex, JSON parse, typed
//      error throw. Used by all React Query hooks.
//    • authFetch  — raw Response contract (uploads, abortable
//      searches, manual streaming): same Bearer injection + same 401
//      auto-retry, but the caller inspects the Response.
//
//  Both layers previously existed separately (authFetch had no
//  401 recovery); they are now two views over ONE token-refresh
//  mutex, so an expired access token recovers identically no matter
//  which surface issued the request. query-provider.tsx re-exports
//  apiFetch for backward compatibility — no consumer churn.
//
//  Dev-only request counter (§45/§46): window.__qnalysApiStats()
//  prints per-endpoint request counts + bytes — the before/after
//  evidence that the cache layer reduces network traffic.
// ══════════════════════════════════════════════════════════════

export function getAuthHeaders(customHeaders?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    ...customHeaders,
  };

  if (typeof window !== 'undefined') {
    try {
      const token = localStorage.getItem('erp_access_token');
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
    } catch {
      // ignore
    }
  }

  return headers;
}

// ─── Token Refresh Mutex (single, shared) ─────────────────────
let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessTokenLocked(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const refreshToken = localStorage.getItem('erp_refresh_token');
      if (!refreshToken) return null;

      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });

      if (!res.ok) {
        // Refresh failed — clear tokens (AuthContext will handle full logout)
        localStorage.removeItem('erp_access_token');
        localStorage.removeItem('erp_refresh_token');
        localStorage.removeItem('erp_user');
        return null;
      }

      const data = await res.json();
      localStorage.setItem('erp_access_token', data.accessToken);
      localStorage.setItem('erp_refresh_token', data.refreshToken);

      // Sync AuthContext (and any other listener) with the new token
      window.dispatchEvent(new CustomEvent('erp:token-refreshed', { detail: data }));

      return data.accessToken;
    } catch {
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

async function fetchWithAuthRetry(url: string, options?: RequestInit): Promise<Response> {
  const headers = new Headers(options?.headers);

  if (!headers.has('Authorization') && typeof window !== 'undefined') {
    try {
      const token = localStorage.getItem('erp_access_token');
      if (token) headers.set('Authorization', `Bearer ${token}`);
    } catch {
      // ignore
    }
  }

  let res = await fetch(url, { ...options, headers });

  if (res.status === 401 && typeof window !== 'undefined') {
    const newToken = await refreshAccessTokenLocked();
    if (newToken) {
      headers.set('Authorization', `Bearer ${newToken}`);
      res = await fetch(url, { ...options, headers });
    }
  }

  noteDevRequest(url, res);
  return res;
}

export function authFetch(url: string, options?: RequestInit): Promise<Response> {
  return fetchWithAuthRetry(url, options);
}

export async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetchWithAuthRetry(url, options);

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || `HTTP ${res.status}`);
  }

  return res.json();
}

// ─── Dev-only request accounting (§46 measure before/after) ───
// Counts real network requests per endpoint. Production builds pay
// nothing: every branch below is dead in prod.
type ApiStat = { count: number; bytes: number };
const devRequestStats = new Map<string, ApiStat>();

function noteDevRequest(url: string, res: Response): void {
  if (process.env.NODE_ENV === 'production') return;
  if (typeof window === 'undefined') return;
  const path = url.split('?')[0] || url;
  const stat = devRequestStats.get(path) ?? { count: 0, bytes: 0 };
  stat.count += 1;
  const len = Number(res.headers.get('content-length'));
  if (Number.isFinite(len)) stat.bytes += len;
  devRequestStats.set(path, stat);
}

if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
  (window as unknown as { __qnalysApiStats: () => void }).__qnalysApiStats = () => {
    const rows = [...devRequestStats.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .map(([endpoint, s]) => ({ endpoint, requests: s.count, kb: Math.round(s.bytes / 1024) }));
    console.table(rows);
    return rows;
  };
}
