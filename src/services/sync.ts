import {
  AppState,
  INITIAL_STATE,
  Profile,
  Session,
  uid,
} from "../domain/types";
import { CloudSnapshot, SyncOperation } from "../../shared/contracts";
export const emptyCloud = () => ({
  enabled: false,
  revision: 0,
  historyEpoch: 0,
  queue: [] as SyncOperation[],
});
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
export function seedOperations(
  state: AppState,
  snapshot: CloudSnapshot,
): SyncOperation[] {
  const operations: SyncOperation[] = [];
  for (const profile of state.profiles)
    if (!snapshot.profiles.some((p) => p.id === profile.id))
      operations.push({ id: uid(), kind: "profile.put", profile });
  const active = state.profiles.find((p) => p.id === state.activeProfileId);
  if (active && active.id !== snapshot.activeProfileId)
    operations.push({
      id: uid(),
      kind: "profile.activate",
      profile: active,
      expectedActiveId: snapshot.activeProfileId,
    });
  for (const session of state.sessions.filter((s) => s.persisted !== false)) {
    const { messages, ...header } = session;
    const remote = snapshot.sessions.find((s) => s.id === session.id);
    const remoteHeader = remote
      ? (({ messages, ...h }) => h)(remote)
      : undefined;
    if (!same(header, remoteHeader))
      operations.push({
        id: uid(),
        kind: "session.put",
        session: header,
        historyEpoch: snapshot.historyEpoch,
      });
    for (const message of messages.filter(
      (m) =>
        m.persisted !== false &&
        !(m.role === "assistant" && m.audit?.source === "live") &&
        !remote?.messages.some((v) => v.id === m.id),
    ))
      operations.push({
        id: uid(),
        kind: "message.put",
        sessionId: session.id,
        message,
        historyEpoch: snapshot.historyEpoch,
      });
  }
  return operations;
}
export function changesToOperations(
  previous: AppState,
  next: AppState,
): SyncOperation[] {
  if (
    !previous.cloud?.consented ||
    !previous.ownerId ||
    previous.ownerId !== next.ownerId
  )
    return [];
  const ops: SyncOperation[] = [];
  const epoch = previous.cloud.historyEpoch;
  if (previous.profiles.length && !next.profiles.length)
    ops.push({ id: uid(), kind: "profile.delete_all" });
  else if (
    next.activeProfileId &&
    previous.activeProfileId !== next.activeProfileId
  ) {
    const profile = next.profiles.find((p) => p.id === next.activeProfileId)!;
    const redacted = previous.profiles.some((p) => {
      const after = next.profiles.find((v) => v.id === p.id);
      return after && !same(p.answers, after.answers);
    });
    ops.push({
      id: uid(),
      kind: redacted ? "profile.redact" : "profile.activate",
      profile,
      expectedActiveId: previous.activeProfileId,
    });
  }
  for (const old of previous.sessions.filter((s) => s.persisted !== false))
    if (!next.sessions.some((s) => s.id === old.id))
      ops.push({ id: uid(), kind: "session.delete", sessionId: old.id });
  for (const session of next.sessions.filter((s) => s.persisted !== false)) {
    const old = previous.sessions.find((s) => s.id === session.id);
    const { messages, ...header } = session;
    const oldHeader = old ? (({ messages, ...h }) => h)(old) : undefined;
    if (!same(header, oldHeader))
      ops.push({
        id: uid(),
        kind: "session.put",
        session: header,
        historyEpoch: epoch,
      });
    for (const message of messages.filter(
      (m) =>
        m.persisted !== false &&
        !(m.role === "assistant" && m.audit?.source === "live"),
    )) {
      if (!old?.messages.some((m) => m.id === message.id))
        ops.push({
          id: uid(),
          kind: "message.put",
          sessionId: session.id,
          message,
          historyEpoch: epoch,
        });
    }
  }
  return ops;
}
// Keep edits made while a network request was in flight. The cloud snapshot is
// authoritative for acknowledged operations; only queued tails are replayed.
export function mergeCloud(
  current: AppState,
  snapshot: CloudSnapshot,
  remaining: SyncOperation[],
): AppState {
  let profiles = [...snapshot.profiles] as Profile[];
  let sessions = [...snapshot.sessions] as Session[];
  let active = snapshot.activeProfileId;
  for (const op of remaining) {
    if (
      op.kind === "profile.put" ||
      op.kind === "profile.activate" ||
      op.kind === "profile.redact"
    ) {
      if (op.kind === "profile.redact")
        profiles = profiles.map((p) => ({
          ...p,
          answers: {
            ...p.answers,
            q8: ["Prefer not to say"],
            q9: ["Prefer not to say"],
          },
        }));
      if (!profiles.some((p) => p.id === op.profile.id))
        profiles.push(op.profile);
      if (op.kind !== "profile.put") active = op.profile.id;
    } else if (op.kind === "profile.delete_all") {
      profiles = [];
      active = null;
    } else if (op.kind === "session.put") {
      const old = sessions.find((s) => s.id === op.session.id);
      sessions = sessions
        .filter((s) => s.id !== op.session.id)
        .concat({ ...op.session, messages: old?.messages ?? [] });
    } else if (op.kind === "message.put")
      sessions = sessions.map((s) =>
        s.id === op.sessionId && !s.messages.some((m) => m.id === op.message.id)
          ? { ...s, messages: [...s.messages, op.message] }
          : s,
      );
    else if (op.kind === "session.delete")
      sessions = sessions.filter((s) => s.id !== op.sessionId);
    else if (op.kind === "session.delete_all") sessions = [];
  }
  const temporary = current.sessions.filter((s) => s.persisted === false);
  // Do not restore transient messages after a remotely deleted saved session.
  sessions = sessions.map((s) => ({
    ...s,
    messages: [
      ...s.messages,
      ...(current.sessions
        .find((v) => v.id === s.id)
        ?.messages.filter((m) => m.persisted === false) ?? []),
    ].filter((m, i, list) => list.findIndex((v) => v.id === m.id) === i),
  }));
  return {
    ...current,
    profiles,
    activeProfileId: active,
    sessions: [...sessions, ...temporary],
    cloud: {
      enabled: true,
      consented: true,
      revision: snapshot.revision,
      historyEpoch: snapshot.historyEpoch,
      queue: remaining,
    },
  };
}
export function isolateAccount(
  state: AppState,
  userId: string | null,
): AppState {
  if (state.ownerId && state.ownerId !== userId)
    return {
      ...JSON.parse(JSON.stringify(INITIAL_STATE)),
      ownerId: userId,
      cloud: emptyCloud(),
      eventCache: state.eventCache,
      settings: { ...INITIAL_STATE.settings, apiUrl: state.settings.apiUrl },
    };
  return { ...state, ownerId: userId, cloud: state.cloud ?? emptyCloud() };
}
