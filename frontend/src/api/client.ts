import { useAuthStore } from '../stores/auth';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  idempotent?: boolean;
}

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const auth = useAuthStore();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (auth.accessToken) {
    headers.Authorization = `Bearer ${auth.accessToken}`;
  }
  if (options.idempotent) {
    headers['Idempotency-Key'] = crypto.randomUUID();
  }

  const response = await fetch(`${API_URL}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(response.status, data?.message ?? 'Request failed');
  }

  return data as T;
}
