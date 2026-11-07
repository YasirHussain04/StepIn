import { createClient } from "@supabase/supabase-js";
import { readConfig } from "../server/config";

async function main() {
  const config = readConfig();
  const required = [
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
  ] as const;
  const missing = required.filter((name) => !config[name]);
  if (missing.length) {
    console.error(
      `Missing server configuration: ${missing.join(", ")}. Fill the ignored .env file.`,
    );
    process.exitCode = 1;
    return;
  }
  const auth = await fetch(`${config.SUPABASE_URL}/auth/v1/settings`, {
    headers: { apikey: config.SUPABASE_ANON_KEY! },
    signal: AbortSignal.timeout(15_000),
  });
  if (!auth.ok)
    throw new Error(
      "Supabase Auth connection failed. Check the URL and public key.",
    );
  console.log("Supabase Auth reachable. A user sign-in has not been tested.");
  const admin = createClient(
    config.SUPABASE_URL!,
    config.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (input, init) =>
          fetch(input, { ...init, signal: AbortSignal.timeout(15_000) }),
      },
    },
  );
  // Read-only validation function: creates no account, profile or chat rows.
  const { data, error } = await admin.rpc("stepin_valid_answers", {
    a: {
      q1: 2,
      q2: 2,
      q3: 2,
      q4: 2,
      q5: 3,
      q6: 3,
      q7: "One to one",
      q8: ["Prefer not to say"],
      q9: ["Prefer not to say"],
      q10: ["A low-pressure first step"],
    },
  });
  if (error || data !== true)
    throw new Error(
      "Supabase schema check failed. Apply both SQL migrations and verify the server service-role key.",
    );
  console.log(
    "Supabase schema validator reachable with server credentials. No private rows were read or written.",
  );
  console.log(
    `Gemini key configured for both agents and transcription: ${!!config.GEMINI_API_KEY}. Model access still requires an authenticated live request.`,
  );
}
main().catch((error) => {
  console.error(
    error instanceof Error && !/fetch failed/i.test(error.message)
      ? error.message
      : "Backend connection check failed. Check network access and configuration.",
  );
  process.exitCode = 1;
});
