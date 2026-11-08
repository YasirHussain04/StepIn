import { afterEach, describe, expect, it, vi } from "vitest";
import {
  startGlassesCamera,
  stopGlassesCamera,
  type GlassesCameraApi,
} from "../src/services/glassesSession";

function camera() {
  const sessionState = new Set<
    Parameters<GlassesCameraApi["onSessionState"]>[0]
  >();
  const sessionError = new Set<
    Parameters<GlassesCameraApi["onSessionError"]>[0]
  >();
  const streamState = new Set<
    Parameters<GlassesCameraApi["onStreamState"]>[0]
  >();
  const streamError = new Set<
    Parameters<GlassesCameraApi["onStreamError"]>[0]
  >();
  function subscribe<T>(listeners: Set<T>, listener: T) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }
  const api: GlassesCameraApi = {
    createSession: vi.fn(async () => "camera-1"),
    startSession: vi.fn(async () => {}),
    stopSession: vi.fn(async (id: string) => {
      sessionState.forEach((listener) => listener(id, "stopped"));
    }),
    removeStream: vi.fn(async () => {}),
    addStream: vi.fn(async () => {}),
    onSessionState: (listener) => subscribe(sessionState, listener),
    onSessionError: (listener) => subscribe(sessionError, listener),
    onStreamState: (listener) => subscribe(streamState, listener),
    onStreamError: (listener) => subscribe(streamError, listener),
  };
  return {
    api,
    state: (
      state: Parameters<Parameters<GlassesCameraApi["onSessionState"]>[0]>[1],
    ) => sessionState.forEach((listener) => listener("camera-1", state)),
    error: (message: string) =>
      sessionError.forEach((listener) => listener("camera-1", message)),
    stream: (
      state: Parameters<Parameters<GlassesCameraApi["onStreamState"]>[0]>[0],
    ) => streamState.forEach((listener) => listener(state)),
    streamError: (message: string) =>
      streamError.forEach((listener) => listener(message)),
    listenerCount: () =>
      sessionState.size +
      sessionError.size +
      streamState.size +
      streamError.size,
  };
}

// Flush only promise continuations, keeping device readiness under test control.
async function flush() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

afterEach(() => vi.useRealTimers());

