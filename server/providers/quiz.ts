import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import {
  PersonaSchema,
  QuizTurnRequestSchema,
  type QuizTurnRequest,
  type QuizTurnResponse,
} from "../../shared/contracts";
import { validateAnswers } from "../../src/domain/quiz";
import { Config } from "../config";
import { ApiError, unavailable } from "../errors";

const ModelQuizTurn = z
  .object({
    assistantMessage: z.string().min(1).max(800),
    complete: z.boolean(),
    answers: z
      .record(z.string(), z.union([z.number(), z.string(), z.array(z.string())]))
      .optional(),
    persona: PersonaSchema.optional(),
    confirmSummary: z.string().max(600).optional(),
  })
  .strict();

export type { QuizTurnRequest, QuizTurnResponse };
export { QuizTurnRequestSchema };

const OPTION_GUIDE = `Screening slots (must match exactly when complete):
q1-q4 comfort 1-5 integers (1=not comfortable, 5=very): starting new conversation; joining small group already talking; keeping conversation going; unfamiliar community activity.
q5-q6 desired activity 1-5: how often meet someone new; how much interaction at a typical event.
q7 single string one of: One to one | Small group | Larger group | Structured activity | Observe first | No preference
q8 multi from: Short wording | More processing time | Text instead of audio | Audio instead of reading | Language support | Alternative or augmentative communication support | None | Prefer not to say
q9 multi from: Quieter setting or sensory breaks | Hearing access | Visual access | Speech or communication access | Mobility or seating access | Attention or memory support | Other self-described support | None | Prefer not to say
q10 multi from: A low-pressure first step | Icebreakers | Follow-up questions | Encouragement | Help joining an activity | Help taking a break or leaving politely | No coaching right now
Exclusive: None / Prefer not to say / No coaching right now cannot mix with other options in the same question.`;

export class GeminiQuizInterviewer {
  private client: GoogleGenAI | null;
  constructor(private config: Config) {
    this.client = config.GEMINI_API_KEY
      ? new GoogleGenAI({ apiKey: config.GEMINI_API_KEY })
      : null;
  }

  async turn(
    request: QuizTurnRequest,
    signal: AbortSignal,
  ): Promise<QuizTurnResponse> {
    if (!this.client) throw unavailable("Conversational quiz");
    if (request.messages.length > 22)
      throw new ApiError(
        "QUIZ_TOO_LONG",
        "This chat is long enough. Confirm what we have or restart the quiz.",
        400,
        "quiz",
      );
    try {
      const response = await this.client.models.generateContent({
        model: this.config.CONVERSATION_MODEL,
        contents: [
          {
            role: "user",
            parts: [
              {
                text: JSON.stringify({
                  task: "conversational_screening",
                  messages: request.messages,
                }),
              },
            ],
          },
        ],
        config: {
          abortSignal: signal,
          systemInstruction: `You interview for StepIn, a gentle social coach for neurodivergent newcomers. Have a short natural conversation (not a form). Ask one clear question at a time. Cover comfort, desired activity, preferred interaction, communication needs, accessibility, and desired support.
${OPTION_GUIDE}
When you have enough to fill all ten answers validly, set complete=true and return answers plus persona {summary, tone[], pacing slow|medium, do[], dont[], exampleVoice, source:"conversation_v1"} and confirmSummary for the user to approve. Until then complete=false, omit answers/persona, and ask the next question in assistantMessage.
Never medicalize. Never invent disabilities. Keep assistantMessage warm and brief. Return only JSON matching the schema.`,
          responseMimeType: "application/json",
          responseJsonSchema: z.toJSONSchema(ModelQuizTurn),
          temperature: 0.4,
          maxOutputTokens: 2048,
        },
      });
      const parsed = ModelQuizTurn.parse(JSON.parse(response.text ?? ""));
      if (parsed.complete) {
        if (
          !parsed.answers ||
          !validateAnswers(parsed.answers) ||
          !parsed.persona ||
          !parsed.confirmSummary
        )
          throw new ApiError(
            "QUIZ_INCOMPLETE",
            "The quiz could not finish classifying your answers. Reply once more or try the classic form.",
            502,
            "quiz",
          );
        return {
          assistantMessage: parsed.assistantMessage,
          complete: true,
          answers: parsed.answers,
          persona: parsed.persona,
          confirmSummary: parsed.confirmSummary,
        };
      }
      return {
        assistantMessage: parsed.assistantMessage,
        complete: false,
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(
        signal.aborted ? "QUIZ_TIMEOUT" : "QUIZ_FAILED",
        "The conversational quiz could not continue. Retry or use the classic form.",
        502,
        "quiz",
      );
    }
  }
}
