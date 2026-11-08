import { createHash, randomUUID } from "node:crypto";
import {
  CoachRequest,
  CoachResponse,
  CoachResponseSchema,
  Draft,
  DraftSchema,
  ReviewSchema,
} from "../../shared/contracts";
import { Profile, Session } from "../../src/domain/types";
import { preference, requireProfile } from "../../src/domain/quiz";
import type { Agents, AgentInput } from "../providers/agents";
import { Store } from "../store";
import { ApiError } from "../errors";
import { Config, LOCAL_DEV_USER } from "../config";
import { AUDIT_VERSION, SUGGESTION_VERSION } from "../agents/prompts";

const checks = [
  "profile",
  "explicit_exclusions",
  "evidence",
  "interaction_intensity",
  "accessible_wording",
  "immediate_request",
  "no_inference",
  "persona_fit",
] as const;
async function stage<T>(
  factory: (signal: AbortSignal) => Promise<T>,
  parent: AbortSignal,
  timeout: number,
  name: string,
): Promise<T> {
  const signal = AbortSignal.any([parent, AbortSignal.timeout(timeout)]);
  signal.throwIfAborted();
  let abort: () => void = () => {};
  const deadline = new Promise<never>((_, reject) => {
    abort = () =>
      reject(
        new ApiError(
          "STAGE_TIMEOUT",
          `${name} was interrupted or timed out. No unchecked response was released.`,
          504,
          name,
        ),
      );
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    return await Promise.race([factory(signal), deadline]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
type Transient = {
  hashes: Map<string, string>;
  responses: Map<string, CoachResponse>;
  session: Session;
  expires: number;
};
export class Coach {
  private transient = new Map<string, Transient>();
  constructor(
    private store: Store,
    private agents: Agents,
    private config: Config,
  ) {}
  clearUser(userId: string) {
    for (const key of this.transient.keys())
      if (key.startsWith(`${userId}:`)) this.transient.delete(key);
  }
  private input(
    request: CoachRequest,
    profile: Profile,
    session: Session,
  ): AgentInput {
    return {
      room: session.room,
      profile: request.shareProfile
        ? {
            comfortScore: profile.comfortScore,
            desiredActivityScore: profile.desiredActivityScore,
            interactionStyle: profile.answers.q7,
            communication: profile.answers.q8,
            access: profile.answers.q9,
            support: profile.answers.q10,
          }
        : null,
      request: request.message,
      action: request.action,
      history: session.messages
        .filter((m) => m.id !== request.messageId)
        .slice(-12)
        .map((m) => ({
          role: m.role,
          text: [m.text, m.icebreaker, m.affirmation]
            .filter(Boolean)
            .join("\n")
            .slice(0, 3000),
        })),
      affirmations: request.affirmations,
      scene: request.scene ?? null,
    };
  }
  private hardChecks(draft: Draft, profile: Profile, request: CoachRequest) {
    if (
      draft.needsClarification &&
      (draft.opportunity !== null ||
        draft.icebreakers.length ||
        draft.affirmation !== null ||
        !draft.clarificationQuestion)
    )
      return [
        "Clarification must contain no social recommendation or affirmation and must ask one question.",
      ];
    if (!request.affirmations && draft.affirmation)
      return ["Remove the affirmation: the user disabled encouragement."];
    if (
      preference(profile, "q10", "No coaching right now") &&
      (draft.opportunity || draft.icebreakers.length)
    )
      return [
        "The user requested no coaching. Remove every social-action recommendation.",
      ];
    if (preference(profile, "q8", "Short wording") && draft.reply.length > 450)
      return [
        "Use shorter wording: the user explicitly requested concise communication.",
      ];
    return [];
  }
  async run(
    userId: string,
    request: CoachRequest,
    signal: AbortSignal,
  ): Promise<CoachResponse> {
    const hash = createHash("sha256")
      .update(JSON.stringify(request))
      .digest("hex");
    let profile: Profile, session: Session, transient: Transient | undefined;
    if (request.history) {
      const context = await this.store.reserve(userId, request, hash);
      if (context.cached) return CoachResponseSchema.parse(context.cached);
      ({ profile, session } = context);
    } else {
      for (const [key, value] of this.transient)
        if (value.expires < Date.now()) this.transient.delete(key);
      if (request.localProfile) {
        if (userId !== LOCAL_DEV_USER)
          throw new ApiError(
            "LOCAL_PROFILE_DENIED",
            "Device-local profiles are only accepted in local development mode.",
            403,
          );
        if (request.localProfile.id !== request.expectedProfileVersionId)
          throw new ApiError(
            "STALE_PROFILE",
            "Your profile changed. Retry with the current profile.",
            409,
          );
        profile = request.localProfile;
      } else {
        const snapshot = await this.store.snapshot(userId);
        profile = snapshot.profiles.find(
          (p) => p.id === snapshot.activeProfileId,
        )!;
        if (!profile)
          throw new ApiError(
            "SCREENING_REQUIRED",
            "Complete and sync your profile first.",
            403,
          );
        await this.store.assertProfile(
          userId,
          request.expectedProfileVersionId,
        );
      }
      const key = `${userId}:${request.sessionId}`;
      transient = this.transient.get(key);
      if (!transient) {
        if (this.transient.size >= 500)
          throw new ApiError(
            "CAPACITY",
            "Temporary coaching is busy. Retry shortly.",
            503,
          );
        const now = new Date().toISOString();
        transient = {
          hashes: new Map(),
          responses: new Map(),
          expires: Date.now() + 15 * 60_000,
          session: {
            id: request.sessionId,
            title: "Temporary conversation",
            room: request.transientRoom!.description,
            createdAt: now,
            updatedAt: now,
            messages: [],
          },
        };
        this.transient.set(key, transient);
      }
      if (transient.session.room !== request.transientRoom!.description)
        throw new ApiError(
          "ROOM_CHANGED",
          "Start a new chat for a new room.",
          409,
        );
      const previousHash = transient.hashes.get(request.requestId);
      if (previousHash && previousHash !== hash)
        throw new ApiError(
          "IDEMPOTENCY_CONFLICT",
          "Use a new request for changed content.",
          409,
        );
      const cached = transient.responses.get(request.requestId);
      if (cached) return cached;
      transient.hashes.set(request.requestId, hash);
      session = transient.session;
    }
    try {
      requireProfile(profile);
      if (preference(profile, "q10", "No coaching right now"))
        throw new ApiError(
          "COACHING_PAUSED",
          "Your profile pauses coaching. You can browse events or change your support preference in Settings.",
          403,
        );
      if (profile.id !== request.expectedProfileVersionId)
        throw new ApiError(
          "STALE_PROFILE",
          "Your profile changed. Sync and retry.",
          409,
        );
      const input = this.input(request, profile, session);
      let draft: Draft | undefined,
        changes: string[] = [],
        attempts = 0;
      let approved = false,
        clarification = false;
      for (let attempt = 1; attempt <= 2; attempt++) {
        attempts = attempt;
        signal.throwIfAborted();
        const revision = draft ? { draft, changes } : undefined;
        draft = DraftSchema.parse(
          await stage(
            (s) => this.agents.suggest(input, s, revision),
            signal,
            this.config.AI_TIMEOUT_MS,
            "suggestion",
          ),
        );
        const candidate = draft;
        const review = ReviewSchema.parse(
          await stage(
            (s) => this.agents.review(input, candidate, s),
            signal,
            this.config.AI_TIMEOUT_MS,
            "audit",
          ),
        );
        if (checks.some((c) => !review.checks.includes(c)))
          throw new ApiError(
            "INVALID_AUDIT",
            "The review did not cover all required checks. Nothing was released.",
            502,
            "audit",
          );
        const hard = this.hardChecks(draft, profile, request);
        if (review.decision === "clarification") {
          clarification = true;
          approved = true;
          break;
        }
        if (review.decision === "approved" && !hard.length) {
          approved = true;
          clarification = draft.needsClarification;
          break;
        }
        changes = [...review.changes, ...hard];
      }
      if (!approved || !draft)
        throw new ApiError(
          "AUDIT_REJECTED",
          "The response did not pass its second check. No guidance was released. Try a clearer description or a different request.",
          422,
          "audit",
        );
      signal.throwIfAborted();
      await this.store.assertProfile(userId, profile.id);
      const response: CoachResponse = {
        requestId: request.requestId,
        status: clarification ? "clarification" : "approved",
        message: {
          id: randomUUID(),
          role: "assistant",
          createdAt: new Date().toISOString(),
          persisted: request.history,
          requestId: request.requestId,
          text: clarification
            ? "What activity or welcome sign can you directly see, and what would you like help with?"
            : [
                ...draft.observations.map((o) =>
                  request.scene
                    ? `From your glasses still: ${o}`
                    : `From your description: ${o}`,
                ),
                draft.reply,
                draft.opportunity,
              ]
                .filter(Boolean)
                .join("\n\n"),
          ...(clarification || !draft.icebreakers.length
            ? {}
            : { icebreaker: draft.icebreakers[0] }),
          ...(clarification || !draft.affirmation || !request.affirmations
            ? {}
            : { affirmation: draft.affirmation }),
          audit: {
            source: "live",
            decision: clarification ? "clarification" : "approved",
            profileId: profile.id,
            attempts,
            summary: clarification
              ? "The independent auditor requested more evidence. No social-action recommendation was released."
              : request.shareProfile
                ? `The exact response passed the independent check${attempts === 2 ? " after one revision" : ""}. AI review can still be wrong.`
                : "Generic guidance passed an independent evidence and suitability check. Your profile answers were not shared with the models.",
            checks: [...checks],
            suggestionVersion: SUGGESTION_VERSION,
            auditVersion: AUDIT_VERSION,
            models: {
              conversation: this.config.CONVERSATION_MODEL,
              audit: this.config.AUDIT_MODEL,
            },
            personalized: request.shareProfile,
            checkedAt: new Date().toISOString(),
          },
        },
      };
      const parsed = CoachResponseSchema.parse(response);
      if (request.history)
        await this.store.finish(userId, request, hash, parsed);
      else {
        transient!.responses.set(request.requestId, parsed);
        transient!.session.messages = [
          ...session.messages,
          {
            id: request.messageId,
            role: "user" as const,
            text: request.message,
            createdAt: new Date().toISOString(),
          },
          parsed.message,
        ].slice(-12);
        // Bound transient request metadata as well as content. A restart/15m expiry clears it.
        if (transient!.responses.size > 30) {
          const oldest = transient!.responses.keys().next().value!;
          transient!.responses.delete(oldest);
          transient!.hashes.delete(oldest);
        }
      }
      return parsed;
    } catch (error) {
      if (request.history)
        await this.store.fail(userId, request.requestId).catch(() => {});
      if (error instanceof ApiError) throw error;
      throw new ApiError(
        signal.aborted ? "CANCELLED" : "INVALID_PROVIDER_OUTPUT",
        "This turn could not be validated. No unchecked advice was released.",
        signal.aborted ? 499 : 502,
      );
    }
  }
}
