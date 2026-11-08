import React, { useCallback, useEffect, useRef, useState } from "react";
import { Image, View } from "react-native";
import {
  useMetaWearables,
  EMWDATStreamView,
  type Device,
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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pickEligible(list: Device[]): Device | undefined {
  return list.find(
    (d) => d.linkState === "connected" && d.compatibility === "compatible",
  );
}

function compatibilityHint(device: Device | undefined, list: Device[]) {
  const linked = list.filter((d) => d.linkState === "connected");
  if (!linked.length)
    return "No linked glasses yet. Wear them unfolded and reconnect in Meta AI.";
  const sample = device ?? linked[0];
  if (sample.compatibility === "deviceUpdateRequired")
    return "Glasses firmware update required in Meta AI before camera sessions work.";
  if (sample.compatibility === "sdkUpdateRequired")
    return "Rebuild StepIn with a newer expo-meta-wearables-dat — SDK update required.";
  if (sample.compatibility === "undefined")
    return "Glasses are linked but compatibility is still undefined — wait a few seconds for the DAT handshake, or finish the on-glasses Developer Mode install.";
  return `Linked as ${sample.name || sample.deviceType} (${sample.linkState}, ${sample.compatibility}).`;
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
  const sessionInFlight = useRef(false);
  const sessionIdRef = useRef<string | null>(null);
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
    refreshDevices,
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
    onDeviceSessionStateChange: (id, state) => {
      if (state === "stopped" && sessionIdRef.current === id) {
        sessionIdRef.current = null;
        setSessionId(null);
      }
    },
    onDeviceSessionError: (_id, _code, message) => {
      const detail = (message ?? "").trim();
      if (detail)
        setError(
          `Glasses session error: ${detail}. Confirm glasses are worn, unfolded, and linked.`,
        );
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

  const waitForEligible = useCallback(async () => {
    let list = await refreshDevices();
    let eligible = pickEligible(list);
    if (eligible) return { eligible, list };
    for (let i = 0; i < 4; i++) {
      setBusy("Waiting for glasses DAT handshake…");
      await sleep(700);
      list = await refreshDevices();
      eligible = pickEligible(list);
      if (eligible) return { eligible, list };
      const linked = list.find((d) => d.linkState === "connected");
      if (linked && linked.compatibility !== "undefined") break;
    }
    return { eligible: pickEligible(list), list };
  }, [refreshDevices]);

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
    if (sessionInFlight.current || busy) return;
    if (!registered) {
      setError("Register with Meta AI before starting a camera session.");
      return;
    }
    if (permissionStatus !== "granted") {
      setError("Allow glasses camera in Meta AI before starting a session.");
      return;
    }
    sessionInFlight.current = true;
    setError("");
    setBusy("Finding an eligible glasses device…");
    let createdId: string | null = null;
    try {
      const prior = sessionIdRef.current;
      if (prior) {
        try {
          await stopSession(prior);
        } catch {
          /* prior session may already be gone */
        }
        sessionIdRef.current = null;
        setSessionId(null);
      }
      const { eligible, list } = await waitForEligible();
      if (!eligible) {
        setError(
          `No eligible device available. ${compatibilityHint(undefined, list)} Wear glasses unfolded, finish Developer Mode install if pending, then retry.`,
        );
        return;
      }
      setBusy(`Starting session on ${eligible.name || eligible.deviceType}…`);
      // Auto device selector — SpecificDeviceSelector often stops before start.
      const id = await createSession();
      createdId = id;
      await startSession(id);
      await addStreamToSession(id, {
        resolution: "medium",
        frameRate: 24,
      });
      sessionIdRef.current = id;
      setSessionId(id);
    } catch (e) {
      if (createdId) {
        try {
          await stopSession(createdId);
        } catch {
          /* best-effort cleanup */
        }
      }
      const detail = errorDetail(e, "Could not start a glasses session.");
      const snapshot = devices
        .map(
          (d) =>
            `${d.name || d.deviceType}:${d.linkState}/${d.compatibility}`,
        )
        .join(", ");
      setError(
        `${detail}${snapshot ? ` [${snapshot}]` : ""} Confirm glasses are worn, unfolded, linked in Meta AI, and DAT/Developer Mode install finished.`,
      );
      sessionIdRef.current = null;
      setSessionId(null);
    } finally {
      sessionInFlight.current = false;
      setBusy("");
    }
  }, [
    busy,
    registered,
    permissionStatus,
    waitForEligible,
    createSession,
    startSession,
    stopSession,
    addStreamToSession,
    devices,
  ]);

  const endSession = useCallback(async () => {
    if (!sessionId) return;
    setBusy("Stopping…");
    try {
      await stopSession(sessionId);
    } catch {
      /* session may already be stopped */
    } finally {
      sessionIdRef.current = null;
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
          {device.name || device.deviceType} · {device.linkState} ·{" "}
          {device.compatibility}
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
            busy={
              registrationState === "registering" || busy === "Opening Meta AI…"
            }
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
            onPress={() => void beginSession()}
            disabled={!registered || !!busy}
            busy={
              !!busy &&
              (busy.startsWith("Finding") ||
                busy.startsWith("Starting") ||
                busy.startsWith("Waiting for glasses"))
            }
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
        developer account required. Camera needs compatibility: compatible.
      </Body>
    </Card>
  );
}
