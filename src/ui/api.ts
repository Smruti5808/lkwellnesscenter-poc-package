'use client';
// Browser-side API client. Session expiry sends the user back to sign-in.
import { useCallback, useEffect, useRef, useState } from 'react';

export class ClientError extends Error {
  constructor(message: string, public status: number, public code: string, public fieldErrors: Record<string, string[]> = {}) { super(message); }
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/v1/${path}`, {
      ...init, cache: 'no-store', credentials: 'same-origin',
      headers: { ...(init.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
    });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new ClientError('Connection problem. Nothing was lost — please retry.', 0, 'NETWORK_ERROR');
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('auth/login')) window.location.replace('/login?expired=1');
    throw new ClientError(payload.error?.message ?? 'The request failed. Please retry.', response.status, payload.error?.code ?? 'ERROR', payload.error?.fieldErrors ?? {});
  }
  return payload.data as T;
}

const json = (method: string, body?: unknown): RequestInit => ({ method, body: body === undefined ? undefined : JSON.stringify(body) });
export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>(path, { signal }),
  post: <T>(path: string, body: unknown = {}) => request<T>(path, json('POST', body)),
  patch: <T>(path: string, body: unknown) => request<T>(path, json('PATCH', body)),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  upload: <T>(path: string, form: FormData) => request<T>(path, { method: 'POST', body: form }),
};

export const errorText = (error: unknown) => (error instanceof Error ? error.message : 'Something went wrong. Please retry.');

/** Loads `path` (skipped when null) and exposes reload(). Stale responses are ignored after the path changes. */
export function useData<T>(path: string | null) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: !!path });
  const current = useRef(path);
  const load = useCallback(async (signal?: AbortSignal) => {
    if (!path) return;
    setState(s => ({ ...s, loading: true, error: undefined }));
    try {
      const data = await api.get<T>(path, signal);
      if (current.current === path) setState({ data, loading: false });
    } catch (error) {
      if (!signal?.aborted && current.current === path) setState(s => ({ ...s, error: errorText(error), loading: false }));
    }
  }, [path]);
  useEffect(() => {
    current.current = path;
    setState({ loading: !!path });
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [path, load]);
  return { ...state, reload: () => load() };
}