describe("glasses camera lifecycle", () => {
  it("waits for actual device readiness before attaching the camera, and streaming before resolving", async () => {
    const c = camera();
    let ready = false;
    const start = startGlassesCamera(
      c.api,
      new AbortController().signal,
      vi.fn(),
    ).then((id) => {
      ready = true;
      return id;
    });
    await flush();
    expect(c.api.startSession).toHaveBeenCalledWith("camera-1");
    expect(c.api.addStream).not.toHaveBeenCalled();
    c.state("starting");
    await flush();
    expect(c.api.addStream).not.toHaveBeenCalled();
    c.state("started");
    await flush();
    expect(c.api.addStream).toHaveBeenCalledWith("camera-1");
    expect(ready).toBe(false);
    c.stream("streaming");
    await expect(start).resolves.toBe("camera-1");
    expect(c.listenerCount()).toBe(0);
    expect(c.api.stopSession).not.toHaveBeenCalled();
  });

  it("does not add a stream to a session that the native bridge has already removed", async () => {
    const c = camera();
    const start = startGlassesCamera(
      c.api,
      new AbortController().signal,
      vi.fn(),
    );
    await flush();
    c.state("stopped");
    await expect(start).rejects.toThrow("ended the camera session");
    expect(c.api.addStream).not.toHaveBeenCalled();
    expect(c.api.stopSession).toHaveBeenCalledWith("camera-1");
    expect(c.api.removeStream).toHaveBeenCalledWith("camera-1");
    expect(c.listenerCount()).toBe(0);
  });

  it("preserves native device errors instead of replacing them with a missing session error", async () => {
    const c = camera();
    const start = startGlassesCamera(
      c.api,
      new AbortController().signal,
      vi.fn(),
    );
    await flush();
    c.state("stopped");
    c.error("Glasses firmware update required");
    await expect(start).rejects.toThrow("Glasses firmware update required");
    expect(c.api.addStream).not.toHaveBeenCalled();
    expect(c.listenerCount()).toBe(0);
  });

  it("retains fast native events emitted while createSession is still resolving", async () => {
    const c = camera();
    c.api.createSession = vi.fn(async () => {
      c.state("started");
      return "camera-1";
    });
    c.api.addStream = vi.fn(async () => {
      c.stream("streaming");
    });
    await expect(
      startGlassesCamera(c.api, new AbortController().signal, vi.fn()),
    ).resolves.toBe("camera-1");
    expect(c.listenerCount()).toBe(0);
  });

  it("times out and releases a startup that never becomes ready", async () => {
    vi.useFakeTimers();
    const c = camera();
    const start = startGlassesCamera(
      c.api,
      new AbortController().signal,
      vi.fn(),
      1000,
    );
    const rejected = expect(start).rejects.toThrow("did not finish connecting");
    await flush();
    await vi.advanceTimersByTimeAsync(1000);
    await rejected;
    expect(c.api.stopSession).toHaveBeenCalledWith("camera-1");
    expect(c.listenerCount()).toBe(0);
  });

  it("cancels during device connection and stops the native session", async () => {
    const c = camera();
    const controller = new AbortController();
    const start = startGlassesCamera(c.api, controller.signal, vi.fn());
    await flush();
    controller.abort();
    await expect(start).rejects.toThrow("cancelled");
    expect(c.api.stopSession).toHaveBeenCalledWith("camera-1");
    expect(c.listenerCount()).toBe(0);
  });

  it("cleans up when the camera stream fails after the device connects", async () => {
    const c = camera();
    const start = startGlassesCamera(
      c.api,
      new AbortController().signal,
      vi.fn(),
    );
    await flush();
    c.state("started");
    await flush();
    c.streamError("Camera permission denied");
    await expect(start).rejects.toThrow("Camera permission denied");
    expect(c.api.stopSession).toHaveBeenCalledWith("camera-1");
    expect(c.api.removeStream).toHaveBeenCalledWith("camera-1");
    expect(
      vi.mocked(c.api.removeStream).mock.invocationCallOrder[0],
    ).toBeLessThan(vi.mocked(c.api.stopSession).mock.invocationCallOrder[0]);
    expect(c.listenerCount()).toBe(0);
  });

  it("releases the retained native stream before stopping its device session", async () => {
    const streams = new Map([["old-session", "old-stream"]]);
    let finishRemoval!: () => void;
    const removed = new Promise<void>((resolve) => {
      finishRemoval = resolve;
    });
    const api = {
      removeStream: vi.fn(async (id: string) => {
        await removed;
        streams.delete(id);
      }),
      stopSession: vi.fn(async () => {
        expect(streams.size).toBe(0);
      }),
    };
    const cleanup = stopGlassesCamera(api, "old-session");
    await flush();
    expect(api.stopSession).not.toHaveBeenCalled();
    finishRemoval();
    await cleanup;
    expect(api.stopSession).toHaveBeenCalledWith("old-session");
    streams.set("new-session", "new-stream");
    expect(streams.values().next().value).toBe("new-stream");
  });

  it("still stops the device when stream teardown reports an already-ended stream", async () => {
    const api = {
      removeStream: vi.fn(async () => {
        throw new Error("already stopped");
      }),
      stopSession: vi.fn(async () => {
        throw new Error("session not found");
      }),
    };
    await expect(
      stopGlassesCamera(api, "ended-session"),
    ).resolves.toBeUndefined();
    expect(api.stopSession).toHaveBeenCalledWith("ended-session");
  });

  it("waits for a terminal device event before completing teardown", async () => {
    const c = camera();
    c.api.stopSession = vi.fn(async () => {});
    let done = false;
    const cleanup = stopGlassesCamera(c.api, "camera-1").then(() => {
      done = true;
    });
    await flush();
    expect(c.api.stopSession).toHaveBeenCalled();
    expect(done).toBe(false);
    c.state("stopping");
    await flush();
    expect(done).toBe(false);
    c.state("stopped");
    await cleanup;
    expect(done).toBe(true);
    expect(c.listenerCount()).toBe(0);
  });
});
