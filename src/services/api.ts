import { Platform } from "react-native";
import { supabase } from "./auth";
import {
  CoachRequest,
  CoachResponseSchema,
  EventsResponseSchema,
} from "../../shared/contracts";
export class ClientError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 0,
  ) {
    super(message);
  }
}
export function apiBase(custom?: string) {
  const url = (
    custom ||
    process.env.EXPO_PUBLIC_API_URL ||
    (Platform.OS === "web" && __DEV__ ? "http://localhost:3001" : "")
  ).replace(/\/$/, "");
  if (!url)
    throw new ClientError(
      "NOT_CONFIGURED",
      "Set your backend address in Settings to use this feature.",
    );
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && __DEV__))
    throw new ClientError(
      "HTTPS_REQUIRED",
      "Use HTTPS for your deployed backend.",
    );
  return url;
}
export async function api<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    signal?: AbortSignal;
    public?: boolean;
    url?: string;
  } = {},
): Promise<T> {
  const base = apiBase(options.url);
  const headers: Record<string, string> = {};
  if (!options.public) {
    const { data, error } = (await supabase?.auth.getSession()) ?? {
      data: null,
      error: null,
    };
    if (error || !data?.session)
      throw new ClientError("UNAUTHENTICATED", "Sign in to continue.", 401);
    headers.authorization = `Bearer ${data.session.access_token}`;
  }
  if (options.body !== undefined) headers["content-type"] = "application/json";
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      method: options.method ?? "GET",
      headers,
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal ?? AbortSignal.timeout(150_000),
    });
  } catch (error) {
    if (options.signal?.aborted)
      throw new ClientError("CANCELLED", "Request cancelled.");
    throw new ClientError(
      "OFFLINE",
      "Could not reach the server. Your local data is preserved. Check your connection and retry.",
    );
  }
  const result = await response.json().catch(() => null);
  if (!response.ok)
    throw new ClientError(
      result?.code ?? "SERVER_ERROR",
      result?.message ?? "The server could not complete this request.",
      response.status,
    );
  return result as T;
}
export async function liveCoach(
  request: CoachRequest,
  url?: string,
  signal?: AbortSignal,
) {
  return CoachResponseSchema.parse(
    await api("/api/coach", { method: "POST", body: request, url, signal }),
  );
}
export async function refreshEvents(url?: string, force = false) {
  return EventsResponseSchema.parse(
    await api(`/api/events${force ? "?refresh=1" : ""}`, {
      url,
      public: true,
      signal: AbortSignal.timeout(20_000),
    }),
  );
}
