import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { INITIAL_STATE, AppState } from "../src/domain/types";
import { loadState, saveState } from "../src/services/repository.web";
describe("browser preview repository", () => {
  let data: Map<string, string>;
  beforeEach(() => {
    data = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
    });
  });
  afterEach(() => vi.unstubAllGlobals());
  const sample = (): AppState => ({
    ...structuredClone(INITIAL_STATE),
    draft: { answers: { q1: 4 }, step: 1 },
    sessions: [
      {
        id: "saved",
        title: "Game night",
        room: "fictional room",
        createdAt: "2026-11-07",
        updatedAt: "2026-11-07",
        messages: [
          { id: "a", role: "user", text: "hello", createdAt: "2026-11-07" },
        ],
      },
    ],
  });
  it("resumes a draft and reopens saved chat text after reload", async () => {
    await saveState(sample());
    const restored = await loadState();
    expect(restored.draft).toEqual({ answers: { q1: 4 }, step: 1 });
    expect(restored.sessions[0].messages[0].text).toBe("hello");
  });
  it("keeps old saved content but excludes new temporary chats and messages when history is off", async () => {
    const state = sample();
    state.settings.history = false;
    state.sessions[0].messages.push({
      id: "b",
      role: "user",
      text: "private new message",
      createdAt: "2026-11-07",
      persisted: false,
    });
    state.sessions.push({
      ...state.sessions[0],
      id: "temporary",
      persisted: false,
    });
    await saveState(state);
    const restored = await loadState();
    expect(restored.sessions).toHaveLength(1);
    expect(restored.sessions[0].messages).toHaveLength(1);
  });
  it("does not resurrect deleted sessions on the next load", async () => {
    await saveState(sample());
    const state = await loadState();
    state.sessions = [];
    await saveState(state);
    expect((await loadState()).sessions).toHaveLength(0);
  });
  it("surfaces corrupt storage and quota failures instead of silently resetting data", async () => {
    data.set("stepin.local.v1", "{");
    await expect(loadState()).rejects.toThrow();
    vi.stubGlobal("localStorage", {
      setItem: () => {
        throw new Error("Quota exceeded");
      },
    });
    await expect(saveState(sample())).rejects.toThrow("Quota exceeded");
  });
});
