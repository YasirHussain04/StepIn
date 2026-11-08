import { supabase } from "./auth";

/** Prefer a real session; otherwise use local-dev bypass for on-device Gemini. */
export async function bearerAuthHeader(): Promise<string> {
  const { data } = (await supabase?.auth.getSession()) ?? { data: null };
  if (data?.session?.access_token)
    return `Bearer ${data.session.access_token}`;
  return "Bearer local-dev";
}
