export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function createApiClient(baseUrl: string) {
  return async function apiRequest<T>(
    path: string,
    options: { method?: string; body?: unknown } = {},
  ): Promise<T> {
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method ?? 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      throw new ApiError(response.status, data?.message ?? 'Request failed');
    }

    return data as T;
  };
}

// The sandbox IPG's own backend (payment intent create/confirm/cancel/verify).
export const apiRequest = createApiClient(
  import.meta.env.VITE_API_URL ?? 'http://localhost:4000',
);
