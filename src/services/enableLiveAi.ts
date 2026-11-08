import type { AppState, Settings } from "../domain/types";

/** One-tap demo defaults: live Gemini coaching on this device. */
export function liveAiSettings(settings: Settings): Settings {
  return {
    ...settings,
    processingConsent: true,
    processingProvider: "gemini",
    mode: "live",
    voiceConsent: true,
  };
}

export function withLiveAi(prev: AppState): AppState {
  return { ...prev, settings: liveAiSettings(prev.settings) };
}
