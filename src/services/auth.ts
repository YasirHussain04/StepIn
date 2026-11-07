import { createClient, processLock } from "@supabase/supabase-js";
import * as Linking from "expo-linking";
import { authStorage } from "./authStorage";
const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
export const authConfigured = !!(url && key);
export const supabase = authConfigured
  ? createClient(url!, key!, {
      auth: {
        storage: authStorage,
        storageKey: "stepin-auth",
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        flowType: "pkce",
        lock: processLock,
      },
    })
  : null;
export function authRedirectUrl() {
  return (
    process.env.EXPO_PUBLIC_AUTH_REDIRECT_URL ||
    Linking.createURL("/auth/callback")
  );
}
export async function acceptAuthUrl(url: string) {
  if (!supabase) return;
  const parsed = new URL(url);
  const params = new URLSearchParams(
    parsed.hash ? parsed.hash.slice(1) : parsed.search,
  );
  const code = parsed.searchParams.get("code");
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw error;
  } else if (params.get("access_token") && params.get("refresh_token")) {
    const { error } = await supabase.auth.setSession({
      access_token: params.get("access_token")!,
      refresh_token: params.get("refresh_token")!,
    });
    if (error) throw error;
  } else if (params.get("error_description"))
    throw new Error(
      "The account link expired or could not be verified. Request a new link.",
    );
}
