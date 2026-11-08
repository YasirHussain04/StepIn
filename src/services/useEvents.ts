import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { useApp } from "../state/AppProvider";
import { refreshEvents } from "./api";
import { events as seeds } from "../data/events";
export function useEvents() {
  const { state, setState } = useApp();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const active = useRef(false);
  const refresh = useCallback(
    async (force = false, { silent = false } = {}) => {
      if (active.current) return;
      active.current = true;
      if (!silent) {
        setLoading(true);
        setError("");
      }
      try {
        const response = await refreshEvents(state.settings.apiUrl, force);
        setState((prev) => ({ ...prev, eventCache: response }));
        if (silent) setError("");
      } catch (e) {
        if (!silent)
          setError(
            e instanceof Error
              ? e.message
              : "Could not refresh. Cached listings remain available.",
          );
      } finally {
        active.current = false;
        if (!silent) setLoading(false);
      }
    },
    [state.settings.apiUrl, setState],
  );
  useEffect(() => {
    void refresh(false, { silent: true });
    const interval = setInterval(() => {
      void refresh(false, { silent: true });
    }, 15 * 60_000);
    const sub = AppState.addEventListener("change", (status) => {
      if (status === "active") void refresh(false, { silent: true });
    });
    return () => {
      clearInterval(interval);
      sub.remove();
    };
  }, [refresh]);
  return {
    events: state.eventCache?.events ?? seeds,
    source: state.eventCache?.source ?? "seed",
    fetchedAt: state.eventCache?.fetchedAt ?? null,
    stale: !!error || (state.eventCache?.stale ?? true),
    warning: error || state.eventCache?.warning || "",
    loading,
    refresh: (force = false) => refresh(force, { silent: false }),
  };
}
