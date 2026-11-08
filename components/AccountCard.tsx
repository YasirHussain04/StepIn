import React, { useState } from "react";
import { Switch, View } from "react-native";
import { Body, Button, C, Card, Icon, s, TextField } from "./ui";
import { useApp } from "../src/state/AppProvider";
import { api } from "../src/services/api";
import { hasGeminiConsent } from "../src/domain/types";

/** Local-device mode: live Gemini without Supabase account creation. */
export function AccountCard() {
  const { state, setState } = useApp();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  function option(
    key: "processingConsent" | "shareProfile",
    value: boolean,
  ) {
    setState((prev) => ({
      ...prev,
      settings: {
        ...prev.settings,
        [key]: value,
        ...(key === "processingConsent"
          ? {
              processingProvider: "gemini" as const,
              ...(value ? { mode: "live" as const } : {}),
            }
          : {}),
      },
    }));
  }

  return (
    <Card>
      <View style={s.row}>
        <Icon name="phone-portrait-outline" />
        <Body style={{ fontWeight: "700", fontSize: 18 }}>
          Local device mode
        </Body>
      </View>
      <Body muted>
        Quiz answers and chats stay on this phone. Live guidance talks to your
        StepIn server with Google Gemini — no account sign-up required right
        now.
      </Body>
      <View style={s.between}>
        <Body style={{ flex: 1 }}>Allow live AI processing</Body>
        <Switch
          accessibilityLabel="Allow live AI processing"
          value={hasGeminiConsent(state.settings)}
          onValueChange={(v) => option("processingConsent", v)}
          trackColor={{ true: C.green }}
        />
      </View>
      <Body style={s.small}>
        Sends room context and your request through StepIn’s backend to Gemini.
        Only independently checked replies are shown. That check can still be
        wrong.
      </Body>
      <View style={s.between}>
        <Body style={{ flex: 1 }}>Share preferences with AI</Body>
        <Switch
          accessibilityLabel="Share preferences with AI"
          value={state.settings.shareProfile !== false}
          onValueChange={(v) => option("shareProfile", v)}
          trackColor={{ true: C.green }}
        />
      </View>
      <Body style={s.small}>
        When off, agents get generic context without quiz answers. Screening
        gates still apply on device.
      </Body>
      <Button
        title={
          state.settings.mode === "live"
            ? "Live mode selected"
            : "Use live guidance for new chats"
        }
        secondary={state.settings.mode !== "live"}
        disabled={!hasGeminiConsent(state.settings)}
        onPress={() =>
          setState((prev) => ({
            ...prev,
            settings: { ...prev.settings, mode: "live" },
          }))
        }
      />
      <Button
        secondary
        title="Use offline demo for new chats"
        onPress={() =>
          setState((prev) => ({
            ...prev,
            settings: { ...prev.settings, mode: "demo" },
          }))
        }
      />
      {!!notice && <Body accessibilityLiveRegion="polite">{notice}</Body>}
      {!!error && (
        <Body accessibilityLiveRegion="polite" style={{ color: C.danger }}>
          {error}
        </Body>
      )}
      <View style={s.divider} />
      <Body style={{ fontWeight: "600" }}>Backend connection</Body>
      <TextField
        accessibilityLabel="Backend URL"
        placeholder="http://192.168.x.x:3001"
        autoCapitalize="none"
        autoCorrect={false}
        value={state.settings.apiUrl ?? process.env.EXPO_PUBLIC_API_URL ?? ""}
        onChangeText={(apiUrl) =>
          setState((prev) => ({
            ...prev,
            settings: { ...prev.settings, apiUrl },
          }))
        }
      />
      <Body style={s.small}>
        For a physical phone use your computer’s LAN address. Keep the Mac
        server running with GEMINI_API_KEY set.
      </Body>
      <Button
        secondary
        title="Check server connection"
        busy={busy}
        onPress={() => {
          setBusy(true);
          setError("");
          void api<{
            capabilities: {
              coaching: boolean;
              transcription: boolean;
              scene?: boolean;
            };
          }>("/health", { public: true, url: state.settings.apiUrl })
            .then((health) => {
              setNotice(
                `Server reachable. Coaching ${health.capabilities.coaching ? "ready" : "needs GEMINI_API_KEY"}; transcription ${health.capabilities.transcription ? "ready" : "needs key"}; scene ${health.capabilities.scene ? "ready" : "needs key"}.`,
              );
            })
            .catch((e) => {
              setError(
                e instanceof Error
                  ? e.message
                  : "Could not reach the server. Check the URL and that npm run server is running.",
              );
            })
            .finally(() => setBusy(false));
        }}
      />
    </Card>
  );
}
