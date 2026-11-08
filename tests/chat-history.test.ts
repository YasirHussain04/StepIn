import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  INITIAL_STATE,
  type AppState,
  type Session,
} from "../src/domain/types";
import { chatHistoryPolicy } from "../src/services/chatHistory";
import { loadState, saveState } from "../src/services/repository.web";

describe("chat history policy and reload", () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    {
      mode: "demo",
      cloud: false,
      history: true,
      transient: false,
      saved: 2,
      server: false,
    },
    {
      mode: "live",
      cloud: false,
      history: true,
      transient: false,
      saved: 2,
      server: false,
    },
    {
      mode: "live",
      cloud: true,
      history: true,
      transient: false,
      saved: 2,
      server: true,
    },
    {
      mode: "demo",
      cloud: true,
      history: true,
      transient: false,
      saved: 2,
      server: true,
    },
    {
      mode: "demo",
      cloud: false,
      history: false,
      transient: false,
      saved: 0,
      server: false,
    },
    {
      mode: "live",
      cloud: true,
      history: false,
      transient: false,
      saved: 0,
      server: false,
    },
    {
      mode: "live",
      cloud: true,
      history: true,
      transient: true,
      saved: 0,
      server: false,
    },
  ] as const)(
    "$mode: cloud=$cloud, history=$history, transient=$transient",
    async ({ mode, cloud, history, transient, saved, server }) => {
      const session: Session = {
        id: "chat",
        title: "Practice",
        room: "Game night",
        mode,
        createdAt: "2026-11-08",
        updatedAt: "2026-11-08",
        persisted: !transient,
        messages: [],
      };
      const policy = chatHistoryPolicy(history, session.persisted, cloud);
      session.messages = [
        {
          id: "user",
          role: "user",
          text: "Hello",
          createdAt: "2026-11-08",
          persisted: policy.localHistory,
        },
        {
          id: "reply",
          role: "assistant",
          text: "Try introducing yourself",
          createdAt: "2026-11-08",
          persisted: policy.localHistory,
        },
      ];
      const state: AppState = {
        ...structuredClone(INITIAL_STATE),
        sessions: [session],
      };
      state.settings.history = history;
      await saveState(state);
      const restored = await loadState();
      expect(restored.sessions.flatMap((s) => s.messages)).toHaveLength(saved);
      expect(policy.serverHistory).toBe(server);
      expect(restored.sessions).toHaveLength(transient ? 0 : 1);
    },
  );

  it("does not restore temporary messages when history is enabled later", async () => {
    const policy = chatHistoryPolicy(false, true, false);
    const state: AppState = {
      ...structuredClone(INITIAL_STATE),
      sessions: [
        {
          id: "chat",
          title: "Practice",
          room: "Game night",
          createdAt: "2026-11-08",
          updatedAt: "2026-11-08",
          persisted: true,
          messages: [
            {
              id: "temporary",
              role: "user",
              text: "Private",
              createdAt: "2026-11-08",
              persisted: policy.localHistory,
            },
          ],
        },
      ],
    };
    state.settings.history = true;
    await saveState(state);
    expect((await loadState()).sessions[0].messages).toEqual([]);
    state.sessions = [];
    await saveState(state);
    expect((await loadState()).sessions).toEqual([]);
  });
});
