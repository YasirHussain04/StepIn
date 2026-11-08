import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { AppState as NativeAppState } from "react-native";
import * as Linking from "expo-linking";
import type { Session as AuthSession } from "@supabase/supabase-js";
import {
  AppState,
  INITIAL_STATE,
  Message,
  Profile,
  uid,
} from "../domain/types";
import { loadState, saveState } from "../services/repository";
import { requireProfile } from "../domain/quiz";
import { acceptAuthUrl, supabase } from "../services/auth";
import { api, ClientError } from "../services/api";
import {
  changesToOperations,
  emptyCloud,
  isolateAccount,
  mergeCloud,
  seedOperations,
} from "../services/sync";
import type { CloudSnapshot, SyncOperation } from "../../shared/contracts";
type Store = {
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  ready: boolean;
  storageError: string | null;
  retryStorage: () => void;
  profile: Profile | null;
  account: AuthSession | null;
  recovery: boolean;
  finishRecovery: () => void;
  syncStatus: string;
  syncError: string | null;
  flushSync: () => Promise<void>;
  enableSync: () => Promise<void>;
  resolveConflict: (choice: "cloud" | "local") => Promise<void>;
  deleteAllChats: () => void;
  signOut: () => Promise<void>;
  deleteAccount: () => Promise<void>;
  getState: () => AppState;
  appendLiveMessage: (sessionId: string, message: Message) => void;
};
const Context = createContext<Store | null>(null);
export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, rawSetState] = useState<AppState>(INITIAL_STATE);
  const stateRef = useRef(state);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [account, setAccount] = useState<AuthSession | null>(null);
  const accountRef = useRef<AuthSession | null>(null);
  const [recovery, setRecovery] = useState(false);
  const [syncStatus, setSyncStatus] = useState("Local only");
  const [syncError, setSyncError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const loaded = useRef(false);
  const writes = useRef(Promise.resolve());
  const syncing = useRef<Promise<void> | null>(null);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPersist = useRef<AppState | null>(null);
  const commit = useCallback((next: AppState) => {
    stateRef.current = next;
    rawSetState(next);
  }, []);
  const setState = useCallback<React.Dispatch<React.SetStateAction<AppState>>>(
    (update) => {
      const old = stateRef.current;
      const next = typeof update === "function" ? update(old) : update;
      // Local-device mode: skip expensive sync queue diffs.
      if (!next.cloud?.enabled && !old.cloud?.enabled) {
        commit(next);
        return;
      }
      const ops = changesToOperations(old, next);
      const removingProfile = ops.some(
        (op) =>
          op.kind === "profile.redact" || op.kind === "profile.delete_all",
      );
      const previousQueue = removingProfile
        ? (next.cloud?.queue ?? []).filter(
            (op) => !op.kind.startsWith("profile."),
          )
        : (next.cloud?.queue ?? []);
      commit(
        ops.length
          ? {
              ...next,
              cloud: {
                ...(next.cloud ?? emptyCloud()),
                conflict: removingProfile ? undefined : next.cloud?.conflict,
                queue: [...previousQueue, ...ops],
              },
            }
          : next,
      );
    },
    [commit],
  );
  useEffect(() => {
    if (loaded.current) return;
    let closed = false;
    let unsubscribe: undefined | (() => void);
    (async () => {
      const saved = await loadState();
      const { data, error } = (await supabase?.auth.getSession()) ?? {
        data: null,
        error: null,
      };
      if (error) throw error;
      if (closed) return;
      const initial = data?.session ?? null;
      accountRef.current = initial;
      setAccount(initial);
      commit(
        isolateAccount(
          {
            ...saved,
            settings: { ...INITIAL_STATE.settings, ...saved.settings },
          },
          initial?.user.id ?? null,
        ),
      );
      loaded.current = true;
      setStorageError(null);
      setReady(true);
    })().catch(() => {
      if (!closed) {
        setStorageError(
          "Local data or account storage could not be opened. Retry to recover it.",
        );
        setReady(false);
      }
    });
    return () => {
      closed = true;
      unsubscribe?.();
    };
  }, [retry, commit]);
  useEffect(() => {
    if (!ready || !supabase) return;
    const subscription = supabase.auth.onAuthStateChange((event, session) => {
      accountRef.current = session;
      setAccount(session);
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
      commit(isolateAccount(stateRef.current, session?.user.id ?? null));
      if (!session) setSyncStatus("Local only");
    });
    return () => subscription.data.subscription.unsubscribe();
  }, [ready, commit]);
  useEffect(() => {
    if (!ready) return;
    pendingPersist.current = state;
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      const snapshot = pendingPersist.current;
      if (!snapshot) return;
      const cloned = JSON.parse(JSON.stringify(snapshot)) as AppState;
      writes.current = writes.current
        .catch(() => {})
        .then(() => saveState(cloned))
        .then(() => setStorageError(null))
        .catch(() =>
          setStorageError(
            "Changes are in memory but could not be saved. Keep the app open and retry.",
          ),
        );
    }, 250);
    return () => {
      if (persistTimer.current) clearTimeout(persistTimer.current);
    };
  }, [state, ready, retry]);
  useEffect(() => {
    const sub = NativeAppState.addEventListener("change", (value) => {
      if (value === "active") supabase?.auth.startAutoRefresh();
      else supabase?.auth.stopAutoRefresh();
    });
    const listener = Linking.addEventListener("url", ({ url }) => {
      void acceptAuthUrl(url).catch(() =>
        setSyncError(
          "The account link could not be verified. Request a new link.",
        ),
      );
    });
    return () => {
      sub.remove();
      listener.remove();
    };
  }, []);
  const flushSync = useCallback(
    async function sync(): Promise<void> {
      if (syncing.current) {
        await syncing.current;
        if (
          stateRef.current.cloud?.queue.length &&
          !stateRef.current.cloud.conflict
        )
          return sync();
        return;
      }
      const owner = accountRef.current?.user.id;
      if (!owner || !stateRef.current.cloud?.enabled) return;
      if (stateRef.current.cloud.conflict)
        throw new ClientError(
          "SYNC_CONFLICT",
          "Resolve the account conflict in Settings before continuing.",
        );
      const task = (async () => {
        setSyncStatus("Syncing…");
        setSyncError(null);
        try {
          let repeat = true;
          while (repeat) {
            const before = stateRef.current;
            if (!before.cloud?.enabled) return;
            const removal = before.cloud!.queue.find(
              (op) =>
                op.kind === "profile.delete_all" ||
                op.kind === "profile.redact",
            );
            const batch = removal
              ? [removal]
              : before.cloud!.queue.slice(0, 100);
            const result = batch.length
              ? await api<
                  CloudSnapshot | { conflict: true; snapshot: CloudSnapshot }
                >("/api/sync", {
                  method: "POST",
                  url: before.settings.apiUrl,
                  body: {
                    expectedRevision: before.cloud!.revision,
                    consent: true,
                    operations: batch,
                  },
                })
              : await api<CloudSnapshot>("/api/sync", {
                  url: before.settings.apiUrl,
                });
            if (
              accountRef.current?.user.id !== owner ||
              stateRef.current.ownerId !== owner
            )
              return;
            if ("conflict" in result) {
              if (removal) {
                const rebased = stateRef.current.cloud!.queue.map((op) =>
                  op.id !== removal.id
                    ? op
                    : op.kind === "profile.redact"
                      ? {
                          ...op,
                          id: uid(),
                          expectedActiveId: result.snapshot.activeProfileId,
                        }
                      : op,
                );
                commit({
                  ...stateRef.current,
                  cloud: {
                    ...stateRef.current.cloud!,
                    revision: result.snapshot.revision,
                    historyEpoch: result.snapshot.historyEpoch,
                    queue: rebased,
                  },
                });
                continue;
              }
              commit({
                ...stateRef.current,
                cloud: {
                  ...stateRef.current.cloud!,
                  conflict: result.snapshot,
                },
              });
              throw new ClientError(
                "SYNC_CONFLICT",
                "Another device changed this account. Review the conflict in Settings.",
              );
            }
            const acked = new Set(batch.map((op) => op.id));
            const tail = stateRef.current.cloud!.queue.filter(
              (op) => !acked.has(op.id),
            );
            const enabled = stateRef.current.cloud!.enabled;
            const merged = mergeCloud(stateRef.current, result, tail);
            commit({ ...merged, cloud: { ...merged.cloud!, enabled } });
            repeat = enabled && tail.length > 0;
          }
          setSyncStatus("Up to date");
        } catch (error) {
          setSyncStatus("Sync pending");
          setSyncError(
            error instanceof Error
              ? error.message
              : "Sync failed. Your queued changes remain on this device.",
          );
          throw error;
        }
      })();
      syncing.current = task;
      try {
        await task;
      } finally {
        syncing.current = null;
      }
    },
    [commit],
  );
  useEffect(() => {
    if (!ready || !account || !state.cloud?.enabled || state.cloud.conflict)
      return;
    const timer = setTimeout(() => {
      void flushSync().catch(() => {});
    }, 1200);
    const interval = setInterval(() => {
      void flushSync().catch(() => {});
    }, 30_000);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [
    ready,
    account?.user.id,
    state.cloud?.enabled,
    state.cloud?.queue.length,
    state.cloud?.conflict,
    flushSync,
  ]);
  async function enableSync() {
    if (!accountRef.current)
      throw new ClientError("UNAUTHENTICATED", "Sign in first.");
    if (stateRef.current.cloud?.consented) {
      commit({
        ...stateRef.current,
        cloud: { ...stateRef.current.cloud, enabled: true },
      });
      await flushSync();
      return;
    }
    const owner = accountRef.current.user.id;
    const snapshot = await api<CloudSnapshot>("/api/sync", {
      url: stateRef.current.settings.apiUrl,
    });
    if (accountRef.current?.user.id !== owner) return;
    const current = stateRef.current;
    const operations = seedOperations(current, snapshot);
    if (
      (snapshot.profiles.length || snapshot.sessions.length) &&
      operations.length
    ) {
      commit({
        ...current,
        cloud: {
          enabled: true,
          consented: true,
          revision: snapshot.revision,
          historyEpoch: snapshot.historyEpoch,
          queue: operations,
          conflict: snapshot,
        },
      });
      setSyncError(
        "This account already has data. Choose how to combine it with this device in the conflict panel.",
      );
      return;
    }
    commit(mergeCloud(current, snapshot, operations));
    await flushSync();
  }
  async function resolveConflict(choice: "cloud" | "local") {
    const current = stateRef.current;
    const snapshot = current.cloud?.conflict;
    if (!snapshot) return;
    if (choice === "cloud") commit(mergeCloud(current, snapshot, []));
    else {
      let expected = snapshot.activeProfileId;
      const rebased = current.cloud!.queue.map((op) => {
        if (op.kind === "profile.activate" || op.kind === "profile.redact") {
          const next = { ...op, id: uid(), expectedActiveId: expected };
          expected = op.profile.id;
          return next;
        }
        if (op.kind === "profile.delete_all") expected = null;
        return op;
      });
      commit(mergeCloud(current, snapshot, rebased));
    }
    setSyncError(null);
    await flushSync();
  }
  function deleteAllChats() {
    const current = stateRef.current;
    const op: SyncOperation = { id: uid(), kind: "session.delete_all" };
    commit({
      ...current,
      sessions: [],
      cloud: current.cloud?.consented
        ? { ...current.cloud, queue: [...current.cloud.queue, op] }
        : current.cloud,
    });
  }
  async function signOut() {
    const { error } = (await supabase?.auth.signOut({ scope: "local" })) ?? {
      error: null,
    };
    if (error) throw error;
    await clearLocalAccount();
  }
  async function clearLocalAccount() {
    accountRef.current = null;
    setAccount(null);
    const cleared = isolateAccount(stateRef.current, null);
    commit(cleared);
    setRecovery(false);
    setSyncError(null);
    // Wait behind earlier writes so sign-out does not finish with another
    // account's private cache still on disk.
    const purge = writes.current.catch(() => {}).then(() => saveState(cleared));
    writes.current = purge.catch(() => {});
    try {
      await purge;
      setStorageError(null);
    } catch {
      setStorageError(
        "Signed out, but the local cache could not be cleared. Keep the app open and retry storage.",
      );
      throw new ClientError(
        "CACHE_CLEAR_FAILED",
        "The local account cache could not be cleared. Retry storage before sharing this device.",
      );
    }
  }
  async function deleteAccount() {
    await api("/api/account", {
      method: "DELETE",
      url: stateRef.current.settings.apiUrl,
    });
    try {
      await supabase?.auth.signOut({ scope: "local" });
    } finally {
      await clearLocalAccount();
    }
  }
  function appendLiveMessage(sessionId: string, message: Message) {
    const current = stateRef.current;
    if (
      message.audit?.source !== "live" ||
      message.audit.profileId !== current.activeProfileId
    )
      throw new ClientError(
        "STALE_PROFILE",
        "Your profile changed before guidance could be displayed.",
      );
    commit({
      ...current,
      sessions: current.sessions.map((s) =>
        s.id === sessionId && !s.messages.some((m) => m.id === message.id)
          ? {
              ...s,
              messages: [...s.messages, message],
              updatedAt: message.createdAt,
            }
          : s,
      ),
    });
  }
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
        storageError,
        retryStorage: () => setRetry((v) => v + 1),
        profile,
        account,
        recovery,
        finishRecovery: () => setRecovery(false),
        syncStatus,
        syncError,
        flushSync,
        enableSync,
        resolveConflict,
        deleteAllChats,
        signOut,
        deleteAccount,
        getState: () => stateRef.current,
        appendLiveMessage,
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
