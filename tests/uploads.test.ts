import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { randomUUID } from "node:crypto";
import { installFormDataPatch } from "expo/src/winter/FormData";
import { convertFormDataAsync } from "expo/src/winter/fetch/convertFormData";
import { buildApp } from "../server/app";
import { readConfig } from "../server/config";
import type { Store } from "../server/store";
import type { SceneSummary } from "../shared/contracts";
import { transcribeClip } from "../src/services/transcribe";
import { analyzeSceneStills } from "../src/services/scene";
import { uploadFile as browserFile } from "../src/services/uploadFile.web";

const native = vi.hoisted(() => ({
  files: new Map<string, { bytes: Uint8Array; type: string }>(),
  request: vi.fn(),
}));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("expo-audio", () => ({
  AudioQuality: { HIGH: 96 },
  IOSOutputFormat: { MPEG4AAC: "aac" },
}));
vi.mock("expo/fetch", () => ({
  fetch: (...args: unknown[]) => native.request(...args),
}));
vi.mock("../src/services/authHeaders", () => ({
  bearerAuthHeader: async () => "Bearer upload-test",
}));
// Model File's native bytes() interface, which deliberately does not inherit Blob.
vi.mock("expo-file-system", () => ({
  File: class {
    constructor(public uri: string) {}
    get exists() {
      return native.files.has(this.uri);
    }
    get name() {
      return this.uri.split("/").at(-1)!;
    }
    get size() {
      return native.files.get(this.uri)!.bytes.length;
    }
    get type() {
      return native.files.get(this.uri)!.type;
    }
    async bytes() {
      return native.files.get(this.uri)!.bytes;
    }
    slice(start: number, end: number, type: string) {
      return new Blob([native.files.get(this.uri)!.bytes.slice(start, end)], {
        type,
      });
    }
  },
}));

