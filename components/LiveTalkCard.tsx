import React, { useCallback, useEffect, useRef, useState } from "react";
import { Platform, Pressable, View } from "react-native";
import { useAudioStream } from "expo-audio";
import { Badge, Body, Button, C, Card, Icon, s } from "./ui";
import { useApp } from "../src/state/AppProvider";
import { hasGeminiConsent, type Profile } from "../src/domain/types";
import { LiveSession } from "../src/services/liveSession";
import {
  LivePlaybackQueue,
  prepareLiveAudioMode,
} from "../src/services/liveAudio";
import { audioRouteHint, audioRouteLabel } from "../src/services/audioRoute";

type Phase =
  | "idle"
  | "connecting"
  | "ready"
  | "listening"
  | "speaking"
  | "error";

export function LiveTalkCard({
  room,
}: {
  room?: string;
}) {
  const { state, profile } = useApp();
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [holding, setHolding] = useState(false);
  const sessionRef = useRef<LiveSession | null>(null);
  const playbackRef = useRef<LivePlaybackQueue | null>(null);
  const holdingRef = useRef(false);
  const readyRef = useRef(false);

  const { stream, isStreaming } = useAudioStream({
    sampleRate: 16_000,
    channels: 1,
    encoding: "int16",
    onBuffer: (buffer) => {
      if (!holdingRef.current || !readyRef.current) return;
      sessionRef.current?.sendPcm(new Uint8Array(buffer.data));
    },
  });

  const tearDown = useCallback(async () => {
    holdingRef.current = false;
    setHolding(false);
    try {
      if (stream.isStreaming) stream.stop();
    } catch {
      /* ignore */
    }
    sessionRef.current?.close();
    sessionRef.current = null;
    readyRef.current = false;
    await playbackRef.current?.dispose();
    playbackRef.current = null;
    setPhase("idle");
  }, [stream]);

  useEffect(() => {
    return () => {
      void tearDown();
    };
  }, [tearDown]);

  async function startSession() {
    if (!profile) {
      setError("Complete and confirm your quiz before Live talk.");
      setPhase("error");
      return;
    }
    if (!hasGeminiConsent(state.settings)) {
      setError("Turn on live AI processing in Settings first.");
      setPhase("error");
      return;
    }
    if (!state.settings.voiceConsent) {
      setError("Allow voice capture in Settings so Live talk can use the mic.");
      setPhase("error");
      return;
    }
    if (Platform.OS === "web") {
      setError("Live talk needs the phone build with glasses Bluetooth audio.");
      setPhase("error");
      return;
    }
    setError("");
    setPhase("connecting");
    try {
      await prepareLiveAudioMode();
      const playback = new LivePlaybackQueue();
      playbackRef.current = playback;
      const session = new LiveSession({
        onReady: () => {
          readyRef.current = true;
          setPhase("ready");
        },
        onAudio: (pcm) => {
          setPhase("speaking");
          playback.enqueue(pcm);
        },
        onInterrupted: () => {
          playback.interrupt();
          setPhase(holdingRef.current ? "listening" : "ready");
        },
        onTurnComplete: () => {
          if (!holdingRef.current) setPhase("ready");
        },
        onError: (message) => {
          setError(message);
          setPhase("error");
        },
        onClose: () => {
          readyRef.current = false;
          setPhase((prev) => (prev === "error" ? prev : "idle"));
        },
      });
      sessionRef.current = session;
      await session.connect({
        apiUrl: state.settings.apiUrl,
        room,
        shareProfile: state.settings.shareProfile !== false,
        localProfile: profile as Profile,
      });
      setPhase("ready");
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not start Live talk. Check the server and GEMINI_API_KEY.",
      );
      setPhase("error");
      await tearDown();
    }
  }

  async function beginTalk() {
    if (!sessionRef.current || !readyRef.current) return;
    playbackRef.current?.interrupt();
    holdingRef.current = true;
    setHolding(true);
    setPhase("listening");
    setError("");
    try {
      if (!stream.isStreaming) await stream.start();
    } catch (e) {
      holdingRef.current = false;
      setHolding(false);
      setError(
        e instanceof Error
          ? e.message
          : "Could not open the microphone / glasses HFP route.",
      );
      setPhase("error");
    }
  }

  function endTalk() {
    if (!holdingRef.current) return;
    holdingRef.current = false;
    setHolding(false);
    try {
      if (stream.isStreaming) stream.stop();
    } catch {
      /* ignore */
    }
    sessionRef.current?.endAudio();
    setPhase("speaking");
  }

  const route = audioRouteLabel(audioRouteHint());
  const active = phase === "ready" || phase === "listening" || phase === "speaking";

  return (
    <Card>
      <View style={s.row}>
        <Icon name="mic-outline" />
        <Body style={{ fontWeight: "700", flex: 1 }}>Live talk</Body>
        <Badge warm={phase !== "ready" && phase !== "listening" && phase !== "speaking"}>
          {phase === "listening"
            ? "LISTENING"
            : phase === "speaking"
              ? "SPEAKING"
              : phase === "ready"
                ? "READY"
                : phase === "connecting"
                  ? "CONNECTING"
                  : "OFF"}
        </Badge>
      </View>
      <Body muted>
        Realtime Gemini voice through your Meta glasses (Bluetooth mic and
        speaker). Hold to talk — release to hear the reply. Not a recorded
        transcript clip.
      </Body>
      <Body muted style={s.small}>
        {route}
        {isStreaming ? " · mic open" : ""}
      </Body>
      {!!room && (
        <Body style={s.small}>Room context: {room.slice(0, 120)}</Body>
      )}
      {error ? <Body style={{ color: C.danger }}>{error}</Body> : null}
      <View style={{ gap: 8 }}>
        {!active ? (
          <Button
            title="Start live talk"
            icon="radio-outline"
            onPress={() => void startSession()}
            busy={phase === "connecting"}
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
              onPressIn={() => void beginTalk()}
              onPressOut={endTalk}
              style={({ pressed }) => [
                s.button,
                {
                  backgroundColor: holding || pressed ? C.danger : C.green,
                  minHeight: 56,
                },
              ]}
            >
              <Icon name="mic" size={20} color="#fff" />
              <Body style={[s.buttonText, { color: "#fff" }]}>
                {holding ? "Listening… release to reply" : "Hold to talk"}
              </Body>
            </Pressable>
            <Button
              secondary
              title="End live talk"
              icon="stop-outline"
              onPress={() => void tearDown()}
            />
          </>
        )}
      </View>
      {!state.settings.voiceConsent || !hasGeminiConsent(state.settings) ? (
        <Body style={s.small}>
          Settings: allow live AI processing and voice capture, then return here.
        </Body>
      ) : null}
    </Card>
  );
}
