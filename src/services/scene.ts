import { fetch } from "expo/fetch";
import { apiBase, ClientError } from "./api";
import { bearerAuthHeader } from "./authHeaders";
import { uploadFile } from "./uploadFile";
import { SceneResponseSchema, type SceneSummary } from "../../shared/contracts";

export async function analyzeSceneStills(
  uris: string[],
  url: string | undefined,
  signal: AbortSignal,
): Promise<SceneSummary> {
  if (!uris.length || uris.length > 3)
    throw new ClientError(
      "SCENE_FRAME_LIMIT",
      "Send 1 to 3 reviewed photos.",
    );
  const form = new FormData();
  for (let i = 0; i < uris.length; i++) {
    const uri = uris[i];
    const blob = await uploadFile(uri, signal);
    if (blob.size > 2 * 1024 * 1024)
      throw new ClientError("TOO_LARGE", "Each photo must be under 2 MB.");
    if (!blob.size)
      throw new ClientError(
        "INVALID_IMAGE",
        "The photo is empty. Capture it again.",
      );
    form.append(
      "image",
      blob.type ? blob : blob.slice(0, blob.size, "image/jpeg"),
      `still-${i}.jpg`,
    );
  }
  const response = await fetch(`${apiBase(url)}/api/scene`, {
    method: "POST",
    body: form,
    signal,
    headers: {
      authorization: await bearerAuthHeader(),
      "x-image-consent": "true",
    },
  });
  const result = await response.json().catch(() => null);
  if (!response.ok)
    throw new ClientError(
      result?.code ?? "SCENE_FAILED",
      result?.message ??
        "Scene analysis did not finish. Retry or describe the room in text.",
      response.status,
    );
  return SceneResponseSchema.parse(result).scene;
}

export function roomFromScene(scene: SceneSummary): string {
  const parts = [
    `Event: ${scene.eventKind}`,
    `Social setup: ${scene.socialSetup.replaceAll("_", " ")}`,
    ...scene.coachingFocus.map((c) => `Focus: ${c}`),
    ...scene.observations,
    ...scene.activities.map((a) => `Activity: ${a}`),
    ...scene.readableSigns.map((s) => `Sign: ${s}`),
    ...scene.uncertainties.map((u) => `Uncertain: ${u}`),
  ];
  const text = parts.join(". ").trim();
  return text
    ? `Phone scene: ${text}`.slice(0, 2000)
    : "Phone scene captured; details were unclear.";
}

export function roomFromEvent(event: {
  title: string;
  location: string;
  note: string;
}): string {
  return `Event: ${event.title}. Location: ${event.location}. Notes: ${event.note}`.slice(
    0,
    2000,
  );
}
