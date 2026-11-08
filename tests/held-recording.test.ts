import { describe, expect, it, vi } from "vitest";
import { prepareHeldRecording } from "../src/services/heldRecording";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fixture() {
  let held = true;
  let current = true;
  const audio = deferred();
  const preparation = deferred();
  const callbacks = {
    isHeld: () => held,
    isCurrent: () => current,
    stopSpeech: vi.fn(async () => {}),
    configureAudio: vi.fn(() => audio.promise),
    prepare: vi.fn(() => preparation.promise),
    onPrepared: vi.fn(),
    record: vi.fn(),
  };
  return {
    callbacks,
    audio,
    preparation,
    release: () => {
      held = false;
    },
    cancel: () => {
      current = false;
    },
  };
}

describe("hold-to-talk preparation", () => {
  it("starts recording only after the audio route and recorder are prepared", async () => {
    const f = fixture();
    const task = prepareHeldRecording(f.callbacks);
    await Promise.resolve();
    expect(f.callbacks.prepare).not.toHaveBeenCalled();
    f.audio.resolve();
    await Promise.resolve();
    expect(f.callbacks.prepare).toHaveBeenCalledOnce();
    expect(f.callbacks.record).not.toHaveBeenCalled();
    f.preparation.resolve();
    await task;
    expect(f.callbacks.onPrepared).toHaveBeenCalledOnce();
    expect(f.callbacks.record).toHaveBeenCalledOnce();
  });

  it("does not open the recorder after release during audio-route setup", async () => {
    const f = fixture();
    const task = prepareHeldRecording(f.callbacks);
    await Promise.resolve();
    f.release();
    f.audio.resolve();
    await task;
    expect(f.callbacks.prepare).not.toHaveBeenCalled();
    expect(f.callbacks.record).not.toHaveBeenCalled();
  });

  it.each(["release", "cancel"] as const)(
    "does not start after %s while native preparation is pending, but marks the resource for cleanup",
    async (action) => {
      const f = fixture();
      const task = prepareHeldRecording(f.callbacks);
      f.audio.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(f.callbacks.prepare).toHaveBeenCalledOnce();
      f[action]();
      f.preparation.resolve();
      await task;
      expect(f.callbacks.onPrepared).toHaveBeenCalledOnce();
      expect(f.callbacks.record).not.toHaveBeenCalled();
    },
  );
});
