// src/lib/api-fetch.ts
// Client-side fetch wrapper that automatically adds x-user-id header
// for server-side permission verification

export function getAuthHeaders(customHeaders?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    ...customHeaders,
  };

  if (typeof window !== 'undefined') {
    try {
      const stored = localStorage.getItem('erp_user');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed?.id) {
          headers['x-user-id'] = parsed.id;
        }
      }
    } catch {
      // ignore parse errors
    }
  }

  return headers;
}

export function authFetch(url: string, options?: RequestInit): Promise<Response> {
  const headers = new Headers(options?.headers);

  // Add x-user-id if not already present
  if (!headers.has('x-user-id')) {
    const authHeaders = getAuthHeaders();
    Object.entries(authHeaders).forEach(([key, value]) => {
      headers.set(key, value);
    });
  }

  return fetch(url, {
    ...options,
    headers,
  });
}
