import { z } from "zod";
import dotenv from "dotenv";
dotenv.config({ quiet: true });
const geminiModel = (fallback: string) =>
  z
    .string()
    .regex(/^(?:models\/)?gemini-[a-zA-Z0-9._-]+$/, "Use a Gemini model ID")
    .default(fallback);
const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  SUPABASE_URL: z.url().optional(),
  SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  CONVERSATION_MODEL: geminiModel("gemini-3.8-flash"),
  AUDIT_MODEL: geminiModel("gemini-3.8-flash"),
  TRANSCRIPTION_MODEL: geminiModel("gemini-2.5-flash"),
  SCENE_MODEL: geminiModel("gemini-3.8-flash"),
  LIVE_MODEL: geminiModel("gemini-2.5-flash-native-audio-preview-09-2025"),
  AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(90000).default(35000),
  CORS_ORIGINS: z
    .string()
    .default(
      "http://localhost:8091,http://localhost:8081,http://localhost:8082",
    ),
  EVENTS_FEED_URLS: z.string().default("https://www.calgarylibrary.ca/"),
  LOCAL_DEV_BYPASS: z.enum(["true", "false"]).optional(),
});
export type Config = Omit<z.infer<typeof schema>, "LOCAL_DEV_BYPASS"> & {
  LOCAL_DEV_BYPASS: boolean;
};
export function readConfig(
  env: Record<string, string | undefined> = process.env,
): Config {
  const clean = Object.fromEntries(
    Object.entries(env).filter(([, v]) => v !== ""),
  );
  const parsed = schema.parse(clean);
  if (
    parsed.NODE_ENV === "production" &&
    (!parsed.SUPABASE_URL ||
      !parsed.SUPABASE_ANON_KEY ||
      !parsed.SUPABASE_SERVICE_ROLE_KEY)
  )
    throw new Error("Supabase server configuration is required in production");
  const bypass =
    parsed.LOCAL_DEV_BYPASS === "true"
      ? true
      : parsed.LOCAL_DEV_BYPASS === "false"
        ? false
        : parsed.NODE_ENV !== "production";
  if (parsed.NODE_ENV === "production" && bypass)
    throw new Error("LOCAL_DEV_BYPASS cannot be enabled in production");
  return { ...parsed, LOCAL_DEV_BYPASS: bypass };
}
export const LOCAL_DEV_USER = "local-dev";
export const LOCAL_DEV_TOKEN = "local-dev";
