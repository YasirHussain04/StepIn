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

  const connected = devices.some((d) => d.linkState === "connected");

  useEffect(() => {
    onConnectedChange?.(connected);
  }, [connected, onConnectedChange]);

  const register = useCallback(async () => {
    setError("");
    setBusy("Opening Meta AI…");
    try {
      await startRegistration();
    } catch {
      setError(
        "Could not start registration. Install Meta AI, enable Developer Mode (tap App version 5×), and try again.",
      );
    } finally {
      setBusy("");
    }
  }, [startRegistration]);

  const askCamera = useCallback(async () => {
    setError("");
    setBusy("Requesting camera…");
    try {
      const status = await requestPermission("camera");
      if (status !== "granted")
        setError("Camera permission was denied in Meta AI. Allow it to capture stills.");
    } catch {
      setError("Camera permission request failed. Check Meta AI → App connections.");
    } finally {
      setBusy("");
    }
  }, [requestPermission]);

  const beginSession = useCallback(async () => {
    setError("");
    setBusy("Starting glasses session…");
    try {
      const id = await createSession();
      await startSession(id);
      await addStreamToSession(id, { resolution: "medium", frameRate: 15 });
      setSessionId(id);
    } catch {
      setError(
        "Could not start a glasses session. Confirm the glasses are worn, unfolded, and linked in Meta AI.",
      );
      setSessionId(null);
    } finally {
      setBusy("");
    }
  }, [createSession, startSession, addStreamToSession]);

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
    if (!sessionId) {
      setError("Start a glasses session before capturing a still.");
      return;
    }
    setError("");
    setBusy("Capturing still…");
    pendingPhoto.current = true;
    try {
      await capturePhoto("jpeg");
    } catch {
      pendingPhoto.current = false;
      setBusy("");
      setError("Photo capture failed. Keep the session streaming and retry.");
    }
  }, [sessionId, capturePhoto]);

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
        <Badge warm={registrationState !== "registered"}>
          {registrationState === "registered" ? "REGISTERED" : "NOT REGISTERED"}
        </Badge>
      </View>
      {configError ? (
        <Body style={{ color: C.danger }}>
          Native glasses setup failed. Rebuild the development client after
          configuring expo-meta-wearables-dat.
        </Body>
      ) : null}
      <Body muted style={s.small}>
        Configured: {String(isConfigured)} · Camera: {permissionStatus} ·
        Devices: {devices.length}
        {connected ? " · linked" : ""}
      </Body>
      <Body muted style={s.small}>
        {route}
      </Body>
      {devices.map((device) => (
        <Body key={device.identifier} style={s.small}>
          {device.name || device.deviceType} · {device.linkState}
        </Body>
      ))}
      {error ? <Body style={{ color: C.danger }}>{error}</Body> : null}
      {busy ? <Body muted>{busy}</Body> : null}
      <View style={{ gap: 8 }}>
        {registrationState !== "registered" ? (
          <Button title="Register with Meta AI" icon="link-outline" onPress={register} />
        ) : null}
        {permissionStatus !== "granted" ? (
          <Button
            secondary
            title="Allow glasses camera"
            icon="camera-outline"
            onPress={askCamera}
          />
        ) : null}
        {!sessionId ? (
          <Button
            title="Start camera session"
            icon="play-outline"
            onPress={beginSession}
            disabled={registrationState !== "registered"}
          />
        ) : (
          <>
            <Button title="Capture still" icon="camera" onPress={snap} />
            <Button secondary title="Stop session" icon="stop-outline" onPress={endSession} />
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
            style={{ width: "100%", height: 200, borderRadius: 12, backgroundColor: C.line }}
            resizeMode="cover"
            accessibilityLabel="Captured glasses still"
          />
          <Button secondary title="Discard still" icon="trash-outline" onPress={discard} />
        </View>
      ) : null}
      <Body style={s.small}>
        Developer Mode only: Meta AI → Settings → App Info → tap version 5×.
        Local testing uses APPLICATION_ID/CLIENT_TOKEN 0 — no Meta developer
        account required.
      </Body>
    </Card>
  );
}
