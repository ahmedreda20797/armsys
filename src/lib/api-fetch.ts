// src/lib/api-fetch.ts
// Client-side fetch wrapper that automatically adds JWT Bearer token
// Replaces the old x-user-id header approach

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

export function authFetch(url: string, options?: RequestInit): Promise<Response> {
  const headers = new Headers(options?.headers);

  // Add Authorization Bearer token if not already present
  if (!headers.has('Authorization')) {
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
