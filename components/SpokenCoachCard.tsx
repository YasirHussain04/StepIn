import React, { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform, Pressable, View } from "react-native";
import { useFocusEffect } from "expo-router";
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
import { prepareHeldRecording } from "../src/services/heldRecording";
import { approvedSpokenText } from "../src/services/playback";
import { audioRouteHint, audioRouteLabel } from "../src/services/audioRoute";
import type { SceneSummary } from "../shared/contracts";

type Phase =
  | "idle"
  | "starting"
  | "ready"
  | "listening"
  | "thinking"
  | "speaking"
  | "error";

export function SpokenCoachCard({
  room,
  scene,
  sessionId,
}: {
  room: string;
  scene?: SceneSummary;
  sessionId?: string;
}) {
  const { state, setState, profile, account, getState } = useApp();
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [lastLine, setLastLine] = useState("");
  const phaseRef = useRef<Phase>("idle");
  const holding = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const chatId = useRef(sessionId ?? uid());
  const mounted = useRef(true);
  const generation = useRef(0);
  const preparing = useRef<Promise<void> | null>(null);
  const finishing = useRef<number | null>(null);
  const cleaning = useRef<Promise<void> | null>(null);
  const prepared = useRef(false);
  const startedAt = useRef<number | null>(null);
  const clip = useRef<string | null>(null);
  const limitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ profile, account });
  latest.current = { profile, account };
  const recorder = useAudioRecorder(TRANSCRIBE_WAV_PRESET);
  const recording = useAudioRecorderState(recorder, 200);

  const transition = useCallback((next: Phase) => {
    phaseRef.current = next;
    if (mounted.current) setPhase(next);
  }, []);

  const clearLimit = useCallback(() => {
    if (limitTimer.current) clearTimeout(limitTimer.current);
    limitTimer.current = null;
  }, []);

  const clean = useCallback(() => {
    generation.current++;
    holding.current = false;
    finishing.current = null;
    clearLimit();
    abort.current?.abort();
    void Speech.stop().catch(() => {});
    transition("idle");
    if (cleaning.current) return cleaning.current;
    const task = (async () => {
      // A release or navigation can arrive while the native recorder prepares.
      await preparing.current?.catch(() => {});
      try {
        if (prepared.current || recorder.isRecording) {
          try {
            await recorder.stop();
          } catch {}
        }
        const uri = clip.current ?? recorder.uri;
        if (uri) await discardAudio(uri);
      } catch {
        // The native recorder may already be released during unmount.
      } finally {
        prepared.current = false;
        startedAt.current = null;
        clip.current = null;
        await setAudioModeAsync({ allowsRecording: false }).catch(() => {});
      }
    })();
    cleaning.current = task;
    void task.finally(() => {
      if (cleaning.current === task) cleaning.current = null;
    });
    return task;
  }, [clearLimit, recorder, transition]);

  useFocusEffect(
    useCallback(() => {
      mounted.current = true;
      return () => {
        void clean();
      };
    }, [clean]),
  );
  useEffect(() => {
    const sub = AppState.addEventListener("change", (status) => {
      if (
        status === "background" ||
        (status === "inactive" && phaseRef.current !== "starting")
      )
        void clean();
    });
    return () => {
      mounted.current = false;
      sub.remove();
      void clean();
    };
  }, [clean]);
  useEffect(() => {
    void clean();
    chatId.current = sessionId ?? uid();
    setLastLine("");
    setError("");
  }, [
    sessionId,
    room,
    profile?.id,
    account?.user.id,
    state.settings.processingConsent,
    state.settings.processingProvider,
    state.settings.voiceConsent,
    state.settings.audio,
    state.settings.apiUrl,
    clean,
  ]);

  async function ensureReady() {
    if (phaseRef.current === "starting") return;
    transition("starting");
    await cleaning.current;
    const ticket = generation.current;
    if (!mounted.current) return;
    const current = getState();
    const currentProfile = latest.current.profile;
    setError("");
    try {
      if (!currentProfile)
        throw new Error("Complete the quiz so coaching can match your style.");
      if (!hasGeminiConsent(current.settings))
        throw new Error("Turn on live AI processing in Settings.");
      if (!current.settings.voiceConsent)
        throw new Error("Allow voice capture in Settings.");
      if (Platform.OS === "web")
        throw new Error(
          "Spoken coaching needs the phone build for glasses audio.",
        );
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!mounted.current || ticket !== generation.current) return;
      if (!permission.granted)
        throw new Error("Microphone permission is required for hold-to-talk.");
      transition("ready");
    } catch (e) {
      if (!mounted.current || ticket !== generation.current) return;
      setError(
        e instanceof Error ? e.message : "Could not open the microphone.",
      );
      transition("error");
    }
  }

  async function beginHold() {
    if (
      preparing.current ||
      cleaning.current ||
      (finishing.current !== null && phaseRef.current !== "speaking") ||
      (phaseRef.current !== "ready" && phaseRef.current !== "speaking")
    )
      return;
    const ticket = ++generation.current;
    holding.current = true;
    transition("listening");
    setError("");
    const task = prepareHeldRecording({
      isHeld: () => holding.current,
      isCurrent: () => ticket === generation.current,
      stopSpeech: () => Speech.stop(),
      configureAudio: () =>
        setAudioModeAsync({
          allowsRecording: true,
          playsInSilentMode: true,
          shouldPlayInBackground: false,
          interruptionMode: "doNotMix",
          shouldRouteThroughEarpiece: false,
        }),
      prepare: () =>
        recorder.prepareToRecordAsync({
          ...TRANSCRIBE_WAV_PRESET,
          directory: "cache",
          fileName: `stepin-spoken-${Date.now()}`,
        }),
      onPrepared: () => {
        prepared.current = true;
      },
      record: () => {
        recorder.record({ forDuration: 45 });
        startedAt.current = Date.now();
        limitTimer.current = setTimeout(() => {
          void endHold();
        }, 45_000);
      },
    });
    preparing.current = task;
    try {
      await task;
    } catch {
      if (ticket !== generation.current || !mounted.current) return;
      const cleanup = clean();
      const cleanupTicket = generation.current;
      await cleanup;
      if (!mounted.current || generation.current !== cleanupTicket) return;
      setError("Could not open the mic / glasses HFP route.");
      transition("error");
    } finally {
      if (preparing.current === task) preparing.current = null;
    }
  }

  async function endHold() {
    if (!holding.current || finishing.current === generation.current) return;
    holding.current = false;
    clearLimit();
    const ticket = generation.current;
    finishing.current = ticket;
    const current = getState();
    const currentProfile = latest.current.profile;
    const owner = latest.current.account?.user.id;
    const valid = () =>
      mounted.current &&
      ticket === generation.current &&
      latest.current.profile?.id === currentProfile?.id &&
      latest.current.account?.user.id === owner;
    let uri: string | null = null;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    transition("thinking");
    try {
      await preparing.current;
      if (!valid()) return;
      const didRecord = startedAt.current !== null;
      const seconds = Math.min(
        45,
        Math.max(
          0.1,
          startedAt.current === null
            ? 0
            : (Date.now() - startedAt.current) / 1000,
        ),
      );
      if (prepared.current) {
        await recorder.stop();
        prepared.current = false;
      }
      uri = recorder.uri;
      clip.current = uri;
      startedAt.current = null;
      await setAudioModeAsync({ allowsRecording: false });
      if (!valid()) return;
      if (!didRecord) {
        if (uri) await discardAudio(uri);
        clip.current = null;
        uri = null;
        transition("ready");
        return;
      }
      if (!uri) throw new Error("No recording captured. Hold to talk again.");
      if (
        !currentProfile ||
        !hasGeminiConsent(current.settings) ||
        !current.settings.voiceConsent
      )
        throw new Error(
          "Confirm your profile and voice permissions in Settings.",
        );
      const controller = new AbortController();
      abort.current = controller;
      const signal = controller.signal;
      timeout = setTimeout(() => controller.abort(), 150_000);
      const text = await transcribeClip(
        uri,
        seconds,
        current.settings.apiUrl,
        signal,
      );
      await discardAudio(uri);
      clip.current = null;
      uri = null;
      if (!valid()) return;
      if (!text.trim()) {
        setError("Didn’t catch that. Hold again and speak a bit louder.");
        transition("ready");
        return;
      }
      const messageId = uid();
      const requestId = uid();
      const sid = chatId.current;
      const action = lastLine ? "follow_up" : "start";
      const result = await liveCoach(
        {
          requestId,
          sessionId: sid,
          messageId,
          message: text.trim(),
          action,
          expectedProfileVersionId: currentProfile.id,
          history: false,
          shareProfile: current.settings.shareProfile !== false,
          affirmations: current.settings.affirmations,
          processingConsent: true,
          processingProvider: "gemini",
          localProfile: currentProfile,
          transientRoom: { description: room },
          ...(scene ? { scene } : {}),
        },
        current.settings.apiUrl,
        signal,
      );
      if (!valid()) return;
      const nowState = getState();
      // The approval guard also checks the audit's original profile. Never
      // fall back to speaking raw model text when this check fails.
      const spoken =
        result.message.audit?.decision === "approved" &&
        canSpeak(currentProfile, nowState.settings.audio)
          ? approvedSpokenText(
              result.message,
              currentProfile,
              nowState.profiles,
              nowState.settings.audio,
              nowState.settings.affirmations,
            )
          : null;
      const visibleText = [
        result.message.text,
        result.message.icebreaker,
        nowState.settings.affirmations ? result.message.affirmation : undefined,
      ]
        .filter(Boolean)
        .join("\n");
      setLastLine(visibleText);
      setState((prev) => {
        const userMsg: Message = {
          id: messageId,
          role: "user",
          text: text.trim(),
          createdAt: new Date().toISOString(),
          action,
          persisted: false,
          requestId,
          requestProfileId: currentProfile.id,
        };
        const assistant = { ...result.message, persisted: false };
        const now = new Date().toISOString();
        if (!prev.sessions.some((s) => s.id === sid))
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
      if (spoken) {
        transition("speaking");
        await new Promise<void>((resolve) => {
          Speech.speak(spoken, {
            rate: nowState.settings.rate,
            onDone: resolve,
            onStopped: resolve,
            onError: () => resolve(),
          });
        });
      }
      if (valid()) transition("ready");
    } catch (e) {
      if (!valid()) return;
      const detail =
        e instanceof ClientError && e.code === "CANCELLED"
          ? "The request timed out. Hold to talk again."
          : e instanceof Error
            ? e.message
            : "Coaching did not finish. Try again.";
      const cleanup = clean();
      const cleanupTicket = generation.current;
      await cleanup;
      if (!mounted.current || generation.current !== cleanupTicket) return;
      setError(detail);
      transition("error");
    } finally {
      clearTimeout(timeout);
      if (uri) await discardAudio(uri);
      if (clip.current === uri) clip.current = null;
      if (finishing.current === ticket) finishing.current = null;
    }
  }

  const route = audioRouteLabel(audioRouteHint());
  const active = phase !== "idle" && phase !== "error" && phase !== "starting";

  return (
    <Card>
      <View style={s.row}>
        <Icon name="ear-outline" />
        <Body style={{ fontWeight: "700", flex: 1 }}>Spoken coaching</Body>
        <Badge
          warm={
            phase !== "ready" && phase !== "listening" && phase !== "speaking"
          }
        >
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
        Hold to talk on your phone. StepIn drafts advice from the scene and your
        style card, checks it fits you, then speaks only if it passes.
      </Body>
      <Body muted style={s.small}>
        {route}
        {recording.isRecording ? " · mic open" : ""}
      </Body>
      {!!lastLine && (
        <Body style={s.small}>Last guidance: {lastLine.slice(0, 180)}</Body>
      )}
      {error ? <Body style={{ color: C.danger }}>{error}</Body> : null}
      <View style={{ gap: 8 }}>
        {!active ? (
          <Button
            title="Start spoken coaching"
            busy={phase === "starting"}
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
                void clean();
              }}
            />
          </>
        )}
      </View>
    </Card>
  );
}
