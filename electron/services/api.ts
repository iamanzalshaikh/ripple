import { getApiBase, loadDesktopEnv } from "../config/env.js";

loadDesktopEnv();
export const API_BASE = getApiBase();

export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiError {
  success: false;
  message: string;
  error?: string;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

function connectionError(): ApiError {
  return {
    success: false,
    message: `Cannot reach backend at ${API_BASE}. Start ripple-backend (npm run dev) and check PORT in .env matches VITE_API_URL.`,
  };
}

async function parseJson<T>(res: Response): Promise<ApiResponse<T>> {
  const body = (await res.json()) as ApiResponse<T>;
  if (!res.ok && body.success === false) {
    return body;
  }
  if (!res.ok) {
    return {
      success: false,
      message: `HTTP ${res.status}`,
    };
  }
  return body;
}

async function apiFetch(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch {
    throw new Error("ECONNREFUSED");
  }
}

export type AuthPayload = {
  token: string;
  refresh_token: string;
  refresh_expires_at: string;
  user: { id: string; email: string; name?: string; onboarding_completed: boolean };
};

export interface ApiHealthResult {
  ok: boolean;
  url: string;
  status?: number;
  message: string;
  latencyMs?: number;
}

export async function apiHealthCheck(): Promise<ApiHealthResult> {
  const url = `${API_BASE}/health`;
  const started = Date.now();
  try {
    const res = await apiFetch(url);
    const latencyMs = Date.now() - started;
    const body = (await res.json()) as { ok?: boolean; service?: string };
    if (res.ok && body.ok) {
      return {
        ok: true,
        url: API_BASE,
        status: res.status,
        message: `Backend OK (${body.service ?? "ripple-backend"})`,
        latencyMs,
      };
    }
    return {
      ok: false,
      url: API_BASE,
      status: res.status,
      message: `Health check failed (HTTP ${res.status})`,
      latencyMs,
    };
  } catch {
    return {
      ok: false,
      url: API_BASE,
      message: `Cannot reach ${API_BASE}. Is ripple-backend running?`,
    };
  }
}

export async function apiLogin(args: {
  email: string;
  password: string;
  device?: string;
}): Promise<ApiResponse<AuthPayload>> {
  try {
    const res = await apiFetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: args.email,
        password: args.password,
        device: args.device ?? "ripple-desktop",
      }),
    });
    return parseJson(res);
  } catch {
    return connectionError();
  }
}

export async function apiSignup(args: {
  email: string;
  password: string;
  name?: string;
  device?: string;
}): Promise<ApiResponse<AuthPayload>> {
  try {
    const res = await apiFetch(`${API_BASE}/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: args.email,
        password: args.password,
        name: args.name,
        device: args.device ?? "ripple-desktop",
      }),
    });
    return parseJson(res);
  } catch {
    return connectionError();
  }
}

export async function apiMe(
  accessToken: string,
): Promise<
  ApiResponse<{
    id: string;
    email: string;
    onboarding_completed: boolean;
    preferences: Record<string, unknown>;
  }>
> {
  try {
    const res = await apiFetch(`${API_BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return parseJson(res);
  } catch {
    return connectionError();
  }
}

export async function apiRefresh(
  refreshToken: string,
): Promise<
  ApiResponse<{
    token: string;
    refresh_token: string;
    refresh_expires_at: string;
  }>
> {
  try {
    const res = await apiFetch(`${API_BASE}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    return parseJson(res);
  } catch {
    return connectionError();
  }
}

export async function apiLogout(
  accessToken: string,
  refreshToken: string,
): Promise<ApiResponse<{ message: string }>> {
  try {
    const res = await apiFetch(`${API_BASE}/auth/logout`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    return parseJson(res);
  } catch {
    return connectionError();
  }
}

export async function apiEndSession(
  accessToken: string,
  sessionId: string,
): Promise<
  ApiResponse<{
    session_id: string;
    is_active: boolean;
    ended_at: string;
    duration_ms: number;
  }>
> {
  try {
    const res = await apiFetch(`${API_BASE}/session/end`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ session_id: sessionId }),
    });
    return parseJson(res);
  } catch {
    return connectionError();
  }
}

export interface CommandHistoryItem {
  id: string;
  command: string;
  intent: string;
  result: string | null;
  output_type: string;
  confidence: number;
  context_type: string | null;
  action_source: string | null;
  created_at: string;
}

export async function apiCommandHistory(
  accessToken: string,
  query?: {
    page?: number;
    limit?: number;
    sort?: "latest" | "oldest";
    intent?: string;
    context_type?: string;
    action_source?: string;
  },
): Promise<
  ApiResponse<{
    items: CommandHistoryItem[];
    total: number;
    page: number;
    limit: number;
    sort: string;
  }>
> {
  try {
    const params = new URLSearchParams();
    params.set("page", String(query?.page ?? 1));
    params.set("limit", String(query?.limit ?? 20));
    params.set("sort", query?.sort ?? "latest");
    if (query?.intent) params.set("intent", query.intent);
    if (query?.context_type) params.set("context_type", query.context_type);
    if (query?.action_source) params.set("action_source", query.action_source);

    const res = await apiFetch(
      `${API_BASE}/commands/history?${params.toString()}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    return parseJson(res);
  } catch {
    return connectionError();
  }
}

export async function apiExecuteCommand(
  accessToken: string,
  args: {
    sessionId?: string;
    command: string;
    contextType?: string;
    actionSource?: string;
    contextMetadata?: Record<string, unknown>;
    selectedText?: string | null;
  },
): Promise<ApiResponse<Record<string, unknown>>> {
  try {
    const res = await apiFetch(`${API_BASE}/commands/execute`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session_id: args.sessionId,
        command: args.command,
        context_type: args.contextType ?? "general",
        action_source: args.actionSource ?? "desktop",
        context_metadata: args.contextMetadata,
        selected_text: args.selectedText ?? null,
      }),
    });
    return parseJson(res);
  } catch {
    return connectionError();
  }
}

export async function apiStartSession(
  accessToken: string,
  args?: { device?: string; context_type?: string; action_source?: string },
): Promise<
  ApiResponse<{
    session_id: string;
    is_active: boolean;
    device?: string;
    context: Record<string, unknown>;
    created_at: string;
  }>
> {
  try {
    const res = await apiFetch(`${API_BASE}/session/start`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        device: args?.device ?? "ripple-desktop",
        context_type: args?.context_type ?? "general",
        action_source: args?.action_source ?? "desktop",
      }),
    });
    return parseJson(res);
  } catch {
    return connectionError();
  }
}
