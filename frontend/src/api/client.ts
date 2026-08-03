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

// Multipart upload — deliberately separate from apiRequest, since a
// FormData body needs the browser to set its own Content-Type (with the
// multipart boundary) rather than the fixed 'application/json' above.
export async function uploadFile<T>(path: string, file: File): Promise<T> {
  return postMultipart<T>(path, { file });
}

interface MultipartOptions {
  idempotent?: boolean;
}

// General multipart POST: string fields plus an optional File, keyed by
// whatever field name the endpoint expects (e.g. 'document' + 'description'
// for the overdue-settlement upload, vs. uploadFile's fixed 'file' field for
// batch imports).
export async function postMultipart<T>(
  path: string,
  fields: Record<string, string | File | undefined>,
  options: MultipartOptions = {},
): Promise<T> {
  const auth = useAuthStore();
  const headers: Record<string, string> = {};
  if (auth.accessToken) {
    headers.Authorization = `Bearer ${auth.accessToken}`;
  }
  if (options.idempotent) {
    headers['Idempotency-Key'] = crypto.randomUUID();
  }

  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) {
      formData.append(key, value);
    }
  }

  const response = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers,
    body: formData,
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(response.status, data?.message ?? 'Request failed');
  }

  return data as T;
}
