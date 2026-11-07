import { Message, Profile } from "../domain/types";
import { canSpeak, requireProfile } from "../domain/quiz";
export function approvedSpokenText(
  message: Message,
  profile: Profile | null,
  profiles: Profile[],
  audio: boolean,
  affirmations = true,
): string {
  if (message.role !== "assistant" || message.audit?.decision !== "approved")
    throw new Error("APPROVED_TEXT_REQUIRED");
  requireProfile(profile);
  const original = profiles.find((p) => p.id === message.audit?.profileId);
  if (!canSpeak(profile, audio) || !canSpeak(original, audio))
    throw new Error("SPEECH_DISABLED");
  return [
    message.text,
    message.icebreaker,
    affirmations ? message.affirmation : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}