// Use Expo's real FormData patch and multipart serializer from the locked SDK.
// Node's FormData coerces native File objects to strings and would hide this bug.
class NativeFormData {
  _parts: [string, unknown][] = [];
}
const Form = installFormDataPatch(NativeFormData as unknown as typeof FormData);
const scene: SceneSummary = {
  captureId: randomUUID(),
  observedAt: new Date().toISOString(),
  observations: ["An open seat at a game table."],
  activities: ["Board games"],
  readableSigns: [],
  uncertainties: [],
  needsClarification: false,
  eventKind: "Game night",
  socialSetup: "small_group",
  coachingFocus: ["Ask about joining"],
  model: "test",
  provenance: "phone_camera",
};
const transcribe = vi.fn(async (bytes: Buffer, mime: string) => {
  expect(bytes.subarray(4, 8).toString()).toBe("ftyp");
  expect(mime).toBe("audio/m4a");
  return { text: "Can I join this game?", model: "test" };
});
const summarize = vi.fn(
  async (frames: { bytes: Buffer; mimeType: string }[]) => {
    expect(frames).toHaveLength(3);
    expect(
      frames.every((f) => f.mimeType === "image/jpeg" && f.bytes[0] === 0xff),
    ).toBe(true);
    return scene;
  },
);
let app: Awaited<ReturnType<typeof buildApp>>;
beforeAll(async () => {
  app = await buildApp(readConfig({ NODE_ENV: "test" }), {
    store: {
      authenticate: async () => ({ id: "upload-test" }),
    } as unknown as Store,
    transcriber: { transcribe },
    sceneAnalyzer: { summarize },
  });
});
afterAll(async () => {
  await app.close();
});
beforeEach(() => {
  vi.stubGlobal("__DEV__", true);
  vi.stubGlobal("FormData", Form);
  native.files.clear();
  native.request.mockReset();
  transcribe.mockClear();
  summarize.mockClear();
  native.request.mockImplementation(async (url: string, init: RequestInit) => {
    const { body, boundary } = await convertFormDataAsync(
      init.body as FormData,
    );
    const response = await app.inject({
      method: "POST",
      url: new URL(url).pathname,
      headers: {
        ...Object.fromEntries(new Headers(init.headers).entries()),
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload: Buffer.from(body),
    });
    return new Response(response.body, { status: response.statusCode });
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});
function audio(size = 80) {
  const bytes = new Uint8Array(size);
  bytes.set(new TextEncoder().encode("ftyp"), 4);
  native.files.set("file:///cache/voice.m4a", { bytes, type: "audio/mp4" });
  return "file:///cache/voice.m4a";
}
const signal = () => new AbortController().signal;

describe("native media uploads through Expo's multipart serializer and the real API", () => {
  it("reproduces the reported serializer error for the former URI-only file part", async () => {
    const form = new FormData();
    form.append("audio", {
      uri: audio(),
      name: "voice.m4a",
      type: "audio/m4a",
    } as unknown as Blob);
    await expect(convertFormDataAsync(form)).rejects.toThrow(
      "Unsupported FormDataPart implementation",
    );
  });
  it("sends native M4A bytes, consent and duration to transcription", async () => {
    await expect(
      transcribeClip(audio(), 2.5, "http://localhost:3001", signal()),
    ).resolves.toBe("Can I join this game?");
    expect(transcribe).toHaveBeenCalledOnce();
    expect(native.request.mock.calls[0][1].headers).toMatchObject({
      authorization: "Bearer upload-test",
      "x-audio-consent": "true",
      "x-recording-duration": "2.5",
    });
  });
  it("uploads all three native stills through the scene API", async () => {
    const uris = [0, 1, 2].map((i) => {
      const uri = `file:///cache/still-${i}.jpg`;
      native.files.set(uri, {
        bytes: new Uint8Array(80).fill(0xff),
        type: "image/jpeg",
      });
      return uri;
    });
    await expect(
      analyzeSceneStills(uris, "http://localhost:3001", signal()),
    ).resolves.toEqual(scene);
    expect(summarize).toHaveBeenCalledOnce();
  });
  it("rejects oversize native audio before uploading", async () => {
    await expect(
      transcribeClip(
        audio(4 * 1024 * 1024 + 1),
        45,
        "http://localhost:3001",
        signal(),
      ),
    ).rejects.toMatchObject({ code: "TOO_LARGE" });
    expect(native.request).not.toHaveBeenCalled();
  });
  it("rejects missing and empty files and an already-cancelled upload", async () => {
    await expect(
      transcribeClip("file:///gone.m4a", 1, "http://localhost:3001", signal()),
    ).rejects.toThrow("no longer available");
    native.files.set("file:///empty.m4a", {
      bytes: new Uint8Array(),
      type: "audio/m4a",
    });
    await expect(
      transcribeClip("file:///empty.m4a", 1, "http://localhost:3001", signal()),
    ).rejects.toMatchObject({ code: "INVALID_AUDIO" });
    const abort = new AbortController();
    abort.abort();
    await expect(
      transcribeClip(audio(), 1, "http://localhost:3001", abort.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(native.request).not.toHaveBeenCalled();
  });
  it("preserves actionable backend errors", async () => {
    native.request.mockResolvedValue(
      new Response(
        JSON.stringify({
          code: "PROVIDER_UNAVAILABLE",
          message: "Transcription is not configured.",
        }),
        { status: 503 },
      ),
    );
    await expect(
      transcribeClip(audio(), 1, "http://localhost:3001", signal()),
    ).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
      status: 503,
      message: "Transcription is not configured.",
    });
  });
  it("rejects duration and scene size limits before uploading", async () => {
    await expect(
      transcribeClip(audio(), 46, "http://localhost:3001", signal()),
    ).rejects.toMatchObject({ code: "RECORDING_LIMIT" });
    native.files.set("file:///large.jpg", {
      bytes: new Uint8Array(2 * 1024 * 1024 + 1),
      type: "image/jpeg",
    });
    await expect(
      analyzeSceneStills(
        ["file:///large.jpg"],
        "http://localhost:3001",
        signal(),
      ),
    ).rejects.toMatchObject({ code: "TOO_LARGE" });
    expect(native.request).not.toHaveBeenCalled();
  });
  it("reads browser recording blobs with the cancellation signal", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(new Blob(["browser audio"], { type: "audio/webm" })),
    );
    vi.stubGlobal("fetch", fetch);
    const abortSignal = signal();
    const blob = await browserFile("blob:recording", abortSignal);
    expect(await blob.text()).toBe("browser audio");
    expect(fetch).toHaveBeenCalledWith("blob:recording", {
      signal: abortSignal,
    });
  });
});
