import type { Profile } from "../domain/types";
import { bearerAuthHeader } from "./authHeaders";

export type LiveSessionHandlers = {
  onReady?: () => void;
  onAudio?: (pcm: Uint8Array) => void;
  onInterrupted?: () => void;
  onTurnComplete?: () => void;
  onError?: (message: string) => void;
  onClose?: () => void;
};

function apiBase(url?: string) {
  return (url ?? process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3001").replace(
    /\/$/,
    "",
  );
}

function toWsUrl(httpUrl: string, token: string) {
  const base = httpUrl.replace(/^http/, "ws");
  const sep = base.includes("?") ? "&" : "?";
  return `${base}/api/live${sep}access_token=${encodeURIComponent(token)}`;
}

function decodeBase64(data: string): Uint8Array {
  const binary = atob(data);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

export class LiveSession {
  private socket: WebSocket | null = null;
  private closed = false;

  constructor(private handlers: LiveSessionHandlers = {}) {}

  async connect(options: {
    apiUrl?: string;
    room?: string;
    shareProfile?: boolean;
    localProfile?: Profile;
  }) {
    const auth = await bearerAuthHeader();
    const token = auth.replace(/^Bearer\s+/i, "");
    const url = toWsUrl(apiBase(options.apiUrl), token);
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const succeed = () => {
        if (settled) return;
        settled = true;
        this.handlers.onReady?.();
        resolve();
      };
      const fail = (message: string) => {
        if (settled) {
          this.handlers.onError?.(message);
          return;
        }
        settled = true;
        this.handlers.onError?.(message);
        reject(new Error(message));
      };
      const socket = new WebSocket(url);
      this.socket = socket;
      socket.onopen = () => {
        socket.send(
          JSON.stringify({
            type: "start",
            room: options.room,
            shareProfile: options.shareProfile !== false,
            localProfile: options.localProfile,
          }),
        );
      };
      socket.onerror = () => {
        if (!this.closed) fail("Could not open the Live talk WebSocket.");
      };
      socket.onclose = () => {
        this.handlers.onClose?.();
      };
      socket.onmessage = (event) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(String(event.data));
        } catch {
          return;
        }
        const msg = parsed as Record<string, unknown>;
        if (msg.type === "ready") {
          succeed();
          return;
        }
        if (msg.type === "error" && typeof msg.message === "string") {
          fail(msg.message);
          return;
        }
        if (msg.setupComplete) succeed();
        const serverContent = msg.serverContent as
          | Record<string, unknown>
          | undefined;
        if (!serverContent) return;
        if (serverContent.interrupted) this.handlers.onInterrupted?.();
        const modelTurn = serverContent.modelTurn as
          | { parts?: Array<{ inlineData?: { data?: string } }> }
          | undefined;
        for (const part of modelTurn?.parts ?? []) {
          const data = part.inlineData?.data;
          if (data) this.handlers.onAudio?.(decodeBase64(data));
        }
        if (serverContent.turnComplete) this.handlers.onTurnComplete?.();
      };
    });
  }

  sendPcm(pcm: Uint8Array) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(
      JSON.stringify({ type: "audio", data: encodeBase64(pcm) }),
    );
  }

  endAudio() {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({ type: "audio_end" }));
  }

  close() {
    this.closed = true;
    try {
      this.socket?.close();
    } catch {
      /* ignore */
    }
    this.socket = null;
  }
}
