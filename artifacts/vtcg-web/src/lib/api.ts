const API = "/api";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
  }
}

export class UnauthorizedError extends ApiError {}

function getCsrfToken(): string | null {
  const match = document.cookie.match(/(?:^|;\s*)vtcg_admin_csrf=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : null;
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  includeCsrf = false,
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined) headers.set("Content-Type", "application/json");
  if (includeCsrf) {
    const csrf = getCsrfToken();
    if (csrf) headers.set("X-CSRF-Token", csrf);
  }
  const response = await fetch(`${API}${path}`, {
    ...init,
    credentials: "include",
    headers,
  });
  const data = (await response.json().catch(() => ({}))) as {
    message?: string;
    code?: string;
  };
  if (response.status === 401) {
    window.dispatchEvent(new CustomEvent("admin:unauthorized"));
    throw new UnauthorizedError(data.message ?? "Session expired.", 401, data.code);
  }
  if (!response.ok) {
    if (data.code === "RECENT_AUTH_REQUIRED") {
      window.dispatchEvent(new CustomEvent("admin:reauth-required"));
    }
    throw new ApiError(data.message ?? "Request failed.", response.status, data.code);
  }
  return data as T;
}

export function apiFetch<T>(path: string): Promise<T> {
  return request<T>(path);
}

export function apiPost<T>(
  path: string,
  body: unknown,
  requireCsrf = true,
): Promise<T> {
  return request<T>(
    path,
    { method: "POST", body: JSON.stringify(body ?? {}) },
    requireCsrf,
  );
}

export function apiPatch<T>(path: string, body: unknown): Promise<T> {
  return request<T>(
    path,
    { method: "PATCH", body: JSON.stringify(body) },
    true,
  );
}

export function apiDelete<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(
    path,
    {
      method: "DELETE",
      body: body !== undefined ? JSON.stringify(body) : undefined,
    },
    true,
  );
}

export interface Admin {
  id: string;
  email: string;
  displayName: string;
  role: string;
  permissions: string[];
  status?: string;
  lastLoginAt?: string | null;
  lockedUntil?: string | null;
  invitationExpiresAt?: string | null;
  invitationDeliveryStatus?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Session {
  id: string;
  administrator: Pick<Admin, "id" | "email" | "displayName" | "role">;
  createdAt: string;
  lastActivityAt: string;
  expiresAt: string;
  deviceFingerprint: string;
  networkFingerprint: string;
  current: boolean;
}

export interface AuthState {
  authenticated: boolean;
  admin: Admin;
  permissions: string[];
}