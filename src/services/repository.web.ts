import { AppState, INITIAL_STATE } from "../domain/types";
const KEY = "stepin.local.v1";
// Browser preview uses localStorage; iOS/Android resolve repository.ts (SQLite).
export async function loadState(): Promise<AppState> {
  if (typeof localStorage === "undefined")
    return structuredClone(INITIAL_STATE);
  const stored = localStorage.getItem(KEY);
  if (!stored) return structuredClone(INITIAL_STATE);
  const state = JSON.parse(stored) as AppState;
  if (
    !Array.isArray(state.profiles) ||
    !Array.isArray(state.sessions) ||
    !state.settings
  )
    throw new Error("Local data could not be read.");
  return state;
}
export async function saveState(state: AppState): Promise<void> {
  localStorage.setItem(
    KEY,
    JSON.stringify({
      ...state,
      sessions: state.sessions
        .filter((s) => s.persisted !== false)
        .map((s) => ({
          ...s,
          messages: s.messages.filter((m) => m.persisted !== false),
        })),
    }),
  );
}
