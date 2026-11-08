import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import { z, ZodError } from "zod";
import { randomUUID } from "node:crypto";
import {
  CoachRequestSchema,
  Id,
  ProfileSchema,
  SessionHeaderSchema,
  SyncRequestSchema,
} from "../shared/contracts";
import { Store, SupabaseStore } from "./store";
import { Config, LOCAL_DEV_TOKEN, LOCAL_DEV_USER } from "./config";
import { ApiError } from "./errors";
import { Coach } from "./coach/run";
import type { Agents } from "./providers/agents";
import { GeminiAgents } from "./providers/gemini";
import {
  AUDIO_TYPES,
  GeminiTranscriber,
  Transcriber,
} from "./providers/transcription";
import {
  GeminiSceneAnalyzer,
  IMAGE_TYPES,
  SceneAnalyzer,
} from "./providers/scene";
import { EventService } from "./events";

declare module "fastify" {
  interface FastifyRequest {
    actor?: { id: string };
  }
}
export async function buildApp(
  config: Config,
  deps: {
    store?: Store;
    agents?: Agents;
    transcriber?: Transcriber;
    sceneAnalyzer?: SceneAnalyzer;
    events?: EventService;
  } = {},
) {
  // No automatic HTTP request logging: bodies, tokens, audio and profile data never enter routine logs.
  const app = Fastify({
    logger: false,
    bodyLimit: 512_000,
    requestTimeout: 180_000,
  });
  const store = deps.store ?? new SupabaseStore(config);
  const coach = new Coach(
    store,
    deps.agents ?? new GeminiAgents(config),
    config,
  );
  const transcriber = deps.transcriber ?? new GeminiTranscriber(config);
  const sceneAnalyzer = deps.sceneAnalyzer ?? new GeminiSceneAnalyzer(config);
  const events = deps.events ?? new EventService(config);
  const running = new Map<string, AbortController>();
  const activeSessions = new Set<string>();
  const origins = config.CORS_ORIGINS.split(",").map((s) => s.trim());
  await app.register(cors, {
    origin: origins,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "authorization",
      "content-type",
      "x-audio-consent",
      "x-image-consent",
      "x-recording-duration",
    ],
  });
  await app.register(rateLimit, { max: 90, timeWindow: "1 minute" });
  await app.register(multipart, {
    limits: { fileSize: 4 * 1024 * 1024, files: 3, fields: 0, parts: 3 },
    throwFileSizeLimit: true,
  });
  app.addHook("preHandler", async (request) => {
    if (
      request.routeOptions.url?.startsWith("/api/") &&
      request.routeOptions.url !== "/api/events"
    ) {
      const match = request.headers.authorization?.match(/^Bearer (.+)$/);
      const token = match?.[1];
      if (
        config.LOCAL_DEV_BYPASS &&
        (token === LOCAL_DEV_TOKEN ||
          (!token && config.NODE_ENV === "development"))
      ) {
        request.actor = { id: LOCAL_DEV_USER };
        return;
      }
      if (!token)
        throw new ApiError(
          "UNAUTHENTICATED",
          "Sign in to use this service.",
          401,
        );
      request.actor = await store.authenticate(token);
    }
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ApiError)
      return reply.code(error.status).send({
        code: error.code,
        message: error.message,
        stage: error.stage ?? null,
      });
    if (error instanceof ZodError)
      return reply.code(400).send({
        code: "INVALID_REQUEST",
        message: "The request contains missing or invalid fields.",
      });
    if ((error as { statusCode?: number }).statusCode === 413)
      return reply.code(413).send({
        code: "TOO_LARGE",
        message: "The request or recording is too large.",
      });
    if ((error as { statusCode?: number }).statusCode === 429)
      return reply.code(429).send({
        code: "RATE_LIMITED",
        message: "Too many requests. Wait a moment and retry.",
      });
    return reply.code(500).send({
      code: "SERVER_ERROR",
      message:
        "This operation could not complete. Retry; your local data is preserved.",
    });
  });
  app.get("/health", async () => ({
    status: "ok",
    version: "0.2.0",
    capabilities: {
      accounts: !!(
        config.SUPABASE_URL &&
        config.SUPABASE_ANON_KEY &&
        config.SUPABASE_SERVICE_ROLE_KEY
      ),
      coaching: !!config.GEMINI_API_KEY,
      transcription: !!config.GEMINI_API_KEY,
      scene: !!config.GEMINI_API_KEY,
      events: true,
      glasses: true,
      localDevBypass: config.LOCAL_DEV_BYPASS,
    },
    models: {
      conversation: config.CONVERSATION_MODEL,
      audit: config.AUDIT_MODEL,
      transcription: config.TRANSCRIPTION_MODEL,
      scene: config.SCENE_MODEL,
    },
  }));
  app.get(
    "/api/events",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request) => {
      const query = z
        .object({ refresh: z.enum(["0", "1"]).optional() })
        .parse(request.query);
      return events.get(query.refresh === "1");
    },
  );
  app.get("/api/sync", async (request) => store.snapshot(request.actor!.id));
  app.post("/api/sync", async (request) => {
    const body = SyncRequestSchema.parse(request.body);
    try {
      return await store.sync(
        request.actor!.id,
        body.expectedRevision,
        body.operations,
      );
    } catch (error) {
      if (
        error instanceof ApiError &&
        (error.code === "REVISION_CONFLICT" ||
          error.code === "PROFILE_CONFLICT")
      )
        return {
          conflict: true,
          snapshot: await store.snapshot(request.actor!.id),
        };
      throw error;
    }
  });
  app.get("/api/profile", async (request) => {
    const snapshot = await store.snapshot(request.actor!.id);
    return {
      activeProfileId: snapshot.activeProfileId,
      profiles: snapshot.profiles,
      revision: snapshot.revision,
    };
  });
  app.post("/api/profile/revisions", async (request) => {
    const body = z
      .object({ profile: ProfileSchema })
      .strict()
      .parse(request.body);
    const snapshot = await store.snapshot(request.actor!.id);
    return store.sync(request.actor!.id, snapshot.revision, [
      { id: randomUUID(), kind: "profile.put", profile: body.profile },
    ]);
  });
  app.post("/api/profile/revisions/:id/activate", async (request) => {
    const id = Id.parse((request.params as { id: string }).id);
    const body = z
      .object({ expectedActiveId: Id.nullable() })
      .strict()
      .parse(request.body);
    const snapshot = await store.snapshot(request.actor!.id);
    const profile = snapshot.profiles.find((p) => p.id === id);
    if (!profile)
      throw new ApiError(
        "NOT_FOUND",
        "This revision does not exist in your account.",
        404,
      );
    return store.sync(request.actor!.id, snapshot.revision, [
      {
        id: randomUUID(),
        kind: "profile.activate",
        profile,
        expectedActiveId: body.expectedActiveId,
      },
    ]);
  });
  app.delete("/api/profile", async (request) => {
    const s = await store.snapshot(request.actor!.id);
    return store.sync(request.actor!.id, s.revision, [
      { id: randomUUID(), kind: "profile.delete_all" },
    ]);
  });
  app.get("/api/sessions", async (request) => {
    const q = z
      .object({
        offset: z.coerce.number().int().min(0).default(0),
        limit: z.coerce.number().int().min(1).max(50).default(20),
        search: z.string().max(200).default(""),
      })
      .parse(request.query);
    const s = await store.snapshot(request.actor!.id);
    const list = s.sessions
      .filter((v) =>
        JSON.stringify(v).toLowerCase().includes(q.search.toLowerCase()),
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return {
      sessions: list
        .slice(q.offset, q.offset + q.limit)
        .map(({ messages, ...header }) => ({
          ...header,
          messageCount: messages.length,
        })),
      nextOffset: q.offset + q.limit < list.length ? q.offset + q.limit : null,
    };
  });
  app.post("/api/sessions", async (request) => {
    const header = SessionHeaderSchema.parse(request.body);
    const s = await store.snapshot(request.actor!.id);
    return store.sync(request.actor!.id, s.revision, [
      {
        id: randomUUID(),
        kind: "session.put",
        session: header,
        historyEpoch: s.historyEpoch,
      },
    ]);
  });
  app.get("/api/sessions/:id/messages", async (request) => {
    const s = await store.snapshot(request.actor!.id);
    const session = s.sessions.find(
      (v) => v.id === Id.parse((request.params as { id: string }).id),
    );
    if (!session)
      throw new ApiError(
        "NOT_FOUND",
        "This chat does not exist in your account.",
        404,
      );
    return { session };
  });
  app.get("/api/messages/:id/audit", async (request) => {
    const s = await store.snapshot(request.actor!.id);
    const message = s.sessions
      .flatMap((v) => v.messages)
      .find((v) => v.id === Id.parse((request.params as { id: string }).id));
    if (!message?.audit)
      throw new ApiError(
        "NOT_FOUND",
        "This check does not exist in your account.",
        404,
      );
    return { audit: message.audit };
  });
  app.delete("/api/sessions/:id", async (request) => {
    const s = await store.snapshot(request.actor!.id);
    return store.sync(request.actor!.id, s.revision, [
      {
        id: randomUUID(),
        kind: "session.delete",
        sessionId: Id.parse((request.params as { id: string }).id),
      },
    ]);
  });
  app.patch("/api/sessions/:id", async (request) => {
    const body = z
      .object({ title: z.string().trim().min(1).max(80) })
      .strict()
      .parse(request.body);
    const s = await store.snapshot(request.actor!.id);
    const session = s.sessions.find(
      (v) => v.id === Id.parse((request.params as { id: string }).id),
    );
    if (!session)
      throw new ApiError(
        "NOT_FOUND",
        "This chat does not exist in your account.",
        404,
      );
    const { messages, ...header } = session;
    return store.sync(request.actor!.id, s.revision, [
      {
        id: randomUUID(),
        kind: "session.put",
        session: { ...header, title: body.title },
        historyEpoch: s.historyEpoch,
      },
    ]);
  });
  app.post(
    "/api/coach",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const body = CoachRequestSchema.parse(request.body);
      const key = `${request.actor!.id}:${body.requestId}`;
      const sessionKey = `${request.actor!.id}:${body.sessionId}`;
      if (running.has(key) || activeSessions.has(sessionKey))
        throw new ApiError(
          "REQUEST_IN_PROGRESS",
          "A turn in this conversation is already being checked.",
          409,
        );
      activeSessions.add(sessionKey);
      const abort = new AbortController();
      running.set(key, abort);
      const disconnected = () => {
        if (!reply.raw.writableEnded) abort.abort();
      };
      reply.raw.on("close", disconnected);
      try {
        return await coach.run(
          request.actor!.id,
          body,
          AbortSignal.any([abort.signal, AbortSignal.timeout(140_000)]),
        );
      } finally {
        running.delete(key);
        activeSessions.delete(sessionKey);
        reply.raw.off("close", disconnected);
      }
    },
  );
  app.post("/api/coach/:id/cancel", async (request) => {
    const id = Id.parse((request.params as { id: string }).id);
    running.get(`${request.actor!.id}:${id}`)?.abort();
    await store.fail(request.actor!.id, id);
    return { cancelled: true };
  });
  app.post(
    "/api/scene",
    {
      bodyLimit: 6 * 1024 * 1024 + 8192,
      config: { rateLimit: { max: 6, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      if (request.headers["x-image-consent"] !== "true")
        throw new ApiError(
          "CONSENT_REQUIRED",
          "Confirm sending glasses stills for scene analysis before uploading.",
          403,
        );
      const frames: { bytes: Buffer; mimeType: string }[] = [];
      const parts = request.files();
      for await (const file of parts) {
        if (frames.length >= 3)
          throw new ApiError(
            "SCENE_FRAME_LIMIT",
            "Send at most 3 glasses stills.",
            400,
          );
        const mime = file.mimetype.split(";")[0].toLowerCase();
        if (!IMAGE_TYPES.has(mime))
          throw new ApiError(
            "UNSUPPORTED_IMAGE",
            "Use JPEG or PNG stills from the glasses camera.",
            415,
          );
        const buffer = await file.toBuffer();
        if (buffer.length < 64 || file.file.truncated)
          throw new ApiError(
            "INVALID_IMAGE",
            "A still is empty or too large (max 2 MB each).",
            400,
          );
        frames.push({ bytes: buffer, mimeType: mime });
      }
      if (!frames.length)
        throw new ApiError(
          "IMAGE_REQUIRED",
          "Capture and review a glasses still before sending.",
          400,
        );
      const abort = new AbortController();
      const disconnect = () => {
        if (!reply.raw.writableEnded) abort.abort();
      };
      reply.raw.on("close", disconnect);
      try {
        const scene = await sceneAnalyzer.summarize(
          frames,
          AbortSignal.any([
            abort.signal,
            AbortSignal.timeout(config.AI_TIMEOUT_MS),
          ]),
        );
        return { scene };
      } finally {
        for (const frame of frames) frame.bytes.fill(0);
        reply.raw.off("close", disconnect);
      }
    },
  );
  app.post(
    "/api/transcribe",
    {
      bodyLimit: 4 * 1024 * 1024 + 4096,
      config: { rateLimit: { max: 6, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      if (request.headers["x-audio-consent"] !== "true")
        throw new ApiError(
          "CONSENT_REQUIRED",
          "Confirm remote transcription before uploading audio.",
          403,
        );
      const duration = z.coerce
        .number()
        .min(0.1)
        .max(45)
        .safeParse(request.headers["x-recording-duration"]);
      if (!duration.success)
        throw new ApiError(
          "RECORDING_LIMIT",
          "Record up to 45 seconds at a time.",
          400,
        );
      const file = await request.file();
      if (!file)
        throw new ApiError(
          "AUDIO_REQUIRED",
          "Record a voice message first.",
          400,
        );
      const mime = file.mimetype.split(";")[0].toLowerCase();
      if (!AUDIO_TYPES.has(mime))
        throw new ApiError(
          "UNSUPPORTED_AUDIO",
          "This audio format is unsupported.",
          415,
        );
      const buffer = await file.toBuffer();
      if (buffer.length < 64 || file.file.truncated)
        throw new ApiError(
          "INVALID_AUDIO",
          "The recording is empty or too large.",
          400,
        );
      const abort = new AbortController();
      const disconnect = () => {
        if (!reply.raw.writableEnded) abort.abort();
      };
      reply.raw.on("close", disconnect);
      try {
        return await transcriber.transcribe(
          buffer,
          mime,
          AbortSignal.any([
            abort.signal,
            AbortSignal.timeout(config.AI_TIMEOUT_MS),
          ]),
        );
      } finally {
        buffer.fill(0);
        reply.raw.off("close", disconnect);
      }
    },
  );
  app.delete("/api/account", async (request) => {
    for (const [key, controller] of running)
      if (key.startsWith(`${request.actor!.id}:`)) controller.abort();
    await store.deleteAccount(request.actor!.id);
    coach.clearUser(request.actor!.id);
    return { deleted: true };
  });
  app.addHook("onClose", async () => {
    for (const controller of running.values()) controller.abort();
  });
  return app;
}
