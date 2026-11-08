import { z } from "zod";
import { validateAnswers, score } from "../src/domain/quiz";

export const Id = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9_-]+$/);
export const AnswersSchema = z
  .record(z.string(), z.union([z.number(), z.string(), z.array(z.string())]))
  .refine(validateAnswers, "Exactly ten valid screening answers are required");
export const PersonaSchema = z
  .object({
    summary: z.string().trim().min(1).max(600),
    tone: z.array(z.string().trim().min(1).max(40)).max(6),
    pacing: z.enum(["slow", "medium"]),
    do: z.array(z.string().trim().min(1).max(120)).max(6),
    dont: z.array(z.string().trim().min(1).max(120)).max(6),
    exampleVoice: z.string().trim().min(1).max(300),
    source: z.literal("conversation_v1"),
  })
  .strict();
export type Persona = z.infer<typeof PersonaSchema>;
export const ProfileSchema = z
  .object({
    id: Id,
    revision: z.number().int().positive(),
    answers: AnswersSchema,
    comfortScore: z.number().int().min(0).max(100),
    desiredActivityScore: z.number().int().min(0).max(100),
    completedAt: z.iso.datetime(),
    questionnaireVersion: z.literal("1"),
    scoringVersion: z.literal("1"),
    persona: PersonaSchema.optional(),
  })
  .strict()
  .refine(
    (p) =>
      validateAnswers(p.answers) &&
      p.comfortScore ===
        score([1, 2, 3, 4].map((n) => p.answers[`q${n}`] as number)) &&
      p.desiredActivityScore ===
        score([5, 6].map((n) => p.answers[`q${n}`] as number)),
    "Scores must match the answers",
  );
export const AuditSchema = z
  .object({
    source: z.enum(["fixture", "live"]),
    decision: z.enum(["approved", "clarification"]),
    profileId: Id,
    attempts: z.number().int().min(1).max(2),
    summary: z.string().max(800),
    checks: z.array(z.string().max(150)).max(12),
    suggestionVersion: z.string().max(60),
    auditVersion: z.string().max(60),
    models: z
      .object({ conversation: z.string(), audit: z.string() })
      .optional(),
    personalized: z.boolean().optional(),
    checkedAt: z.iso.datetime().optional(),
  })
  .strict();
export const MessageSchema = z
  .object({
    id: Id,
    role: z.enum(["user", "assistant"]),
    text: z.string().min(1).max(6000),
    createdAt: z.iso.datetime(),
    audit: AuditSchema.optional(),
    icebreaker: z.string().max(500).optional(),
    affirmation: z.string().max(300).optional(),
    action: z
      .enum(["start", "follow_up", "another", "simplify", "encourage"])
      .optional(),
    persisted: z.boolean().optional(),
    requestId: Id.optional(),
    requestProfileId: Id.optional(),
    requestPolicy: z.string().max(500).optional(),
  })
  .strict();
