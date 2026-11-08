import React, { useCallback, useEffect, useRef, useState } from "react";
import { Platform, Pressable, View } from "react-native";
import {
  AudioModule,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { TRANSCRIBE_WAV_PRESET } from "../src/services/recordingPresets";
import * as Speech from "expo-speech";
import { Badge, Body, Button, C, Card, Icon, s } from "./ui";
import { useApp } from "../src/state/AppProvider";
import { hasGeminiConsent, uid, type Message } from "../src/domain/types";
import { canSpeak } from "../src/domain/quiz";
import { liveCoach, ClientError } from "../src/services/api";
import { transcribeClip } from "../src/services/transcribe";
import { discardAudio } from "../src/services/audioFiles";
import { approvedSpokenText } from "../src/services/playback";
import { audioRouteHint, audioRouteLabel } from "../src/services/audioRoute";
import type { SceneSummary } from "../shared/contracts";

type Phase = "idle" | "ready" | "listening" | "thinking" | "speaking" | "error";

export function SpokenCoachCard({
  room,
  scene,
  sessionId,
  glassesConnected = false,
}: {
  room: string;
  scene?: SceneSummary;
  sessionId?: string;
  glassesConnected?: boolean;
}) {
  const { state, setState, profile } = useApp();
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [lastLine, setLastLine] = useState("");
  const holding = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const chatId = useRef(sessionId ?? uid());
  const recorder = useAudioRecorder(TRANSCRIBE_WAV_PRESET);
  const recording = useAudioRecorderState(recorder, 200);

  useEffect(() => {
    chatId.current = sessionId ?? chatId.current;
  }, [sessionId]);

  const stopSpeech = useCallback(() => {
    void Speech.stop();
  }, []);

  useEffect(() => () => {
    abort.current?.abort();
    stopSpeech();
  }, [stopSpeech]);

  async function ensureReady() {
    if (!profile) {
      setError("Complete the quiz so coaching can match your style.");
      setPhase("error");
      return false;
    }
    if (!hasGeminiConsent(state.settings)) {
      setError("Turn on live AI processing in Settings.");
      setPhase("error");
      return false;
    }
    if (!state.settings.voiceConsent) {
      setError("Allow voice capture in Settings.");
      setPhase("error");
      return false;
    }
    if (Platform.OS === "web") {
      setError("Spoken coaching needs the phone build for glasses audio.");
      setPhase("error");
      return false;
    }
    const permission = await AudioModule.requestRecordingPermissionsAsync();
    if (!permission.granted) {
      setError("Microphone permission is required for hold-to-talk.");
      setPhase("error");
      return false;
    }
    await setAudioModeAsync({
      allowsRecording: true,
      playsInSilentMode: true,
      shouldPlayInBackground: false,
      interruptionMode: "doNotMix",
      shouldRouteThroughEarpiece: false,
    });
    setPhase("ready");
    setError("");
    return true;
  }

  async function beginHold() {
    if (phase === "thinking") return;
    stopSpeech();
    if (phase === "idle" || phase === "error") {
      const ok = await ensureReady();
      if (!ok) return;
    }
    holding.current = true;
    setPhase("listening");
    setError("");
    try {
      await recorder.prepareToRecordAsync({
        ...TRANSCRIBE_WAV_PRESET,
        directory: "cache",
        fileName: `stepin-spoken-${Date.now()}`,
      });
      recorder.record({ forDuration: 45 });
    } catch {
      holding.current = false;
      setError("Could not open the mic / glasses HFP route.");
      setPhase("error");
    }
  }

  async function endHold() {
    if (!holding.current) return;
    holding.current = false;
    setPhase("thinking");
    let uri: string | null = null;
    try {
      const durationSec = Math.max(
        1,
        Math.round((recording.durationMillis || 1000) / 1000),
      );
      await recorder.stop();
      uri = recorder.uri;
      if (!uri) throw new Error("No recording captured.");
      abort.current?.abort();
      abort.current = new AbortController();
      const signal = abort.current.signal;
      const text = await transcribeClip(
        uri,
        durationSec,
        state.settings.apiUrl,
        signal,
      );
      await discardAudio(uri);
      uri = null;
      if (!text.trim()) {
        setError("Didn’t catch that. Hold again and speak a bit louder.");
        setPhase("ready");
        return;
      }
      if (!profile) throw new Error("Profile missing.");
      const messageId = uid();
      const requestId = uid();
      const sid = chatId.current;
      const cloudSync = !!state.cloud?.enabled;
      const history = false;
      const result = await liveCoach(
        {
          requestId,
          sessionId: sid,
          messageId,
          message: text.trim(),
          action: lastLine ? "follow_up" : "start",
          expectedProfileVersionId: profile.id,
          history,
          shareProfile: state.settings.shareProfile !== false,
          affirmations: state.settings.affirmations,
          processingConsent: true,
          processingProvider: "gemini",
          localProfile: profile,
          transientRoom: {
            description: room,
            scenarioId: undefined,
          },
          ...(scene ? { scene } : {}),
        },
        state.settings.apiUrl,
        signal,
      );
      let spoken: string;
      try {
        spoken = approvedSpokenText(
          result.message,
          profile,
          state.profiles,
          state.settings.audio !== false,
          state.settings.affirmations,
        );
      } catch {
        spoken =
          result.message.text ||
          "I need a bit more detail before I suggest a next step.";
      }
      setLastLine(spoken);
      setState((prev) => {
        const exists = prev.sessions.some((s) => s.id === sid);
        const now = new Date().toISOString();
        const userMsg: Message = {
          id: messageId,
          role: "user",
          text: text.trim(),
          createdAt: now,
          action: lastLine ? "follow_up" : "start",
          persisted: false,
          requestId,
          requestProfileId: profile.id,
        };
        const assistant = { ...result.message, persisted: false };
        if (!exists) {
          return {
            ...prev,
            sessions: [
              {
                id: sid,
                title: "Spoken coaching",
                room,
                createdAt: now,
                updatedAt: now,
                messages: [userMsg, assistant],
                persisted: false,
                mode: "live" as const,
              },
              ...prev.sessions,
            ],
            scenes: scene
              ? { ...(prev.scenes ?? {}), [sid]: scene }
              : prev.scenes,
          };
        }
        return {
          ...prev,
          sessions: prev.sessions.map((s) =>
            s.id === sid
              ? {
                  ...s,
                  messages: [...s.messages, userMsg, assistant],
                  updatedAt: now,
                }
              : s,
          ),
        };
      });
      setPhase("speaking");
      if (canSpeak(profile, state.settings.audio !== false)) {
        await new Promise<void>((resolve) => {
          Speech.speak(spoken, {
            rate: state.settings.rate ?? 0.9,
            onDone: () => resolve(),
            onStopped: () => resolve(),
            onError: () => resolve(),
          });
        });
      }
      setPhase("ready");
    } catch (e) {
      if (uri) await discardAudio(uri);
      if (e instanceof ClientError && e.code === "CANCELLED") {
        setPhase("ready");
        return;
      }
      setError(
        e instanceof Error
          ? e.message
          : "Coaching did not pass its style check. Try again.",
      );
      setPhase("error");
    }
  }

  const route = audioRouteLabel(audioRouteHint(glassesConnected));
  const active = phase !== "idle" && phase !== "error";

  return (
    <Card>
      <View style={s.row}>
        <Icon name="ear-outline" />
        <Body style={{ fontWeight: "700", flex: 1 }}>Spoken coaching</Body>
        <Badge warm={phase !== "ready" && phase !== "listening" && phase !== "speaking"}>
          {phase === "listening"
            ? "LISTENING"
            : phase === "thinking"
              ? "CHECKING STYLE"
              : phase === "speaking"
                ? "SPEAKING"
                : phase === "ready"
                  ? "READY"
                  : "OFF"}
        </Badge>
      </View>
      <Body muted>
        Hold to talk through your glasses. StepIn drafts advice from the scene
        and your style card, checks it fits you, then speaks only if it passes.
      </Body>
      <Body muted style={s.small}>
        {route}
        {recording.isRecording ? " · mic open" : ""}
      </Body>
      {!!lastLine && (
        <Body style={s.small}>Last approved line: {lastLine.slice(0, 180)}</Body>
      )}
      {error ? <Body style={{ color: C.danger }}>{error}</Body> : null}
      <View style={{ gap: 8 }}>
        {!active ? (
          <Button
            title="Start spoken coaching"
            icon="radio-outline"
            onPress={() => void ensureReady()}
            disabled={
              !profile ||
              !hasGeminiConsent(state.settings) ||
              !state.settings.voiceConsent
            }
          />
        ) : (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Hold to talk"
              onPressIn={() => void beginHold()}
              onPressOut={() => void endHold()}
              disabled={phase === "thinking"}
              style={({ pressed }) => [
                s.button,
                {
                  backgroundColor:
                    phase === "listening" || pressed ? C.danger : C.green,
                  minHeight: 56,
                  opacity: phase === "thinking" ? 0.45 : 1,
                },
              ]}
            >
              <Icon name="mic" size={20} color="#fff" />
              <Body style={[s.buttonText, { color: "#fff" }]}>
                {phase === "thinking"
                  ? "Checking it fits your style…"
                  : phase === "listening"
                    ? "Listening… release when done"
                    : "Hold to talk"}
              </Body>
            </Pressable>
            <Button
              secondary
              title="End spoken coaching"
              icon="stop-outline"
              onPress={() => {
                abort.current?.abort();
                stopSpeech();
                holding.current = false;
                setPhase("idle");
              }}
            />
          </>
        )}
      </View>
    </Card>
  );
}
