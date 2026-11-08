import { Platform } from "react-native";
import { apiBase, ClientError } from "./api";
import { bearerAuthHeader } from "./authHeaders";
import { recordingUploadMeta } from "./recordingPresets";

export async function transcribeClip(
  uri: string,
  duration: number,
  url: string | undefined,
  signal: AbortSignal,
): Promise<string> {
  const form = new FormData();
  const meta = recordingUploadMeta(uri);
  if (Platform.OS === "web") {
    const clip = await fetch(uri).then((r) => r.blob());
    if (clip.size > 4 * 1024 * 1024)
      throw new ClientError(
        "TOO_LARGE",
        "Record a shorter message (up to 45 seconds).",
      );
    form.append("audio", clip, meta.name);
  } else
    form.append("audio", {
      uri,
      name: meta.name,
      type: meta.type,
    } as unknown as Blob);
  const response = await fetch(`${apiBase(url)}/api/transcribe`, {
    method: "POST",
    body: form,
    signal,
    headers: {
      authorization: await bearerAuthHeader(),
      "x-audio-consent": "true",
      "x-recording-duration": String(duration),
    },
  });
  const result = await response.json().catch(() => null);
  if (!response.ok)
    throw new ClientError(
      result?.code ?? "TRANSCRIPTION_FAILED",
      result?.message ?? "Transcription did not finish. Retry or type instead.",
      response.status,
    );
  if (typeof result?.text !== "string" || result.text.length > 2000)
    throw new ClientError(
      "INVALID_TRANSCRIPT",
      "The transcript was invalid. Record again or type instead.",
    );
  return result.text;
}
