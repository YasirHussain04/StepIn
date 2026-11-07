import { GeminiAgents } from "../server/providers/gemini";
import { DraftSchema } from "../shared/contracts";
import { readConfig } from "../server/config";
import { ApiError } from "../server/errors";
import { GoogleGenAI } from "@google/genai";

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
  // Two real Gemini API calls, using fictional context only. No database access.
  const input = {
    room: "Fictional practice: a community board-game table has an open chair and a sign saying new players welcome.",
    profile: null,
    request: "Suggest one optional, low-pressure way to ask to join.",
    action: "start",
    history: [],
    affirmations: false,
  };
  const candidate = DraftSchema.parse(
    await agents.suggest(input, AbortSignal.timeout(config.AI_TIMEOUT_MS)),
  );
  console.log(
    `Gemini suggestion call passed schema validation (${config.CONVERSATION_MODEL}).`,
  );
  const review = await agents.review(
    input,
    candidate,
    AbortSignal.timeout(config.AI_TIMEOUT_MS),
  );
  console.log(
    `Gemini audit call passed schema validation (${config.AUDIT_MODEL}); decision: ${review.decision}, checks: ${review.checks.length}.`,
  );
  console.log(
    "No account profiles, chat history or database rows were read or written. This checks provider access, not the authenticated app flow.",
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
