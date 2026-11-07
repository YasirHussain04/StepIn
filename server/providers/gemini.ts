import {
  GoogleGenAI,
  FinishReason,
  ApiError as GeminiApiError,
} from "@google/genai";
import { z } from "zod";
import {
  Draft,
  DraftSchema,
  Review,
  ReviewSchema,
} from "../../shared/contracts";
import { Config } from "../config";
import { ApiError, unavailable } from "../errors";
import { SUGGESTION_PROMPT, AUDIT_PROMPT } from "../agents/prompts";
import type { Agents, AgentInput } from "./agents";

type GeminiClient = { models: Pick<GoogleGenAI["models"], "generateContent"> };

export class GeminiAgents implements Agents {
  private client: GeminiClient | null;
  constructor(
    private config: Config,
    client?: GeminiClient,
  ) {
    this.client = config.GEMINI_API_KEY
      ? (client ??
        new GoogleGenAI({
          apiKey: config.GEMINI_API_KEY,
          httpOptions: { retryOptions: { attempts: 1 } },
        }))
      : null;
  }
  private async generate<T>(
    stage: "suggestion" | "audit",
    model: string,
    systemInstruction: string,
    payload: unknown,
    schema: z.ZodType<T>,
    signal: AbortSignal,
  ): Promise<T> {
    if (!this.client)
      throw unavailable(stage === "audit" ? "Audit agent" : "Suggestion agent");
    try {
      signal.throwIfAborted();
      // Stateless, separate calls: the auditor receives only its own instructions
      // and the exact candidate, never a shared suggestion chat or hidden thoughts.
      const response = await this.client.models.generateContent({
        model,
        contents: [
          { role: "user", parts: [{ text: JSON.stringify(payload) }] },
        ],
        config: {
          systemInstruction,
          abortSignal: signal,
          candidateCount: 1,
          responseMimeType: "application/json",
          responseJsonSchema: z.toJSONSchema(schema),
          temperature: stage === "audit" ? 0 : 0.4,
          maxOutputTokens: 8192,
        },
      });
      signal.throwIfAborted();
      const candidates = response.candidates ?? [];
      if (
        response.promptFeedback?.blockReason ||
        candidates.length !== 1 ||
        candidates[0].finishReason !== FinishReason.STOP
      )
        throw new Error("Incomplete or blocked response");
      // Only completed JSON text is eligible for validation. Never release partial
      // output, thoughts, function calls, audio, images, or provider diagnostics.
      const parts =
        candidates[0].content?.parts?.filter((part) => !part.thought) ?? [];
      if (
        !parts.length ||
        parts.some(
          (part) =>
            typeof part.text !== "string" ||
            Object.keys(part).some(
              (key) => !["text", "thought", "thoughtSignature"].includes(key),
            ),
        )
      )
        throw new Error("Expected text only");
      const text = parts.map((part) => part.text).join("");
      if (text.length > 20_000) throw new Error("Oversized response");
      return schema.parse(JSON.parse(text));
    } catch (error) {
      if (!signal.aborted && error instanceof GeminiApiError) {
        const status = error.status;
        const invalidKey = /API_KEY_INVALID|API key not valid/i.test(
          error.message,
        );
        throw new ApiError(
          invalidKey
            ? "GEMINI_KEY_INVALID"
            : status === 429
              ? "GEMINI_RATE_LIMITED"
              : status === 404
                ? "GEMINI_MODEL_UNAVAILABLE"
                : status === 401 || status === 403
                  ? "GEMINI_ACCESS_DENIED"
                  : status >= 500
                    ? "GEMINI_UNAVAILABLE"
                    : "GEMINI_REQUEST_FAILED",
          invalidKey
            ? "Google rejected the Gemini API key. Update GEMINI_API_KEY on the backend."
            : status === 429
              ? "Google's Gemini quota or rate limit was reached. Check the API project's quota and retry later."
              : status === 404
                ? "The configured Gemini model is unavailable to this API project. Check the model ID and access."
                : status === 401 || status === 403
                  ? "Google denied Gemini access. Check the backend key, API restrictions and project access."
                  : status >= 500
                    ? `Google's Gemini service is temporarily unavailable (HTTP ${status}). Retry shortly; no guidance was released.`
                    : `Google rejected the Gemini ${stage} request (HTTP ${status}). No guidance was released.`,
          status === 429 ? 429 : status >= 500 ? 503 : 502,
          stage,
        );
      }
      throw new ApiError(
        signal.aborted
          ? "STAGE_TIMEOUT"
          : stage === "audit"
            ? "AUDIT_UNAVAILABLE"
            : "INVALID_DRAFT",
        stage === "audit"
          ? "The independent Gemini check did not finish or returned invalid output. No guidance was released."
          : "The Gemini suggestion could not be completed and validated. No guidance was released. Retry or explicitly use the demo.",
        signal.aborted ? 504 : 502,
        stage,
      );
    }
  }
  suggest(
    input: AgentInput,
    signal: AbortSignal,
    revision?: { draft: Draft; changes: string[] },
  ): Promise<Draft> {
    return this.generate(
      "suggestion",
      this.config.CONVERSATION_MODEL,
      SUGGESTION_PROMPT,
      { input, revision: revision ?? null },
      DraftSchema,
      signal,
    );
  }
  review(
    input: AgentInput,
    draft: Draft,
    signal: AbortSignal,
  ): Promise<Review> {
    return this.generate(
      "audit",
      this.config.AUDIT_MODEL,
      AUDIT_PROMPT,
      { input, exactCandidate: draft },
      ReviewSchema,
      signal,
    );
  }
}
