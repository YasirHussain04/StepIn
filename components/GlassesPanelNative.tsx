import React, { useCallback, useEffect, useRef, useState } from "react";
import { Image, View } from "react-native";
import {
  useMetaWearables,
  EMWDATStreamView,
  type PhotoData,
} from "expo-meta-wearables-dat";
import { Badge, Body, Button, C, Card, Icon, s } from "./ui";
import { audioRouteHint, audioRouteLabel } from "../src/services/audioRoute";

export type CapturedStill = {
  uri: string;
  width?: number;
  height?: number;
};

function errorDetail(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === "string" && error.trim()) return error.trim();
  return fallback;
}

function registrationLabel(state: string) {
  switch (state) {
    case "registered":
      return "REGISTERED";
    case "registering":
      return "REGISTERING";
    case "available":
      return "AVAILABLE";
    case "unavailable":
      return "UNAVAILABLE";
    default:
      return String(state || "UNKNOWN").toUpperCase();
  }
}

export function GlassesPanelNative({
  onStillReady,
  onConnectedChange,
}: {
  onStillReady?: (still: CapturedStill | null) => void;
  onConnectedChange?: (connected: boolean) => void;
}) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [still, setStill] = useState<CapturedStill | null>(null);
  const pendingPhoto = useRef(false);
  const stillReady = useRef(onStillReady);
  stillReady.current = onStillReady;

  const {
    isConfigured,
    configError,
    registrationState,
    permissionStatus,
    devices,
    startRegistration,
    requestPermission,
    createSession,
    startSession,
    stopSession,
    addStreamToSession,
    capturePhoto,
  } = useMetaWearables({
    onPhotoCaptured: (photo: PhotoData) => {
      if (!pendingPhoto.current) return;
      pendingPhoto.current = false;
      const next: CapturedStill = {
        uri: photo.filePath.startsWith("file://")
          ? photo.filePath
          : `file://${photo.filePath}`,
        width: photo.width,
        height: photo.height,
      };
      setStill(next);
      stillReady.current?.(next);
      setBusy("");
    },
    onStreamError: () => {
      setError("The glasses camera stream stopped. Retry capture or reconnect.");
      setBusy("");
      pendingPhoto.current = false;
    },
  });

  const registered = registrationState === "registered";
  const connected = devices.some((d) => d.linkState === "connected");

  useEffect(() => {
    onConnectedChange?.(connected);
  }, [connected, onConnectedChange]);

  useEffect(() => {
    if (registrationState === "registering")
      setBusy("Waiting for Meta AI approval…");
  }, [registrationState]);

  const register = useCallback(async () => {
    setError("");
    setBusy("Opening Meta AI…");
    try {
      await startRegistration();
      if (registrationState !== "registered")
        setBusy("Waiting for Meta AI approval…");
    } catch (e) {
      setError(
        `${errorDetail(e, "Registration could not start.")} Update Meta AI, enable Developer Mode (tap App version 7×, toggle off→on), force-quit Meta AI, then retry.`,
      );
      setBusy("");
    }
  }, [startRegistration, registrationState]);

  const askCamera = useCallback(async () => {
    if (!registered) {
      setError("Register with Meta AI successfully before requesting camera access.");
      return;
    }
    setError("");
    setBusy("Requesting camera…");
    try {
      const status = await requestPermission("camera");
      if (status !== "granted")
        setError(
          `Camera permission is ${status}. Open Meta AI → App connections and allow camera for StepIn.`,
        );
    } catch (e) {
      setError(
        `${errorDetail(e, "Camera permission request failed.")} Finish registration first, then allow camera in Meta AI → App connections.`,
      );
    } finally {
      setBusy("");
    }
  }, [registered, requestPermission]);

  const beginSession = useCallback(async () => {
    if (!registered) {
      setError("Register with Meta AI before starting a camera session.");
      return;
    }
    setError("");
    setBusy("Starting glasses session…");
    try {
      const id = await createSession();
      await startSession(id);
      await addStreamToSession(id, { resolution: "medium", frameRate: 15 });
      setSessionId(id);
    } catch (e) {
      setError(
        `${errorDetail(e, "Could not start a glasses session.")} Confirm the glasses are worn, unfolded, and linked in Meta AI.`,
      );
      setSessionId(null);
    } finally {
      setBusy("");
    }
  }, [registered, createSession, startSession, addStreamToSession]);

  const endSession = useCallback(async () => {
    if (!sessionId) return;
    setBusy("Stopping…");
    try {
      await stopSession(sessionId);
    } catch {
      /* session may already be stopped */
    } finally {
      setSessionId(null);
      setBusy("");
    }
  }, [sessionId, stopSession]);

  const snap = useCallback(async () => {
    if (!registered) {
      setError("Register with Meta AI before capturing.");
      return;
    }
    if (!sessionId) {
      setError("Start a glasses session before capturing a still.");
      return;
    }
    setError("");
    setBusy("Capturing still…");
    pendingPhoto.current = true;
    try {
      await capturePhoto("jpeg");
    } catch (e) {
      pendingPhoto.current = false;
      setBusy("");
      setError(
        `${errorDetail(e, "Photo capture failed.")} Keep the session streaming and retry.`,
      );
    }
  }, [registered, sessionId, capturePhoto]);

  const discard = useCallback(() => {
    setStill(null);
    stillReady.current?.(null);
  }, []);

  const route = audioRouteLabel(audioRouteHint(connected));

  return (
    <Card>
      <View style={s.row}>
        <Icon name="glasses-outline" />
        <Body style={{ fontWeight: "700", flex: 1 }}>Meta glasses</Body>
        <Badge warm={!registered}>{registrationLabel(registrationState)}</Badge>
      </View>
      {configError ? (
        <Body style={{ color: C.danger }}>
          Native glasses setup failed. Rebuild the development client after
          configuring expo-meta-wearables-dat.
        </Body>
      ) : null}
      <Body muted style={s.small}>
        Configured: {String(isConfigured)} · Registration: {registrationState} ·
        Camera: {permissionStatus} · Devices: {devices.length}
        {connected ? " · linked" : ""}
      </Body>
      <Body muted style={s.small}>
        {route}
      </Body>
      {!registered ? (
        <Body muted style={s.small}>
          Camera stays locked until registration reaches registered. If Meta AI
          shows “Internal error,” update Meta AI and re-toggle Developer Mode.
        </Body>
      ) : null}
      {devices.map((device) => (
        <Body key={device.identifier} style={s.small}>
          {device.name || device.deviceType} · {device.linkState}
        </Body>
      ))}
      {error ? <Body style={{ color: C.danger }}>{error}</Body> : null}
      {busy ? <Body muted>{busy}</Body> : null}
      <View style={{ gap: 8 }}>
        {!registered ? (
          <Button
            title="Register with Meta AI"
            icon="link-outline"
            onPress={register}
            busy={registrationState === "registering" || busy === "Opening Meta AI…"}
          />
        ) : null}
        {permissionStatus !== "granted" ? (
          <Button
            secondary
            title="Allow glasses camera"
            icon="camera-outline"
            onPress={askCamera}
            disabled={!registered}
          />
        ) : null}
        {!sessionId ? (
          <Button
            title="Start camera session"
            icon="play-outline"
            onPress={beginSession}
            disabled={!registered}
          />
        ) : (
          <>
            <Button
              title="Capture still"
              icon="camera"
              onPress={snap}
              disabled={!registered}
            />
            <Button
              secondary
              title="Stop session"
              icon="stop-outline"
              onPress={endSession}
            />
          </>
        )}
      </View>
      {sessionId ? (
        <EMWDATStreamView
          isActive
          resizeMode="contain"
          style={{
            width: "100%",
            height: 180,
            backgroundColor: C.sage,
            borderRadius: 12,
            marginTop: 8,
          }}
        />
      ) : null}
      {still ? (
        <View style={{ gap: 8, marginTop: 8 }}>
          <Body style={{ fontWeight: "600" }}>Review captured still</Body>
          <Image
            source={{ uri: still.uri }}
            style={{
              width: "100%",
              height: 200,
              borderRadius: 12,
              backgroundColor: C.line,
            }}
            resizeMode="cover"
            accessibilityLabel="Captured glasses still"
          />
          <Button
            secondary
            title="Discard still"
            icon="trash-outline"
            onPress={discard}
          />
        </View>
      ) : null}
      <Body style={s.small}>
        Developer Mode: Meta AI → Settings → App Info → tap version 7×, toggle
        off→on. Local testing uses APPLICATION_ID/CLIENT_TOKEN 0 — no Meta
        developer account required.
      </Body>
    </Card>
  );
}
