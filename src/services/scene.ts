import { Platform } from "react-native";
import { apiBase, ClientError } from "./api";
import { bearerAuthHeader } from "./authHeaders";
import {
  SceneResponseSchema,
  type SceneSummary,
} from "../../shared/contracts";

export async function analyzeSceneStills(
  uris: string[],
  url: string | undefined,
  signal: AbortSignal,
): Promise<SceneSummary> {
  if (!uris.length || uris.length > 3)
    throw new ClientError(
      "SCENE_FRAME_LIMIT",
      "Send 1 to 3 reviewed glasses stills.",
    );
  const form = new FormData();
  for (let i = 0; i < uris.length; i++) {
    const uri = uris[i];
    if (Platform.OS === "web") {
      const blob = await fetch(uri).then((r) => r.blob());
      if (blob.size > 2 * 1024 * 1024)
        throw new ClientError("TOO_LARGE", "Each still must be under 2 MB.");
      form.append("image", blob, `still-${i}.jpg`);
    } else
      form.append("image", {
        uri,
        name: `still-${i}.jpg`,
        type: "image/jpeg",
      } as unknown as Blob);
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
    ? `Glasses scene: ${text}`.slice(0, 2000)
    : "Glasses scene captured; details were unclear.";
}
