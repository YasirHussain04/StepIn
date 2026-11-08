import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { buildApp } from "../server/app";
import { readConfig } from "../server/config";
import type { Agents } from "../server/providers/agents";
import {
  CoachRequest,
  Draft,
  Review,
  SyncOperation,
  SyncOperationSchema,
} from "../shared/contracts";
import { createProfile } from "../src/domain/quiz";
import { Answers, Session } from "../src/domain/types";
import { PgStore, postgres, USER_A, USER_B } from "./helpers/pgStore";
const answers = (): Answers => ({
  q1: 2,
  q2: 2,
  q3: 2,
  q4: 2,
  q5: 5,
  q6: 5,
  q7: "One to one",
  q8: ["Prefer not to say"],
  q9: ["Prefer not to say"],
  q10: ["A low-pressure first step"],
});
const draft = (): Draft => ({
  observations: ["You described a game table."],
  opportunity: "Ask whether the open seat is available.",
  icebreakers: ["Is this game open to another player?"],
  affirmation: null,
  reply: "One small question is enough to start.",
  needsClarification: false,
  clarificationQuestion: null,
});
const review = (): Review => ({
  decision: "approved",
  checks: [
    "profile",
    "explicit_exclusions",
    "evidence",
    "interaction_intensity",
    "accessible_wording",
    "immediate_request",
    "no_inference",
    "persona_fit",
  ],
  changes: [],
  clarificationQuestion: null,
});
let db: PGlite;
let store: PgStore;
beforeAll(async () => {
  db = await postgres();
  store = new PgStore(db);
}, 60_000);
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.exec("delete from public.stepin_accounts");
});
async function seed(user = USER_A, changes: Answers = {}) {
  const profile = createProfile({ ...answers(), ...changes }, 1);
  const now = new Date().toISOString();
  const session: Session = {
    id: randomUUID(),
    title: "Game practice",
    room: "A game table has an open chair.",
    mode: "live",
    createdAt: now,
    updatedAt: now,
    messages: [],
    persisted: true,
  };
  const { messages, ...header } = session;
  await store.sync(user, 0, [
    {
      id: randomUUID(),
      kind: "profile.activate",
      profile,
      expectedActiveId: null,
    },
    { id: randomUUID(), kind: "session.put", session: header, historyEpoch: 0 },
  ]);
  return { profile, session };
}
function request(profileId: string, sessionId: string): CoachRequest {
  return {
    requestId: randomUUID(),
    messageId: randomUUID(),
    sessionId,
    message: "Help me get started",
    action: "start",
    expectedProfileVersionId: profileId,
    history: true,
    shareProfile: true,
    affirmations: false,
    processingConsent: true,
    processingProvider: "gemini",
  };
}
const config = () => readConfig({ NODE_ENV: "test", AI_TIMEOUT_MS: "1000" });
function fakeAgents(): Agents {
  return {
    suggest: vi.fn(async () => draft()),
    review: vi.fn(async () => review()),
  };
}
const headers = { authorization: "Bearer test-user-a" };
describe("PostgreSQL migration, ownership and sync", () => {
  it("rejects a coaching message ID reused for different content before calling models", async () => {
    const { profile, session } = await seed();
    const body = request(profile.id, session.id);
    const snapshot = await store.snapshot(USER_A);
    await store.sync(USER_A, snapshot.revision, [
      {
        id: randomUUID(),
        kind: "message.put",
        sessionId: session.id,
        historyEpoch: 0,
        message: {
          id: body.messageId,
          role: "user",
          text: "A different saved request",
          action: "start",
          createdAt: new Date().toISOString(),
        },
      },
    ]);
    const agents = fakeAgents();
    const app = await buildApp(config(), { store, agents });
    const response = await app.inject({
      method: "POST",
      url: "/api/coach",
      headers,
      payload: body,
    });
    expect(response.statusCode).toBe(409);
    expect(agents.suggest).not.toHaveBeenCalled();
    expect((await store.snapshot(USER_A)).sessions[0].messages).toHaveLength(1);
    await app.close();
  });
  it("validates required screening in SQL and rejects sensitive exclusive combinations", async () => {
    for (let q = 1; q <= 10; q++) {
      const a = answers();
      delete a[`q${q}`];
      const result = await db.query<{ valid: boolean }>(
        "select stepin_valid_answers($1::jsonb) as valid",
        [JSON.stringify(a)],
      );
      expect(result.rows[0].valid).toBe(false);
    }
    for (const a of [
      { ...answers(), extra: 1 },
      { ...answers(), q1: "2" },
      { ...answers(), q8: ["None", "Short wording"] },
      { ...answers(), q9: ["Visual access", "Visual access"] },
    ])
      expect(
        (
          await db.query<{ valid: boolean }>(
            "select stepin_valid_answers($1::jsonb) as valid",
            [JSON.stringify(a)],
          )
        ).rows[0].valid,
      ).toBe(false);
    expect(
      (
        await db.query<{ valid: boolean }>(
          "select stepin_valid_answers($1::jsonb) as valid",
          [JSON.stringify(answers())],
        )
      ).rows[0].valid,
    ).toBe(true);
  });
  it("activates and scores a version transactionally, leaving old versions intact", async () => {
    const { profile } = await seed();
    const next = createProfile({ ...answers(), q1: 5 }, 2);
    const state = await store.snapshot(USER_A);
    const updated = await store.sync(USER_A, state.revision, [
      {
        id: randomUUID(),
        kind: "profile.activate",
        profile: next,
        expectedActiveId: profile.id,
      },
    ]);
    expect(updated.activeProfileId).toBe(next.id);
    expect(updated.profiles).toHaveLength(2);
    expect(updated.profiles.find((p) => p.id === next.id)?.comfortScore).toBe(
      44,
    );
    await expect(
      store.sync(USER_A, state.revision, [
        { id: randomUUID(), kind: "profile.delete_all" },
      ]),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    expect((await store.snapshot(USER_A)).profiles).toHaveLength(2);
  });
  it("rejects stale active pointers and rolls back every earlier operation in the batch", async () => {
    const { session } = await seed();
    const state = await store.snapshot(USER_A);
    const next = createProfile(answers(), 2);
    await expect(
      store.sync(USER_A, state.revision, [
        { id: randomUUID(), kind: "session.delete", sessionId: session.id },
        {
          id: randomUUID(),
          kind: "profile.activate",
          profile: next,
          expectedActiveId: null,
        },
      ]),
    ).rejects.toMatchObject({ code: "PROFILE_CONFLICT" });
    expect((await store.snapshot(USER_A)).sessions).toHaveLength(1);
  });
  it("deduplicates operation IDs and rejects the same ID with a changed payload", async () => {
    const { session } = await seed();
    const state = await store.snapshot(USER_A);
    const op: SyncOperation = {
      id: randomUUID(),
      kind: "session.delete",
      sessionId: session.id,
    };
    const first = await store.sync(USER_A, state.revision, [op]);
    const second = await store.sync(USER_A, state.revision, [op]);
    expect(first.revision).toBe(second.revision);
    await expect(
      store.sync(USER_A, second.revision, [{ ...op, sessionId: "other" }]),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });
  it("prevents session resurrection, including old offline creations after delete-all", async () => {
    const { session } = await seed();
    const state = await store.snapshot(USER_A);
    const { messages, ...header } = session;
    const cleared = await store.sync(USER_A, state.revision, [
      { id: randomUUID(), kind: "session.delete_all" },
    ]);
    const stale = await store.sync(USER_A, cleared.revision, [
      {
        id: randomUUID(),
        kind: "session.put",
        session: header,
        historyEpoch: 0,
      },
      {
        id: randomUUID(),
        kind: "session.put",
        session: { ...header, id: "old-offline-session" },
        historyEpoch: 0,
      },
    ]);
    expect(stale.sessions).toHaveLength(0);
    const fresh = await store.sync(USER_A, stale.revision, [
      {
        id: randomUUID(),
        kind: "session.put",
        session: { ...header, id: "fresh-session" },
        historyEpoch: stale.historyEpoch,
      },
    ]);
    expect(fresh.sessions).toHaveLength(1);
  });
  it("removes sensitive answers from every profile and restores the gate on profile deletion", async () => {
    const { profile } = await seed(USER_A, {
      q8: ["Short wording"],
      q9: ["Hearing access"],
    });
    const state = await store.snapshot(USER_A);
    const next = createProfile(answers(), 2);
    const redacted = await store.sync(USER_A, state.revision, [
      {
        id: randomUUID(),
        kind: "profile.redact",
        profile: next,
        expectedActiveId: profile.id,
      },
    ]);
    for (const p of redacted.profiles) {
      expect(p.answers.q8).toEqual(["Prefer not to say"]);
      expect(p.answers.q9).toEqual(["Prefer not to say"]);
    }
    await store.sync(USER_A, redacted.revision, [
      { id: randomUUID(), kind: "profile.delete_all" },
    ]);
    await expect(store.assertProfile(USER_A, next.id)).rejects.toMatchObject({
      code: "SCREENING_REQUIRED",
    });
  });
  it("enforces RLS reads and forbids direct client writes or mutation RPC calls", async () => {
    await seed(USER_A);
    await seed(USER_B);
    await db.exec(
      `set role authenticated; set request.jwt.claim.sub='${USER_A}';`,
    );
    try {
      const rows = await db.query<{ user_id: string }>(
        "select user_id from stepin_sessions",
      );
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0].user_id).toBe(USER_A);
      await expect(db.query("delete from stepin_sessions")).rejects.toThrow(
        /permission denied/,
      );
      await expect(
        db.query("select stepin_snapshot($1::uuid)", [USER_B]),
      ).rejects.toThrow(/permission denied/);
    } finally {
      await db.exec("reset role");
    }
  });
});
describe("authenticated API and fail-closed agent coordination", () => {
  it("rejects old provider-agnostic processing consent before contacting either agent", async () => {
    const { profile, session } = await seed();
    const agents = fakeAgents();
    const app = await buildApp(config(), { store, agents });
    const { processingProvider, ...legacy } = request(profile.id, session.id);
    const response = await app.inject({
      method: "POST",
      url: "/api/coach",
      headers,
      payload: legacy,
    });
    expect(response.statusCode).toBe(400);
    expect(agents.suggest).not.toHaveBeenCalled();
    expect(agents.review).not.toHaveBeenCalled();
    await app.close();
  });
  it("exposes capabilities without claiming configured keys were verified", async () => {
    const app = await buildApp(config(), { store, agents: fakeAgents() });
    const r = await app.inject({ url: "/health" });
    expect(r.statusCode).toBe(200);
    expect(r.json().capabilities.coaching).toBe(false);
    expect(r.json().models.conversation).toBe("gemini-3.8-flash");
    expect(r.json().models.audit).toBe("gemini-3.8-flash");
    expect((await app.inject({ url: "/api/profile" })).statusCode).toBe(401);
    await app.close();
  });
  it("uses the Gemini key for coaching capabilities and ignores the retired provider key", async () => {
    for (const [env, enabled] of [
      [{ GEMINI_API_KEY: "test-only-key" }, true],
      [{ OPENAI_API_KEY: "retired-test-key" }, false],
    ] as const) {
      const app = await buildApp(readConfig({ NODE_ENV: "test", ...env }), {
        store,
        agents: fakeAgents(),
      });
      const response = await app.inject({ url: "/health" });
      expect(response.json().capabilities.coaching).toBe(enabled);
      expect(response.json().capabilities.transcription).toBe(enabled);
      await app.close();
    }
  });
  it("cannot read another user's session or audit", async () => {
    const { session } = await seed(USER_B);
    const app = await buildApp(config(), { store, agents: fakeAgents() });
    expect(
      (
        await app.inject({
          url: `/api/sessions/${session.id}/messages`,
          headers,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ url: "/api/messages/unknown/audit", headers }))
        .statusCode,
    ).toBe(404);
    await app.close();
  });
  it("releases only a fully checked response and deduplicates a retried request", async () => {
    const { profile, session } = await seed();
    const agents = fakeAgents();
    const app = await buildApp(config(), { store, agents });
    const body = request(profile.id, session.id);
    const first = await app.inject({
      method: "POST",
      url: "/api/coach",
      headers,
      payload: body,
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().message.audit.source).toBe("live");
    expect(agents.review).toHaveBeenCalledWith(
      expect.anything(),
      draft(),
      expect.any(AbortSignal),
    );
    const second = await app.inject({
      method: "POST",
      url: "/api/coach",
      headers,
      payload: body,
    });
    expect(second.json()).toEqual(first.json());
    expect(agents.suggest).toHaveBeenCalledTimes(1);
    expect((await store.snapshot(USER_A)).sessions[0].messages).toHaveLength(2);
    const changed = await app.inject({
      method: "POST",
      url: "/api/coach",
      headers,
      payload: { ...body, message: "different" },
    });
    expect(changed.statusCode).toBe(409);
    await app.close();
  });
  it("revises and re-audits once, never releasing a rejected draft", async () => {
    const { profile, session } = await seed();
    const agents = fakeAgents();
    vi.mocked(agents.suggest)
      .mockResolvedValueOnce({
        ...draft(),
        reply: "Rejected candidate must stay private",
      })
      .mockResolvedValueOnce(draft());
    vi.mocked(agents.review)
      .mockResolvedValueOnce({
        ...review(),
        decision: "revise",
        changes: ["Use one small question."],
      })
      .mockResolvedValueOnce(review());
    const app = await buildApp(config(), { store, agents });
    const response = await app.inject({
      method: "POST",
      url: "/api/coach",
      headers,
      payload: request(profile.id, session.id),
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain("Rejected candidate");
    expect(response.json().message.audit.attempts).toBe(2);
    expect(agents.review).toHaveBeenCalledTimes(2);
    await app.close();
  });
  it.each(["rejection", "malformed audit", "unchecked draft", "missing check"])(
    "fails closed on %s",
    async (kind) => {
      const { profile, session } = await seed();
      const agents = fakeAgents();
      if (kind === "rejection")
        vi.mocked(agents.review).mockResolvedValue({
          ...review(),
          decision: "revise",
          changes: ["Unsuitable"],
        });
      if (kind === "malformed audit")
        vi.mocked(agents.review).mockResolvedValue({ approved: true });
      if (kind === "unchecked draft")
        vi.mocked(agents.suggest).mockResolvedValue({
          ...draft(),
          rawAudio: "forbidden",
        });
      if (kind === "missing check")
        vi.mocked(agents.review).mockResolvedValue({
          ...review(),
          checks: ["profile"],
        });
      const app = await buildApp(config(), { store, agents });
      const response = await app.inject({
        method: "POST",
        url: "/api/coach",
        headers,
        payload: request(profile.id, session.id),
      });
      expect(response.statusCode).toBeGreaterThanOrEqual(400);
      expect(response.body).not.toContain("One small question");
      expect((await store.snapshot(USER_A)).sessions[0].messages).toHaveLength(
        0,
      );
      expect(agents.suggest).toHaveBeenCalledTimes(
        kind === "rejection" ? 2 : 1,
      );
      await app.close();
    },
  );
  it("rejects a stale profile activated during generation", async () => {
    const { profile, session } = await seed();
    const agents = fakeAgents();
    vi.mocked(agents.suggest).mockImplementation(async () => {
      const state = await store.snapshot(USER_A);
      await store.sync(USER_A, state.revision, [
        {
          id: randomUUID(),
          kind: "profile.activate",
          profile: createProfile({ ...answers(), q1: 5 }, 2),
          expectedActiveId: profile.id,
        },
      ]);
      return draft();
    });
    const app = await buildApp(config(), { store, agents });
    const response = await app.inject({
      method: "POST",
      url: "/api/coach",
      headers,
      payload: request(profile.id, session.id),
    });
    expect(response.statusCode).toBe(409);
    expect((await store.snapshot(USER_A)).sessions[0].messages).toHaveLength(0);
    await app.close();
  });
  it("times out a provider without releasing a partial candidate", async () => {
    const { profile, session } = await seed();
    const agents = fakeAgents();
    vi.mocked(agents.review).mockImplementation(
      (_input, _draft, signal) =>
        new Promise((_, reject) =>
          signal.addEventListener("abort", () => reject(new Error("Timeout")), {
            once: true,
          }),
        ),
    );
    const app = await buildApp(config(), { store, agents });
    const response = await app.inject({
      method: "POST",
      url: "/api/coach",
      headers,
      payload: request(profile.id, session.id),
    });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect((await store.snapshot(USER_A)).sessions[0].messages).toHaveLength(0);
    await app.close();
  });
  it("keeps history-off turns out of database messages and run records while retaining transient follow-up context", async () => {
    const { profile } = await seed();
    const agents = fakeAgents();
    const app = await buildApp(config(), { store, agents });
    const body = {
      ...request(profile.id, "temporary-session"),
      history: false,
      shareProfile: false,
      transientRoom: { description: "An open game table" },
    };
    const first = await app.inject({
      method: "POST",
      url: "/api/coach",
      headers,
      payload: body,
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().message.audit.personalized).toBe(false);
    expect(vi.mocked(agents.suggest).mock.calls[0][0].profile).toBeNull();
    const second = await app.inject({
      method: "POST",
      url: "/api/coach",
      headers,
      payload: {
        ...body,
        requestId: randomUUID(),
        messageId: randomUUID(),
        action: "follow_up",
        message: "Make it simpler",
      },
    });
    expect(second.statusCode).toBe(200);
    expect(vi.mocked(agents.suggest).mock.calls[1][0].history).toHaveLength(2);
    expect(
      (
        await db.query<{ count: number }>(
          "select count(*)::int as count from stepin_coach_runs",
        )
      ).rows[0].count,
    ).toBe(0);
    expect((await store.snapshot(USER_A)).sessions[0].messages).toHaveLength(0);
    await app.close();
  });
  it("requires image consent for scene analysis and clears uploaded still buffers", async () => {
    let seen: Buffer | null = null;
    const sceneAnalyzer = {
      summarize: vi.fn(async (frames: { bytes: Buffer }[]) => {
        seen = frames[0].bytes;
        return {
          captureId: "sceneCaptureTest0000001",
          observedAt: new Date().toISOString(),
          observations: ["A welcome table is visible."],
          activities: ["Board games"],
          readableSigns: ["Welcome"],
          uncertainties: [],
          needsClarification: false,
          eventKind: "meetup",
          socialSetup: "small_group" as const,
          coachingFocus: ["Welcome table near the door"],
          model: "test-scene",
          provenance: "meta_glasses" as const,
        };
      }),
    };
    const app = await buildApp(config(), {
      store,
      agents: fakeAgents(),
      sceneAnalyzer,
    });
    const boundary = "stepin-scene-boundary";
    const payload = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="still.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`,
      ),
      Buffer.alloc(128, 2),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const imageHeaders = {
      ...headers,
      "content-type": `multipart/form-data; boundary=${boundary}`,
    };
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/scene",
          headers: imageHeaders,
          payload,
        })
      ).statusCode,
    ).toBe(403);
    const result = await app.inject({
      method: "POST",
      url: "/api/scene",
      headers: { ...imageHeaders, "x-image-consent": "true" },
      payload,
    });
    expect(result.statusCode).toBe(200);
    expect(result.json().scene.provenance).toBe("meta_glasses");
    expect(seen).not.toBeNull();
    expect((seen as unknown as Buffer).every((v) => v === 0)).toBe(true);
    await app.close();
  });
  it("requires explicit audio consent, bounds recordings, and erases uploaded buffers after transcription", async () => {
    let seen: Buffer | null = null;
    const transcriber = {
      transcribe: vi.fn(async (buffer: Buffer) => {
        seen = buffer;
        return { text: "Hello there", model: "test-transcription" };
      }),
    };
    const app = await buildApp(config(), {
      store,
      agents: fakeAgents(),
      transcriber,
    });
    const boundary = "stepin-test-boundary";
    const payload = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="voice.m4a"\r\nContent-Type: audio/mp4\r\n\r\n`,
      ),
      Buffer.alloc(128, 1),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const audioHeaders = {
      ...headers,
      "content-type": `multipart/form-data; boundary=${boundary}`,
      "x-recording-duration": "3",
    };
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/transcribe",
          headers: audioHeaders,
          payload,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/transcribe",
          headers: {
            ...audioHeaders,
            "x-audio-consent": "true",
            "x-recording-duration": "46",
          },
          payload,
        })
      ).statusCode,
    ).toBe(400);
    const result = await app.inject({
      method: "POST",
      url: "/api/transcribe",
      headers: { ...audioHeaders, "x-audio-consent": "true" },
      payload,
    });
    expect(result.statusCode).toBe(200);
    expect(result.json().text).toBe("Hello there");
    expect(seen).not.toBeNull();
    expect((seen as unknown as Buffer).every((v) => v === 0)).toBe(true);
    await app.close();
  });
  it("rejects forged assistant messages and incomplete activation payloads before storage", async () => {
    const { profile, session } = await seed();
    const state = await store.snapshot(USER_A);
    const app = await buildApp(config(), { store, agents: fakeAgents() });
    const response = await app.inject({
      method: "POST",
      url: "/api/sync",
      headers,
      payload: {
        expectedRevision: state.revision,
        consent: true,
        operations: [
          {
            id: randomUUID(),
            kind: "message.put",
            sessionId: session.id,
            historyEpoch: 0,
            message: {
              id: randomUUID(),
              role: "assistant",
              text: "Forged",
              createdAt: new Date().toISOString(),
              audit: {
                source: "live",
                decision: "approved",
                profileId: profile.id,
                attempts: 1,
                summary: "Fake",
                checks: [],
                suggestionVersion: "fake",
                auditVersion: "fake",
              },
            },
          },
        ],
      },
    });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect((await store.snapshot(USER_A)).sessions[0].messages).toHaveLength(0);
    expect(
      SyncOperationSchema.safeParse({
        id: randomUUID(),
        kind: "profile.activate",
        profile: { ...profile, answers: {} },
        expectedActiveId: profile.id,
      }).success,
    ).toBe(false);
    await app.close();
  });
});
