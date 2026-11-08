import { describe, expect, it } from "vitest";
import {
  geminiAudioMime,
  normalizeAudioMime,
  resolveAudioMime,
  sniffAudioMime,
} from "../server/providers/transcription";
import { ApiError } from "../server/errors";

function wavStub(size = 64) {
  const buf = Buffer.alloc(size, 0);
  buf.write("RIFF", 0, "ascii");
  buf.write("WAVE", 8, "ascii");
  return buf;
}

function m4aStub(size = 64) {
  const buf = Buffer.alloc(size, 0);
  buf.write("ftyp", 4, "ascii");
  return buf;
}

describe("audio mime sniffing", () => {
  it("detects wav, m4a, webm, and mpeg magic bytes", () => {
    expect(sniffAudioMime(wavStub())).toBe("audio/wav");
    expect(sniffAudioMime(m4aStub())).toBe("audio/m4a");
    const webm = Buffer.alloc(16, 0);
    webm[0] = 0x1a;
    webm[1] = 0x45;
    webm[2] = 0xdf;
    webm[3] = 0xa3;
    expect(sniffAudioMime(webm)).toBe("audio/webm");
    const mp3 = Buffer.from([0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(sniffAudioMime(mp3)).toBe("audio/mpeg");
    expect(sniffAudioMime(Buffer.alloc(64, 1))).toBeNull();
  });

  it("resolveAudioMime prefers bytes and rejects unknown containers", () => {
    expect(resolveAudioMime(wavStub())).toBe("audio/wav");
    expect(resolveAudioMime(m4aStub())).toBe("audio/m4a");
    expect(() => resolveAudioMime(Buffer.alloc(64, 9))).toThrow(ApiError);
  });

  it("normalizeAudioMime maps m4a/aac/mp4 to audio/m4a", () => {
    expect(normalizeAudioMime("audio/mp4")).toBe("audio/m4a");
    expect(normalizeAudioMime("audio/x-m4a")).toBe("audio/m4a");
    expect(normalizeAudioMime("application/octet-stream", "voice.m4a")).toBe(
      "audio/m4a",
    );
    expect(normalizeAudioMime("application/octet-stream", "voice.wav")).toBe(
      "audio/wav",
    );
  });

  it("geminiAudioMime uses Gemini-preferred spellings and rejects unknowns", () => {
    expect(geminiAudioMime("audio/wav")).toBe("audio/wav");
    expect(geminiAudioMime("audio/m4a")).toBe("audio/m4a");
    expect(geminiAudioMime("audio/mp4")).toBe("audio/m4a");
    expect(geminiAudioMime("audio/mpeg")).toBe("audio/mp3");
    expect(() => geminiAudioMime("application/octet-stream")).toThrow(ApiError);
  });
});
