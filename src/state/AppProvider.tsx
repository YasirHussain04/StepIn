import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { AppState, INITIAL_STATE, Profile } from "../domain/types";
import { loadState, saveState } from "../services/repository";
import { requireProfile } from "../domain/quiz";

type Store = {
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  ready: boolean;
  storageError: string | null;
  retryStorage: () => void;
  profile: Profile | null;
};
const Context = createContext<Store | null>(null);
export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AppState>(INITIAL_STATE);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const queue = useRef(Promise.resolve());
  const loaded = useRef(false);
  useEffect(() => {
    if (loaded.current) return;
    let cancelled = false;
    loadState()
      .then((saved) => {
        if (!cancelled) {
          setState(saved);
          loaded.current = true;
          setStorageError(null);
          setReady(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStorageError(
            "Your local data could not be opened. Retry to recover it.",
          );
          setReady(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [retry]);
  useEffect(() => {
    if (!ready) return;
    const snapshot = JSON.parse(JSON.stringify(state)) as AppState;
    queue.current = queue.current
      .catch(() => {})
      .then(() => saveState(snapshot))
      .then(() => setStorageError(null))
      .catch(() =>
        setStorageError(
          "Changes are in memory but could not be saved. Keep the app open and retry.",
        ),
      );
  }, [state, ready, retry]);
  let profile =
    state.profiles.find((p) => p.id === state.activeProfileId) ?? null;
  try {
    requireProfile(profile);
  } catch {
    profile = null;
  }
  return (
    <Context.Provider
      value={{
        state,
        setState,
        ready,
        profile,
        storageError,
        retryStorage: () => setRetry((v) => v + 1),
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useApp() {
  const store = useContext(Context);
  if (!store) throw new Error("AppProvider missing");
  return store;
}
