import { describe, expect, it, vi } from "vitest";
import {
  GoogleGenAI,
  FinishReason,
  GenerateContentResponse,
  ApiError as GeminiApiError,
} from "@google/genai";
import { GeminiAgents } from "../server/providers/gemini";
import { AgentInput } from "../server/providers/agents";
import { readConfig } from "../server/config";
import { Draft, Review } from "../shared/contracts";
import { AUDIT_PROMPT, SUGGESTION_PROMPT } from "../server/agents/prompts";
import { hasGeminiConsent, INITIAL_STATE } from "../src/domain/types";

const input: AgentInput = {
  room: "A game table has an open seat.",
  profile: null,
  request: "Help me get started",
  action: "start",
  history: [],
  affirmations: false,
};
const draft: Draft = {
  observations: ["You described an open seat."],
  opportunity: "Ask whether you can join.",
  icebreakers: ["Is there room for another player?"],
  affirmation: null,
  reply: "One short question is an option.",
  needsClarification: false,
  clarificationQuestion: null,
};
const review: Review = {
  decision: "approved",
  checks: [
    "profile",
    "explicit_exclusions",
    "evidence",
    "interaction_intensity",
    "accessible_wording",
    "immediate_request",
    "no_inference",
  ],
  changes: [],
  clarificationQuestion: null,
};
const config = () =>
  readConfig({
    GEMINI_API_KEY: "test-only-key",
    CONVERSATION_MODEL: "gemini-3.8-flash",
    AUDIT_MODEL: "gemini-3.8-flash",
  });
const result = (value: unknown): GenerateContentResponse =>
  Object.assign(new GenerateContentResponse(), {
    candidates: [
      {
        finishReason: FinishReason.STOP,
        content: { role: "model", parts: [{ text: JSON.stringify(value) }] },
      },
    ],
  });
