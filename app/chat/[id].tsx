import React, { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Pressable,
  Text,
  View,
} from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import * as Speech from "expo-speech";
import {
  Badge,
  Body,
  Button,
  C,
  Card,
  Icon,
  Label,
  Page,
  s,
  serif,
  TextField,
  Title,
} from "../../components/ui";
import { Confirm } from "../../components/Confirm";
import { useApp } from "../../src/state/AppProvider";
import { Message, uid } from "../../src/domain/types";
import { CoachAction, runFixture } from "../../src/services/coach";
import { approvedSpokenText } from "../../src/services/playback";
import { canSpeak } from "../../src/domain/quiz";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
export default function Conversation() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const app = useApp();
  const { state, setState, profile } = app;
  const latest = useRef(app);
  latest.current = app;
  const session = state.sessions.find((s) => s.id === id);
  const [message, setMessage] = useState("");
  const [phase, setPhase] = useState("");
  const [error, setError] = useState("");
  const [inspect, setInspect] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState<string | null>(null);
  const [rename, setRename] = useState(false);
  const [title, setTitle] = useState(session?.title ?? "");
  const [deleting, setDeleting] = useState(false);
  const nonce = useRef(0);
  const busy = useRef(false);
  const focused = useRef(true);
  function stop() {
    void Speech.stop();
    setSpeaking(null);
  }
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      const subscription = AppState.addEventListener("change", (value) => {
        if (value !== "active") {
          void Speech.stop();
          setSpeaking(null);
          nonce.current++;
          busy.current = false;
          setPhase("");
        }
      });
      return () => {
        focused.current = false;
        nonce.current++;
        busy.current = false;
        setPhase("");
        void Speech.stop();
        setSpeaking(null);
        subscription.remove();
      };
    }, []),
  );
  async function generate(action: CoachAction, text: string, retry = false) {
    const store = latest.current;
    const current = store.state.sessions.find((s) => s.id === id);
    if (!store.profile) {
      router.push("/quiz");
      return;
    }
    if (!current || busy.current) return;
    busy.current = true;
    const token = ++nonce.current;
    const profileId = store.profile.id;
    stop();
    setError("");
    setMessage("");
    if (!retry) {
      const user: Message = {
        id: uid(),
        role: "user",
        text,
        action,
        createdAt: new Date().toISOString(),
        persisted: store.state.settings.history,
      };
      setState((prev) => ({
        ...prev,
        sessions: prev.sessions.map((s) =>
          s.id === id
            ? {
                ...s,
                messages: [...s.messages, user],
                updatedAt: user.createdAt,
              }
            : s,
        ),
      }));
    }
    try {
      setPhase("Drafting a demo idea…");
      await wait(450);
      if (nonce.current !== token || !focused.current) return;
      setPhase("Checking the fixture against your preferences…");
      await wait(650);
      if (nonce.current !== token || !focused.current) return;
      if (latest.current.profile?.id !== profileId)
        throw new Error(
          "Your preferences changed. Retry with your current profile.",
        );
      if (!latest.current.state.sessions.some((s) => s.id === id))
        throw new Error("This conversation was deleted.");
      const response = runFixture(
        store.profile,
        current.room,
        current.scenarioId,
        action,
        current.messages.filter((m) => m.role === "assistant").length,
        store.state.settings.affirmations,
        text,
      );
      response.persisted =
        store.state.settings.history && latest.current.state.settings.history;
      setState((prev) => {
        if (prev.activeProfileId !== profileId) return prev;
        return {
          ...prev,
          sessions: prev.sessions.map((s) =>
            s.id === id
              ? {
                  ...s,
                  messages: [...s.messages, response],
                  updatedAt: response.createdAt,
                }
              : s,
          ),
        };
      });
    } catch (e) {
      if (focused.current)
        setError(
          e instanceof Error
            ? e.message
            : "The demo could not finish. Your message is saved; try again.",
        );
    } finally {
      if (nonce.current === token && focused.current) {
        busy.current = false;
        setPhase("");
      }
    }
  }
  async function read(m: Message) {
    try {
      const text = approvedSpokenText(
        m,
        profile,
        state.profiles,
        state.settings.audio,
        state.settings.affirmations,
      );
      await Speech.stop();
      setSpeaking(m.id);
      Speech.speak(text, {
        language: "en-CA",
        rate: state.settings.rate,
        onDone: () => setSpeaking(null),
        onStopped: () => setSpeaking(null),
        onError: () => {
          setSpeaking(null);
          setError(
            "Read aloud is unavailable. Your response is still available as text.",
          );
        },
      });
    } catch {
      setError(
        "Read aloud is disabled by your preferences or this message has no approved check.",
      );
    }
  }
  if (!session)
    return (
      <Page>
        <Title small>Chat not found.</Title>
        <Body muted>
          It may have been deleted, or was temporary with history off.
        </Body>
        <Button
          title="Back to chats"
          onPress={() => router.replace("/chats")}
        />
      </Page>
    );
  const last = session.messages.at(-1);
  return (
    <Page
      scrollTrigger={
        session.messages.length
          ? `${session.messages.length}:${phase}`
          : undefined
      }
    >
      <View style={s.between}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to chats"
          onPress={() => router.replace("/chats")}
          style={{ minHeight: 44, justifyContent: "center" }}
        >
          <View style={s.row}>
            <Icon name="arrow-back" size={19} />
            <Body>Chats</Body>
          </View>
        </Pressable>
        <Badge warm>OFFLINE DEMO · NO LIVE AI</Badge>
      </View>
      <View style={{ gap: 10 }}>
        <Label>Your practice space</Label>
        <Title small>{session.title}</Title>
        <View style={s.row}>
          <Pressable
            accessibilityRole="button"
            onPress={() => setRename((v) => !v)}
            style={{
              minHeight: 44,
              justifyContent: "center",
              paddingRight: 16,
            }}
          >
            <Body muted style={{ fontSize: 12 }}>
              Rename
            </Body>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => setDeleting(true)}
            style={{ minHeight: 44, justifyContent: "center" }}
          >
            <Body style={{ fontSize: 12, color: C.danger }}>Delete chat</Body>
          </Pressable>
        </View>
      </View>
      {rename && (
        <Card>
          <TextField
            accessibilityLabel="Chat title"
            value={title}
            onChangeText={setTitle}
            maxLength={80}
          />
          <Button
            title="Save title"
            disabled={!title.trim()}
            onPress={() => {
              setState((prev) => ({
                ...prev,
                sessions: prev.sessions.map((s) =>
                  s.id === id ? { ...s, title: title.trim() } : s,
                ),
              }));
              setRename(false);
            }}
          />
        </Card>
      )}
      <Card style={{ backgroundColor: C.sage }}>
        <View style={s.row}>
          <Icon name="location-outline" size={18} />
          <Text style={{ fontSize: 12, fontWeight: "700", color: C.green }}>
            {session.scenarioId ? "FICTIONAL DEMO ROOM" : "YOUR DESCRIPTION"}
          </Text>
        </View>
        <Body style={{ fontSize: 13 }}>{session.room}</Body>
        <Body style={s.small}>
          This is scripted practice with local rule checks. No live model or
          camera is involved.
        </Body>
      </Card>
      {!profile && (
        <Card>
          <Body>
            Confirm your social preferences before requesting a new idea.
          </Body>
          <Button
            title="Complete my quiz"
            onPress={() => router.push("/quiz")}
          />
        </Card>
      )}
      {session.messages.map((m) =>
        m.role === "user" ? (
          <View
            key={m.id}
            style={{
              alignSelf: "flex-end",
              backgroundColor: C.green,
              padding: 17,
              borderRadius: 19,
              borderBottomRightRadius: 4,
              maxWidth: "92%",
            }}
          >
            <Text style={{ color: "#fff", fontSize: 15, lineHeight: 23 }}>
              {m.text}
            </Text>
          </View>
        ) : (
          <Card key={m.id} style={{ borderBottomLeftRadius: 4 }}>
            <View style={s.row}>
              <View
                style={{
                  width: 27,
                  height: 27,
                  borderRadius: 10,
                  backgroundColor: C.sage,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Icon name="footsteps" size={16} />
              </View>
              <Label>A small step</Label>
            </View>
            <Body>{m.text}</Body>
            {m.icebreaker && (
              <View
                style={{
                  borderLeftWidth: 3,
                  borderLeftColor: "#B7C79A",
                  backgroundColor: "#F4F6EF",
                  padding: 16,
                  borderRadius: 10,
                }}
              >
                <Text
                  selectable
                  style={{
                    color: C.ink,
                    fontSize: 21,
                    lineHeight: 30,
                    fontFamily: serif,
                  }}
                >
                  “{m.icebreaker}”
                </Text>
              </View>
            )}
            {m.affirmation && state.settings.affirmations && (
              <Body muted style={{ fontSize: 13 }}>
                {m.affirmation}
              </Body>
            )}
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              <Button
                title={speaking === m.id ? "Stop playback" : "Read aloud"}
                secondary
                icon={speaking === m.id ? "stop" : "volume-medium-outline"}
                disabled={
                  speaking !== m.id &&
                  (!canSpeak(profile, state.settings.audio) ||
                    m.audit?.decision !== "approved" ||
                    !canSpeak(
                      state.profiles.find((p) => p.id === m.audit?.profileId),
                      state.settings.audio,
                    ))
                }
                onPress={() => (speaking === m.id ? stop() : void read(m))}
              />
              <Button
                secondary
                title="What was checked"
                icon="shield-checkmark-outline"
                onPress={() => setInspect(inspect === m.id ? null : m.id)}
              />
            </View>
            {inspect === m.id && m.audit && (
              <View style={{ gap: 9, paddingTop: 10 }}>
                <Badge>{m.audit.decision.toUpperCase()} · FIXTURE</Badge>
                <Body style={{ fontSize: 13 }}>{m.audit.summary}</Body>
                {m.audit.checks.map((check) => (
                  <Body style={s.small} key={check}>
                    ✓ {check}
                  </Body>
                ))}
                <Body style={s.small}>
                  Profile:{" "}
                  {state.profiles.find((p) => p.id === m.audit?.profileId)
                    ?.revision ?? "removed"}{" "}
                  · {m.audit.attempts} check{m.audit.attempts === 1 ? "" : "s"}
                  {"\n"}Suggestion: {m.audit.suggestionVersion} · Audit:{" "}
                  {m.audit.auditVersion}
                  {"\n"}Models: none (local fixtures)
                </Body>
              </View>
            )}
          </Card>
        ),
      )}
      {!!phase && (
        <View
          accessibilityLiveRegion="polite"
          style={[s.row, { flexWrap: "wrap" }]}
        >
          <ActivityIndicator color={C.green} />
          <Body muted style={{ flex: 1 }}>
            {phase}
          </Body>
          <Button
            secondary
            title="Cancel"
            onPress={() => {
              nonce.current++;
              busy.current = false;
              setPhase("");
              setError("Request cancelled. Retry when you are ready.");
            }}
          />
        </View>
      )}
      {!!error && (
        <Body accessibilityLiveRegion="polite" style={{ color: C.danger }}>
          {error}
        </Body>
      )}
      {!phase && !session.messages.length && (
        <Button
          title="Help me get started"
          icon="sparkles-outline"
          disabled={!profile}
          onPress={() => void generate("start", "Help me get started.")}
        />
      )}
      {!phase && last?.role === "user" && (
        <Card>
          <Body muted>This request has no reply yet. You can retry it.</Body>
          <Button
            title="Retry last request"
            disabled={!profile}
            icon="refresh"
            onPress={() =>
              void generate(last.action ?? "follow_up", last.text, true)
            }
          />
        </Card>
      )}
      {last?.role === "assistant" && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {(
            [
              { action: "another", text: "Another idea" },
              { action: "simplify", text: "Make it simpler" },
              { action: "encourage", text: "Encourage me" },
            ] as const
          )
            .filter(
              (item) =>
                state.settings.affirmations || item.action !== "encourage",
            )
            .map((item) => (
              <Button
                key={item.action}
                secondary
                title={item.text}
                disabled={!!phase || !profile}
                onPress={() => void generate(item.action, `${item.text}.`)}
              />
            ))}
        </View>
      )}
      <View style={{ gap: 10 }}>
        <TextField
          accessibilityLabel="Follow-up message"
          placeholder="Ask for another idea, or help taking a break…"
          multiline
          maxLength={2000}
          value={message}
          onChangeText={setMessage}
        />
        <Button
          title="Send message"
          icon="arrow-up"
          disabled={!message.trim() || !!phase || !profile}
          onPress={() => void generate("follow_up", message.trim())}
        />
        <Body style={s.small}>
          {session.persisted === false
            ? "Temporary chat: it will disappear after closing the app. "
            : ""}
          Offline replies follow a script. Use the quick actions or ask for a
          break. Custom questions need a live service in a later milestone.
        </Body>
      </View>
      <Confirm
        visible={deleting}
        title="Delete this chat?"
        description="This removes its messages and check records from this device. It cannot be undone."
        confirm="Delete chat"
        onCancel={() => setDeleting(false)}
        onConfirm={() => {
          nonce.current++;
          stop();
          setState((prev) => ({
            ...prev,
            sessions: prev.sessions.filter((s) => s.id !== id),
          }));
          router.replace("/chats");
        }}
      />
    </Page>
  );
}
