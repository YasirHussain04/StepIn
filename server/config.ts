import { z } from "zod";
import dotenv from "dotenv";
dotenv.config({ quiet: true });
const geminiModel = z
  .string()
  .regex(/^(?:models\/)?gemini-[a-zA-Z0-9._-]+$/, "Use a Gemini model ID")
  .default("gemini-3.8-flash");
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
  CONVERSATION_MODEL: geminiModel,
  AUDIT_MODEL: geminiModel,
  TRANSCRIPTION_MODEL: geminiModel,
  SCENE_MODEL: geminiModel,
  AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(90000).default(35000),
  CORS_ORIGINS: z
    .string()
    .default(
      "http://localhost:8091,http://localhost:8081,http://localhost:8082",
    ),
  EVENTS_FEED_URLS: z.string().default("https://www.calgarylibrary.ca/"),
});
export type Config = z.infer<typeof schema>;
export function readConfig(
  env: Record<string, string | undefined> = process.env,
): Config {
  const clean = Object.fromEntries(
    Object.entries(env).filter(([, v]) => v !== ""),
  );
  const config = schema.parse(clean);
  if (
    config.NODE_ENV === "production" &&
    (!config.SUPABASE_URL ||
      !config.SUPABASE_ANON_KEY ||
      !config.SUPABASE_SERVICE_ROLE_KEY)
  )
    throw new Error("Supabase server configuration is required in production");
  return config;
}
