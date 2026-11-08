import { GeminiAgents } from "../server/providers/gemini";
import { readConfig } from "../server/config";
import { ApiError } from "../server/errors";
import { GoogleGenAI } from "@google/genai";
import { Coach } from "../server/coach/run";
import type { Store } from "../server/store";
import { createProfile } from "../src/domain/quiz";
import { uid } from "../src/domain/types";

async function main() {
  const config = readConfig();
  if (process.argv.includes("--list-models")) {
    if (!config.GEMINI_API_KEY) throw new Error("Missing key");
    const client = new GoogleGenAI({
      apiKey: config.GEMINI_API_KEY,
      httpOptions: { timeout: 15_000, retryOptions: { attempts: 1 } },
    });
    const models = await client.models.list({ config: { pageSize: 100 } });
    for await (const model of models) {
      if (
        model.name?.includes("gemini-") &&
        model.supportedActions?.includes("generateContent")
      )
        console.log(model.name);
    }
    return;
  }
  const agents = new GeminiAgents(config);
  // Run the real coordinator, including revision limits and all seven audit
  // checks. The fixture store never connects to Supabase or uses user records.
  const profile = createProfile(
    {
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
    1,
  );
  const unused = async (): Promise<never> => {
    throw new Error("Database access is disabled in this check");
  };
  const store: Store = {
    authenticate: unused,
    sync: unused,
    reserve: unused,
    finish: unused,
    fail: unused,
    deleteAccount: unused,
    snapshot: async () => ({
      revision: 0,
      historyEpoch: 0,
      activeProfileId: profile.id,
      profiles: [profile],
      sessions: [],
    }),
    assertProfile: async (_userId, profileId) => {
      if (profileId !== profile.id) throw new Error("Unexpected profile");
    },
  };
  const response = await new Coach(store, agents, config).run(
    "local-agent-check",
    {
      requestId: uid(),
      messageId: uid(),
      sessionId: uid(),
      message: "Suggest one optional, low-pressure way to ask to join.",
      action: "start",
      expectedProfileVersionId: profile.id,
      history: false,
      shareProfile: false,
      affirmations: false,
      processingConsent: true,
      processingProvider: "gemini",
      transientRoom: {
        description:
          "Fictional practice: a community board-game table has an open chair and a sign saying new players welcome.",
      },
    },
    AbortSignal.timeout(140_000),
  );
  console.log(
    `Gemini coaching passed the full server approval gate: ${response.status}, ${response.message.audit!.attempts} attempt(s), ${response.message.audit!.checks.length} checks.`,
  );
  console.log(
    `Suggestion: ${config.CONVERSATION_MODEL}; audit: ${config.AUDIT_MODEL}.`,
  );
  console.log(
    "Only fictional context and an in-memory fixture were used. No account profiles, chat history or database rows were read or written. Authentication and cloud persistence are not covered by this check.",
  );
}
main().catch((error) => {
  console.error(
    error instanceof ApiError
      ? `${error.code}: ${error.message}`
      : "Gemini check failed. Check server configuration and model access.",
  );
  process.exitCode = 1;
});
