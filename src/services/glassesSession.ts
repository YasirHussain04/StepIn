type SessionState =
  "idle" | "starting" | "started" | "paused" | "stopping" | "stopped";
type StreamState =
  | "stopped"
  | "waitingForDevice"
  | "starting"
  | "streaming"
  | "paused"
  | "stopping";
type RemoveListener = () => void;
const stoppedMessage =
  "The glasses ended the camera session before it was ready. Reconnect in Meta AI and retry.";

export type GlassesCameraApi = {
  createSession: () => Promise<string>;
  startSession: (id: string) => Promise<void>;
  stopSession: (id: string) => Promise<void>;
  removeStream: (id: string) => Promise<void>;
  addStream: (id: string) => Promise<void>;
  onSessionState: (
    listener: (id: string, state: SessionState) => void,
  ) => RemoveListener;
  onSessionError: (
    listener: (id: string, message: string) => void,
  ) => RemoveListener;
  onStreamState: (listener: (state: StreamState) => void) => RemoveListener;
  onStreamError: (listener: (message: string) => void) => RemoveListener;
};

/** The bridge retains camera streams separately from device sessions. */
export async function stopGlassesCamera(
  api: Pick<GlassesCameraApi, "removeStream" | "stopSession"> &
    Partial<Pick<GlassesCameraApi, "onSessionState">>,
  id: string,
  timeoutMs = 5_000,
): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let terminal!: () => void;
  const stopped = new Promise<void>((resolve) => {
    terminal = resolve;
  });
  const removeListener = api.onSessionState?.((sessionId, state) => {
    if (sessionId === id && state === "stopped") terminal();
  });
  try {
    // Remove the stream first so native capture cannot select an old stream.
    try {
      await api.removeStream(id);
    } catch {
      /* It may already be stopped. */
    }
    try {
      await api.stopSession(id);
    } catch {
      // The bridge removes terminal sessions before the stop call reaches it.
      return;
    }
    if (removeListener) {
      timeout = setTimeout(terminal, timeoutMs);
      // stop(), like start(), returns before the SDK has completed the transition.
      await stopped;
    }
  } finally {
    clearTimeout(timeout);
    removeListener?.();
  }
}

/** Native start() returns before the device is ready. Observe both lifecycles. */
export async function startGlassesCamera(
  api: GlassesCameraApi,
  signal: AbortSignal,
  onCreated: (id: string) => void,
  timeoutMs = 30_000,
): Promise<string> {
  const states = new Map<string, SessionState>();
  const errors = new Map<string, string>();
  const changed = new Set<() => void>();
  let streamState: StreamState | undefined;
  let streamError: string | undefined;
  let sessionId: string | undefined;
  const notify = () => changed.forEach((listener) => listener());
  // Subscribe before create/start so even synchronous native events are retained.
  const removers = [
    api.onSessionState((id, state) => {
      if (!id || !state) return; // Older bridges also emit device-level events here.
      states.set(id, state);
      notify();
    }),
    api.onSessionError((id, message) => {
      errors.set(
        id,
        message || "The glasses ended the camera session. Reconnect and retry.",
      );
      notify();
    }),
    api.onStreamState((state) => {
      streamState = state;
      notify();
    }),
    api.onStreamError((message) => {
      streamError =
        message || "The glasses camera could not start. Reconnect and retry.";
      notify();
    }),
  ];

  function waitUntil(ready: () => boolean, timeoutMessage: string) {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let terminalTimer: ReturnType<typeof setTimeout> | undefined;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearTimeout(terminalTimer);
        changed.delete(check);
        signal.removeEventListener("abort", abort);
        error ? reject(error) : resolve();
      };
      const abort = () => finish(new Error("Camera session cancelled."));
      const check = () => {
        const error = sessionId && errors.get(sessionId);
        if (signal.aborted) return abort();
        if (error || streamError)
          return finish(new Error(error || streamError));
        if (sessionId && states.get(sessionId) === "stopped") {
          // Error and state publishers cross the native bridge independently.
          // Give the accompanying error one bridge turn to retain its detail.
          terminalTimer ??= setTimeout(
            () => finish(new Error(stoppedMessage)),
            50,
          );
          return;
        }
        if (ready()) finish();
      };
      const timer = setTimeout(
        () => finish(new Error(timeoutMessage)),
        timeoutMs,
      );
      changed.add(check);
      signal.addEventListener("abort", abort, { once: true });
      check();
    });
  }

  try {
    if (signal.aborted) throw new Error("Camera session cancelled.");
    sessionId = await api.createSession();
    onCreated(sessionId);
    if (signal.aborted) throw new Error("Camera session cancelled.");
    await api.startSession(sessionId);
    await waitUntil(
      () => states.get(sessionId!) === "started",
      "The glasses did not finish connecting. Keep them worn and unfolded, then retry.",
    );
    await api.addStream(sessionId);
    await waitUntil(
      () => streamState === "streaming",
      "The camera did not start streaming. Reconnect the glasses and retry.",
    );
    return sessionId;
  } catch (error) {
    const detail = sessionId && errors.get(sessionId);
    const failure = detail || streamError;
    const stopped = sessionId && states.get(sessionId) === "stopped";
    if (sessionId) await stopGlassesCamera(api, sessionId);
    if (failure) throw new Error(failure);
    if (stopped) throw new Error(stoppedMessage);
    throw error;
  } finally {
    removers.forEach((remove) => remove());
  }
}
