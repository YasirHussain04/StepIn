import React, { useCallback, useEffect, useRef, useState } from "react";
import { AppState, View } from "react-native";
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { useFocusEffect } from "expo-router";
import * as Speech from "expo-speech";
import { Body, Button, C, s } from "./ui";
import { useApp } from "../src/state/AppProvider";
import { discardAudio } from "../src/services/audioFiles";
import { transcribeClip } from "../src/services/transcribe";
export function VoiceRecorder({
  onTranscript,
  disabled = false,
}: {
  onTranscript: (text: string) => void;
  disabled?: boolean;
}) {
  const { state, setState, account } = useApp();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recording = useAudioRecorderState(recorder, 200);
  const player = useAudioPlayer(null);
  const playback = useAudioPlayerStatus(player);
  const [uri, setUri] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const current = useRef({ uri: null as string | null, recording: false });
  const abort = useRef<AbortController | null>(null);
  const stopping = useRef(false);
  const mounted = useRef(true);
  const generation = useRef(0);
  const clean = useCallback(async () => {
    generation.current++;
    abort.current?.abort();
    try {
      player.pause();
    } catch {}
    if (current.current.recording || recorder.isRecording) {
      try {
        await recorder.stop();
      } catch {}
      current.current.recording = false;
    }
    const clip = current.current.uri ?? recorder.uri;
    current.current.uri = null;
    if (clip) await discardAudio(clip);
    if (mounted.current) {
      setUri(null);
      setBusy(false);
    }
    await setAudioModeAsync({ allowsRecording: false }).catch(() => {});
  }, [recorder, player]);
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
      if (status !== "active") void clean();
    });
    return () => {
      mounted.current = false;
      sub.remove();
      void clean();
    };
  }, [clean]);
  useEffect(() => {
    void clean();
  }, [account?.user.id]);
  async function stopRecording() {
    if (stopping.current) return;
    stopping.current = true;
    try {
      const seconds = Math.min(
        45,
        Math.max(0.1, recording.durationMillis / 1000),
      );
      await recorder.stop();
      current.current.recording = false;
      await setAudioModeAsync({ allowsRecording: false });
      const clip = recorder.uri;
      if (clip && mounted.current) {
        current.current.uri = clip;
        setUri(clip);
        setDuration(seconds);
        player.replace(clip);
      }
    } catch {
      if (mounted.current)
        setError(
          "Could not finish recording. You can record again or type instead.",
        );
    } finally {
      stopping.current = false;
    }
  }
  useEffect(() => {
    if (recording.isRecording && recording.durationMillis >= 45_000)
      void stopRecording();
  }, [recording.durationMillis, recording.isRecording]);
  useEffect(() => {
    if (
      current.current.recording &&
      !recording.isRecording &&
      recording.durationMillis > 0 &&
      recorder.uri
    ) {
      current.current.recording = false;
      current.current.uri = recorder.uri;
      setUri(recorder.uri);
      setDuration(Math.min(45, recording.durationMillis / 1000));
      player.replace(recorder.uri);
      void setAudioModeAsync({ allowsRecording: false });
    }
  }, [recording.isRecording, recording.durationMillis]);
  async function start() {
    try {
      setError("");
      await clean();
      await Speech.stop();
      const ticket = generation.current;
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!mounted.current || ticket !== generation.current) return;
      if (!permission.granted) {
        setError(
          "Microphone access is off. Enable it in device settings, use keyboard dictation, or type below.",
        );
        return;
      }
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
        shouldPlayInBackground: false,
      });
      await recorder.prepareToRecordAsync({
        ...RecordingPresets.HIGH_QUALITY,
        directory: "cache",
        fileName: `stepin-voice-${Date.now()}`,
      });
      if (!mounted.current || ticket !== generation.current) {
        await clean();
        return;
      }
      recorder.record({ forDuration: 45 });
      current.current.recording = true;
    } catch {
      setError(
        "Recording is unavailable on this device. Keyboard dictation and typing remain available.",
      );
    }
  }
  async function transcribe() {
    if (!uri || !state.settings.voiceConsent) return;
    const ticket = ++generation.current;
    abort.current = new AbortController();
    setBusy(true);
    setError("");
    player.pause();
    const timeout = setTimeout(() => abort.current?.abort(), 60_000);
    try {
      const text = await transcribeClip(
        uri,
        duration,
        state.settings.apiUrl,
        abort.current.signal,
      );
      if (mounted.current && generation.current === ticket) {
        onTranscript(text);
        await clean();
      }
    } catch (e) {
      if (mounted.current && generation.current === ticket)
        setError(
          e instanceof Error
            ? e.message
            : "Transcription failed. Retry, discard, or type instead.",
        );
    } finally {
      clearTimeout(timeout);
      if (mounted.current && generation.current === ticket) setBusy(false);
    }
  }
  return (
    <View
      style={{
        gap: 12,
        width: "100%",
        backgroundColor: C.sage,
        padding: 15,
        borderRadius: 14,
      }}
    >
      <Body style={{ fontWeight: "600" }}>Record a voice message</Body>
      <Body style={s.small}>
        Up to 45 seconds, only while this screen is open. Review your recording,
        then choose whether to send it to StepIn’s server and Google for
        transcription. The editable transcript is not sent as a chat until you
        submit it.
      </Body>
      {recording.isRecording ? (
        <>
          <Body accessibilityLiveRegion="polite">
            Recording · {Math.floor(recording.durationMillis / 1000)} / 45
            seconds
          </Body>
          <Button
            title="Stop recording"
            icon="stop"
            onPress={() => void stopRecording()}
          />
          <Button
            secondary
            title="Cancel & discard"
            onPress={() => void clean()}
          />
        </>
      ) : uri ? (
        <>
          <Body>Recording ready · {Math.round(duration)} seconds</Body>
          <Button
            secondary
            title={playback.playing ? "Stop preview" : "Preview recording"}
            icon={playback.playing ? "stop" : "play-outline"}
            onPress={() => {
              if (playback.playing) player.pause();
              else {
                void player.seekTo(0);
                player.play();
              }
            }}
          />
          <Button
            secondary
            title={
              state.settings.voiceConsent
                ? "Remote transcription allowed"
                : "Allow remote transcription"
            }
            icon={
              state.settings.voiceConsent ? "checkmark" : "cloud-upload-outline"
            }
            onPress={() =>
              setState((prev) => ({
                ...prev,
                settings: {
                  ...prev.settings,
                  voiceConsent: !prev.settings.voiceConsent,
                },
              }))
            }
          />
          <Body style={s.small}>
            StepIn keeps the upload in memory and does not save raw audio on the
            server. Google may retain processing data under your project’s
            configured terms. Local temporary files are removed on discard,
            success or leaving the screen; an interrupted app may leave OS cache
            files.
          </Body>
          <Button
            title={busy ? "Transcribing…" : "Transcribe & review text"}
            icon="document-text-outline"
            busy={busy}
            disabled={!state.settings.voiceConsent || !account}
            onPress={() => void transcribe()}
          />
          {!account && (
            <Body style={s.small}>
              Sign in through Settings to transcribe. Recording preview and
              typed input are available without an account.
            </Body>
          )}
          <Button
            secondary
            title={busy ? "Cancel upload & discard" : "Discard recording"}
            onPress={() => void clean()}
          />
        </>
      ) : (
        <Button
          title="Start recording"
          icon="mic-outline"
          disabled={disabled}
          onPress={() => void start()}
        />
      )}
      {!!error && (
        <Body accessibilityLiveRegion="polite" style={{ color: C.danger }}>
          {error}
        </Body>
      )}
    </View>
  );
}