export const SessionSchema = z
  .object({
    id: Id,
    title: z.string().min(1).max(80),
    room: z.string().min(1).max(2000),
    scenarioId: z.enum(["games", "garden", "welcome"]).optional(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    messages: z.array(MessageSchema).max(1000),
    persisted: z.boolean().optional(),
    mode: z.enum(["demo", "live"]).optional(),
  })
  .strict();
export const SessionHeaderSchema = SessionSchema.omit({ messages: true });
export const SyncOperationSchema = z.discriminatedUnion("kind", [
  z
    .object({ id: Id, kind: z.literal("profile.put"), profile: ProfileSchema })
    .strict(),
  z
    .object({
      id: Id,
      kind: z.literal("profile.activate"),
      profile: ProfileSchema,
      expectedActiveId: Id.nullable(),
    })
    .strict(),
  z.object({ id: Id, kind: z.literal("profile.delete_all") }).strict(),
  z
    .object({
      id: Id,
      kind: z.literal("profile.redact"),
      profile: ProfileSchema,
      expectedActiveId: Id.nullable(),
    })
    .strict(),
  z
    .object({
      id: Id,
      kind: z.literal("session.put"),
      session: SessionHeaderSchema,
      historyEpoch: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      id: Id,
      kind: z.literal("message.put"),
      sessionId: Id,
      message: MessageSchema,
      historyEpoch: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({ id: Id, kind: z.literal("session.delete"), sessionId: Id })
    .strict(),
  z.object({ id: Id, kind: z.literal("session.delete_all") }).strict(),
]);
export type SyncOperation = z.infer<typeof SyncOperationSchema>;
export const SyncRequestSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    consent: z.literal(true),
    operations: z.array(SyncOperationSchema).max(100),
  })
  .strict();
export type CloudSnapshot = {
  revision: number;
  historyEpoch: number;
  activeProfileId: string | null;
  profiles: z.infer<typeof ProfileSchema>[];
  sessions: z.infer<typeof SessionSchema>[];
};
export const DraftSchema = z
  .object({
    observations: z.array(z.string().min(1).max(350)).max(5),
    opportunity: z.string().max(500).nullable(),
    icebreakers: z.array(z.string().min(1).max(300)).max(3),
    affirmation: z.string().max(250).nullable(),
    reply: z.string().min(1).max(1800),
    needsClarification: z.boolean(),
    clarificationQuestion: z.string().max(300).nullable(),
  })
  .strict();
export type Draft = z.infer<typeof DraftSchema>;
export const ReviewSchema = z
  .object({
    decision: z.enum(["approved", "revise", "clarification"]),
    checks: z
      .array(
        z.enum([
          "profile",
          "explicit_exclusions",
          "evidence",
          "interaction_intensity",
          "accessible_wording",
          "immediate_request",
          "no_inference",
          "persona_fit",
        ]),
      )
      .length(8),
    changes: z.array(z.string().max(300)).max(5),
    clarificationQuestion: z.string().max(300).nullable(),
  })
  .strict();
export type Review = z.infer<typeof ReviewSchema>;
export const SceneSummarySchema = z
  .object({
    captureId: Id,
    observedAt: z.iso.datetime(),
    observations: z.array(z.string().min(1).max(350)).max(8),
    activities: z.array(z.string().min(1).max(200)).max(6),
    readableSigns: z.array(z.string().min(1).max(200)).max(6),
    uncertainties: z.array(z.string().min(1).max(300)).max(6),
    needsClarification: z.boolean(),
    eventKind: z.string().trim().min(1).max(80),
    socialSetup: z.enum([
      "one_to_one_possible",
      "small_group",
      "large_group",
      "structured_activity",
      "unclear",
    ]),
    coachingFocus: z.array(z.string().trim().min(1).max(200)).max(3),
    model: z.string().max(80),
    provenance: z.enum(["phone_camera", "meta_glasses"]),
  })
  .strict();
export type SceneSummary = z.infer<typeof SceneSummarySchema>;
export const SceneResponseSchema = z
  .object({
    scene: SceneSummarySchema,
  })
  .strict();
export type SceneResponse = z.infer<typeof SceneResponseSchema>;
export const QuizChatMessageSchema = z
  .object({
    role: z.enum(["assistant", "user"]),
    text: z.string().trim().min(1).max(2000),
  })
  .strict();
export const QuizTurnRequestSchema = z
  .object({
    messages: z.array(QuizChatMessageSchema).max(24),
    processingConsent: z.literal(true),
    processingProvider: z.literal("gemini"),
  })
  .strict();
export type QuizTurnRequest = z.infer<typeof QuizTurnRequestSchema>;
export const QuizTurnResponseSchema = z
  .object({
    assistantMessage: z.string().min(1).max(800),
    complete: z.boolean(),
    answers: AnswersSchema.optional(),
    persona: PersonaSchema.optional(),
    confirmSummary: z.string().max(600).optional(),
  })
  .strict()
  .refine(
    (v) =>
      !v.complete || (!!v.answers && !!v.persona && !!v.confirmSummary),
    "Complete quiz turns require answers, persona, and confirmSummary",
  );
export type QuizTurnResponse = z.infer<typeof QuizTurnResponseSchema>;
export const CoachRequestSchema = z
  .object({
    requestId: Id,
    sessionId: Id,
    messageId: Id,
    message: z.string().trim().min(1).max(2000),
    action: z.enum(["start", "follow_up", "another", "simplify", "encourage"]),
    expectedProfileVersionId: Id,
    history: z.boolean(),
    shareProfile: z.boolean(),
    affirmations: z.boolean(),
    processingConsent: z.literal(true),
    processingProvider: z.literal("gemini"),
    transientRoom: z
      .object({
        description: z.string().min(1).max(2000),
        scenarioId: z.enum(["games", "garden", "welcome"]).optional(),
      })
      .strict()
      .optional(),
    scene: SceneSummarySchema.optional(),
    /** Local-device mode only: profile payload when cloud sync is off. */
    localProfile: ProfileSchema.optional(),
  })
  .strict()
  .refine(
    (v) => (v.history ? !v.transientRoom : !!v.transientRoom),
    "Transient context is required only when history is off",
  )
  .refine(
    (v) => !(v.localProfile && v.history),
    "localProfile requires history off (transient room coaching)",
  );
export type CoachRequest = z.infer<typeof CoachRequestSchema>;
export const CoachResponseSchema = z
  .object({
    requestId: Id,
    status: z.enum(["approved", "clarification"]),
    message: MessageSchema,
  })
  .strict();
export type CoachResponse = z.infer<typeof CoachResponseSchema>;
export const EventSchema = z.object({
  id: z.string().max(150),
  title: z.string().min(1).max(200),
  date: z.string().datetime({ offset: true }),
  location: z.string().max(200),
  category: z.enum(["Community", "Meetups", "Arts", "Outdoors", "Games"]),
  note: z.string().max(600),
  url: z.url().refine((v) => v.startsWith("https://")),
  dateSource: z.url(),
});
export const EventsResponseSchema = z.object({
  events: z.array(EventSchema).max(250),
  fetchedAt: z.string().datetime().nullable(),
  stale: z.boolean(),
  source: z.enum(["organizer", "cache", "seed"]),
  warning: z.string().nullable(),
});
export type EventsResponse = z.infer<typeof EventsResponseSchema>;
