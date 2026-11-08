import WebSocket from "ws";
import type { Config } from "../config";
import type { Profile } from "../../src/domain/types";
import type { SceneSummary } from "../../shared/contracts";

const GEMINI_LIVE_URL =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

export type LiveStartMessage = {
  type: "start";
  room?: string;
  shareProfile?: boolean;
  localProfile?: Profile;
  scene?: SceneSummary;
};

function systemInstruction(
  room: string | undefined,
  profile: Profile | undefined,
  shareProfile: boolean,
  scene?: SceneSummary,
) {
  const preferenceBits =
    shareProfile && profile
      ? `The wearer's screening profile (JSON) may guide tone and pacing only — never quote raw answers aloud unless asked:\n${JSON.stringify(profile.answers)}${
          profile.persona
            ? `\nPersona style card: ${JSON.stringify(profile.persona)}`
            : ""
        }`
      : "No personal screening answers are shared. Keep advice generic and gentle.";
  const sceneBits = scene
    ? `Glasses stills summary (do not invent beyond this): eventKind=${scene.eventKind}; socialSetup=${scene.socialSetup}; focus=${scene.coachingFocus.join("; ")}; observations=${scene.observations.join("; ")}; activities=${scene.activities.join("; ")}; uncertainties=${scene.uncertainties.join("; ")}.`
    : "No glasses scene summary was provided.";
  return [
    "You are StepIn Live, a brief spoken social coach for a neurodivergent person wearing Meta glasses.",
    "Speak naturally in short turns. Prefer one clear next step or line they could say. Match persona tone/pacing when provided.",
    "Do not invent medical, legal, or crisis advice. If they sound in distress, encourage reaching a trusted person or local emergency help.",
    "Never claim live camera vision beyond the provided stills summary.",
    sceneBits,
    room ? `Room text: ${room}` : "No extra room text.",
    preferenceBits,
  ].join("\n");
}

export function connectGeminiLive(
  config: Config,
  start: LiveStartMessage,
): WebSocket {
  if (!config.GEMINI_API_KEY)
    throw new Error("GEMINI_API_KEY is required for Live talk.");
  const model = config.LIVE_MODEL.startsWith("models/")
    ? config.LIVE_MODEL
    : `models/${config.LIVE_MODEL}`;
  const upstream = new WebSocket(
    `${GEMINI_LIVE_URL}?key=${encodeURIComponent(config.GEMINI_API_KEY)}`,
  );
  upstream.on("open", () => {
    upstream.send(
      JSON.stringify({
        setup: {
          model,
          generationConfig: {
            responseModalities: ["AUDIO"],
          },
          systemInstruction: {
            parts: [
              {
                text: systemInstruction(
                  start.room,
                  start.localProfile,
                  start.shareProfile !== false,
                  start.scene,
                ),
              },
            ],
          },
        },
      }),
    );
  });
  return upstream;
}

export function isLiveStartMessage(value: unknown): value is LiveStartMessage {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return v.type === "start";
}
