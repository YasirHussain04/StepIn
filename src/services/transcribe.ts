import { fetch } from "expo/fetch";
import { apiBase, ClientError } from "./api";
import { bearerAuthHeader } from "./authHeaders";
import { recordingUploadMeta } from "./recordingPresets";
import { uploadFile } from "./uploadFile";

export async function transcribeClip(
  uri: string,
  duration: number,
  url: string | undefined,
  signal: AbortSignal,
): Promise<string> {
  if (!Number.isFinite(duration) || duration < 0.1 || duration > 45)
    throw new ClientError(
      "RECORDING_LIMIT",
      "Record up to 45 seconds at a time.",
    );
  const form = new FormData();
  const meta = recordingUploadMeta(uri);
  const clip = await uploadFile(uri, signal);
  if (clip.size > 4 * 1024 * 1024)
    throw new ClientError(
      "TOO_LARGE",
      "Record a shorter message (up to 45 seconds).",
    );
  if (!clip.size)
    throw new ClientError(
      "INVALID_AUDIO",
      "The recording is empty. Record again.",
    );
  form.append(
    "audio",
    clip.type ? clip : clip.slice(0, clip.size, meta.type),
    meta.name,
  );
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