function stub(response: GenerateContentResponse) {
  const generateContent = vi.fn(async () => response);
  return {
    generateContent,
    agents: new GeminiAgents(config(), { models: { generateContent } }),
  };
}
describe("two Gemini coaching agents", () => {
  it.each([
    [400, "API_KEY_INVALID", "GEMINI_KEY_INVALID", 502],
    [401, "private diagnostic", "GEMINI_ACCESS_DENIED", 502],
    [403, "private diagnostic", "GEMINI_ACCESS_DENIED", 502],
    [404, "private diagnostic", "GEMINI_MODEL_UNAVAILABLE", 502],
    [429, "private diagnostic", "GEMINI_RATE_LIMITED", 429],
    [503, "private diagnostic", "GEMINI_UNAVAILABLE", 503],
    [400, "private diagnostic", "GEMINI_REQUEST_FAILED", 502],
  ])(
    "returns a safe actionable error for Gemini HTTP %s",
    async (status, message, code, responseStatus) => {
      const { agents, generateContent } = stub(result(draft));
      generateContent.mockRejectedValue(
        new GeminiApiError({ status, message }),
      );
      await expect(
        agents.suggest(input, new AbortController().signal),
      ).rejects.toMatchObject({
        code,
        status: responseStatus,
        message: expect.not.stringContaining("private diagnostic"),
      });
    },
  );
  it("uses the official SDK for separate structured suggestion and exact-candidate audit calls", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(result(draft)), {
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(result(review)), {
          headers: { "content-type": "application/json" },
        }),
      );
    const sdk = new GoogleGenAI({
      apiKey: "test-only-key",
      httpOptions: { fetch: fetcher, retryOptions: { attempts: 1 } },
    });
    const agents = new GeminiAgents(config(), sdk);
    const signal = new AbortController().signal;
    const candidate = await agents.suggest(input, signal);
    expect(await agents.review(input, candidate, signal)).toEqual(review);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const bodies = fetcher.mock.calls.map(([url, init]) => {
      expect(String(url)).toMatch(
        /^https:\/\/generativelanguage.googleapis.com\/.*models\/gemini-3.8-flash:generateContent$/,
      );
      return JSON.parse(String(init?.body));
    });
    expect(bodies[0].systemInstruction.parts[0].text).toBe(SUGGESTION_PROMPT);
    expect(bodies[1].systemInstruction.parts[0].text).toBe(AUDIT_PROMPT);
    expect(JSON.parse(bodies[0].contents[0].parts[0].text)).toEqual({
      input,
      revision: null,
    });
    expect(JSON.parse(bodies[1].contents[0].parts[0].text)).toEqual({
      input,
      exactCandidate: candidate,
    });
    expect(bodies[0].generationConfig.responseMimeType).toBe(
      "application/json",
    );
    expect(
      bodies[1].generationConfig.responseJsonSchema.properties.decision.enum,
    ).toEqual(["approved", "revise", "clarification"]);
    expect(bodies[1].generationConfig.responseJsonSchema.required).toContain(
      "checks",
    );
  });
  it("passes the rejected candidate and review feedback only to the revision call", async () => {
    const { agents, generateContent } = stub(result(draft));
    const revision = { draft, changes: ["Make the first step shorter."] };
    await agents.suggest(input, new AbortController().signal, revision);
    const request = generateContent.mock.calls[0] as unknown as [
      { contents: { parts: { text: string }[] }[] },
    ];
    expect(JSON.parse(request[0].contents[0].parts[0].text)).toEqual({
      input,
      revision,
    });
  });
  it.each([
    [
      "truncated",
      {
        candidates: [
          {
            finishReason: FinishReason.MAX_TOKENS,
            content: { parts: [{ text: JSON.stringify(draft) }] },
          },
        ],
      },
    ],
    ["safety blocked", { candidates: [{ finishReason: FinishReason.SAFETY }] }],
    [
      "prompt blocked",
      { ...result(draft), promptFeedback: { blockReason: "SAFETY" } },
    ],
    [
      "unfinished",
      {
        candidates: [{ content: { parts: [{ text: JSON.stringify(draft) }] } }],
      },
    ],
    ["no candidates", {}],
    [
      "multiple candidates",
      {
        candidates: [
          ...result(draft).candidates!,
          ...result(draft).candidates!,
        ],
      },
    ],
    ["unknown fields", result({ ...draft, rawAudio: "forbidden" })],
    [
      "malformed JSON",
      {
        candidates: [
          {
            finishReason: FinishReason.STOP,
            content: { parts: [{ text: "{private draft" }] },
          },
        ],
      },
    ],
    [
      "unexpected tool call",
      {
        candidates: [
          {
            finishReason: FinishReason.STOP,
            content: {
              parts: [
                {
                  text: JSON.stringify(draft),
                  functionCall: { name: "bypass_review" },
                },
              ],
            },
          },
        ],
      },
    ],
    [
      "thoughts only",
      {
        candidates: [
          {
            finishReason: FinishReason.STOP,
            content: {
              parts: [{ thought: true, text: JSON.stringify(draft) }],
            },
          },
        ],
      },
    ],
  ])(
    "releases no candidate when Gemini returns %s",
    async (_name, response) => {
      const { agents } = stub(
        Object.assign(new GenerateContentResponse(), response),
      );
      await expect(
        agents.suggest(input, new AbortController().signal),
      ).rejects.toMatchObject({
        code: "INVALID_DRAFT",
        stage: "suggestion",
        status: 502,
      });
    },
  );
  it("validates the independent review and hides provider diagnostics", async () => {
    const { agents, generateContent } = stub(result({ approved: true }));
    await expect(
      agents.review(input, draft, new AbortController().signal),
    ).rejects.toMatchObject({ code: "AUDIT_UNAVAILABLE", stage: "audit" });
    generateContent.mockRejectedValue(
      new Error("private provider diagnostics test-only-key"),
    );
    await expect(
      agents.review(input, draft, new AbortController().signal),
    ).rejects.toMatchObject({
      message: expect.not.stringContaining("test-only-key"),
    });
  });
  it("honors cancellation before and during a request", async () => {
    const { agents, generateContent } = stub(result(draft));
    const controller = new AbortController();
    controller.abort();
    await expect(
      agents.suggest(input, controller.signal),
    ).rejects.toMatchObject({ code: "STAGE_TIMEOUT", status: 504 });
    expect(generateContent).not.toHaveBeenCalled();
    const pending = new AbortController();
    generateContent.mockImplementation(async () => {
      pending.abort();
      throw new Error("cancelled");
    });
    await expect(
      agents.review(input, draft, pending.signal),
    ).rejects.toMatchObject({ code: "STAGE_TIMEOUT", stage: "audit" });
  });
  it("does not call a provider without the Gemini key", async () => {
    const generateContent = vi.fn(async () => result(draft));
    const agents = new GeminiAgents(readConfig({}), {
      models: { generateContent },
    });
    await expect(
      agents.suggest(input, new AbortController().signal),
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    expect(generateContent).not.toHaveBeenCalled();
  });
  it("allows only Gemini model IDs and requires Gemini-specific processing consent", () => {
    expect(readConfig({}).CONVERSATION_MODEL).toBe("gemini-3.8-flash");
    for (const name of [
      "CONVERSATION_MODEL",
      "AUDIT_MODEL",
      "TRANSCRIPTION_MODEL",
    ])
      expect(() => readConfig({ [name]: "another-provider-model" })).toThrow();
    expect(
      hasGeminiConsent({ ...INITIAL_STATE.settings, processingConsent: true }),
    ).toBe(false);
    expect(
      hasGeminiConsent({
        ...INITIAL_STATE.settings,
        processingConsent: true,
        processingProvider: "gemini",
      }),
    ).toBe(true);
  });
});
