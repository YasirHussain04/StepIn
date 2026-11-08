import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import {
  Badge,
  Body,
  Button,
  C,
  Card,
  Icon,
  IconName,
  Label,
  Page,
  s,
  Title,
} from "../../components/ui";
import { RoomComposer } from "../../components/RoomComposer";
import { GlassesPanel, type CapturedStill } from "../../components/GlassesPanel";
import { useApp } from "../../src/state/AppProvider";
import { scenarios } from "../../src/demo/scenarios";
import { uid, hasGeminiConsent } from "../../src/domain/types";
import { analyzeSceneStills, roomFromScene } from "../../src/services/scene";
import { ClientError } from "../../src/services/api";
import type { SceneSummary } from "../../shared/contracts";

export default function Speak() {
  const { state, setState, profile, account } = useApp();
  const [still, setStill] = useState<CapturedStill | null>(null);
  const [glassesConnected, setGlassesConnected] = useState(false);
  const [sceneBusy, setSceneBusy] = useState(false);
  const [sceneError, setSceneError] = useState("");

  function start(
    room: string,
    scenarioId?: "games" | "garden" | "welcome",
    name?: string,
    scene?: SceneSummary,
  ) {
    if (!profile) {
      router.push("/quiz");
      return;
    }
    const id = uid();
    const now = new Date().toISOString();
    setState((prev) => ({
      ...prev,
      sessions: [
        {
          id,
          title: name ?? (scene ? "Glasses scene" : "My room description"),
          room,
          scenarioId,
          createdAt: now,
          updatedAt: now,
          messages: [],
          persisted: prev.settings.history,
          mode: prev.settings.mode ?? "demo",
        },
        ...prev.sessions,
      ],
      scenes: scene
        ? { ...prev.scenes, [id]: scene }
        : { ...(prev.scenes ?? {}) },
    }));
    router.push({ pathname: "/chat/[id]", params: { id } });
  }

  async function sendStill() {
    if (!still) return;
    if (!profile) {
      router.push("/quiz");
      return;
    }
    if (
      state.settings.mode === "live" &&
      (!account ||
        !state.cloud?.enabled ||
        !hasGeminiConsent(state.settings))
    ) {
      setSceneError(
        "Live scene analysis needs sign-in, account sync, and remote AI consent in Settings. You can still describe the room in text for offline demo.",
      );
      return;
    }
    if (state.settings.mode !== "live") {
      setSceneError(
        "Switch to live guidance in Settings to analyze glasses stills with Gemini. Typed demo rooms still work offline.",
      );
      return;
    }
    setSceneBusy(true);
    setSceneError("");
    try {
      const scene = await analyzeSceneStills(
        [still.uri],
        state.settings.apiUrl,
        AbortSignal.timeout(120_000),
      );
      start(roomFromScene(scene), undefined, "Glasses scene", scene);
      setStill(null);
    } catch (error) {
      setSceneError(
        error instanceof ClientError
          ? error.message
          : "Scene analysis failed. Discard or retry, or describe the room in text.",
      );
    } finally {
      setSceneBusy(false);
    }
  }

  return (
    <Page>
      <View style={{ gap: 12 }}>
        <View style={s.between}>
          <Label>A little help, a little courage</Label>
          <Badge>
            {state.settings.mode === "live" ? "LIVE GUIDANCE" : "OFFLINE DEMO"}
          </Badge>
        </View>
        <Title>Good things start{"\n"}with a hello.</Title>
        <Body muted>
          A space to find your words, take a small step,{"\n"}and feel more at
          home.
        </Body>
      </View>
      {!profile ? (
        <Card style={{ backgroundColor: C.sage, borderColor: "#D6DFCF" }}>
          <View style={s.row}>
            <Icon name="sparkles-outline" />
            <Text style={[s.section, { fontSize: 18 }]}>
              Let’s make this feel like you.
            </Text>
          </View>
          <Body muted>
            10 short questions help us understand your pace and preferences.
            Confirm your profile to start practicing.
          </Body>
          <Button
            title={state.draft ? "Continue my quiz" : "Get to know me"}
            icon="arrow-forward"
            onPress={() => router.push("/quiz")}
          />
          <Body style={s.small}>
            About 2 minutes · support disclosure is optional
          </Body>
        </Card>
      ) : (
        <View
          style={[
            s.row,
            { backgroundColor: C.sage, padding: 14, borderRadius: 13 },
          ]}
        >
          <Icon name="checkmark-circle-outline" size={19} />
          <Body style={{ fontSize: 13, flex: 1 }}>
            Your preferences are ready. Go at your pace.
          </Body>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="View your preferences"
            onPress={() => router.push("/settings")}
            style={{ minHeight: 44, justifyContent: "center" }}
          >
            <Icon name="arrow-forward" size={17} />
          </Pressable>
        </View>
      )}
      <GlassesPanel
        onStillReady={setStill}
        onConnectedChange={setGlassesConnected}
      />
      {still ? (
        <Card>
          <Body style={{ fontWeight: "600" }}>Use this glasses still?</Body>
          <Body muted style={s.small}>
            Review first. Nothing is uploaded until you send it for scene
            analysis. Mic/speaker stay on Bluetooth
            {glassesConnected ? " (glasses linked)" : ""}.
          </Body>
          {sceneError ? (
            <Body style={{ color: C.danger }}>{sceneError}</Body>
          ) : null}
          <Button
            title={sceneBusy ? "Analyzing…" : "Send still for scene context"}
            icon="cloud-upload-outline"
            onPress={sendStill}
            disabled={sceneBusy || !profile}
          />
          <Button
            secondary
            title="Discard still"
            icon="trash-outline"
            onPress={() => {
              setStill(null);
              setSceneError("");
            }}
            disabled={sceneBusy}
          />
        </Card>
      ) : null}
      <RoomComposer onSubmit={(room) => start(room)} disabled={!profile} />
      <View style={{ gap: 13 }}>
        <View style={s.between}>
          <Text accessibilityRole="header" style={s.section}>
            A little practice first?
          </Text>
          <Text style={s.small}>3 demo rooms</Text>
        </View>
        <Body muted style={{ fontSize: 13 }}>
          Fictional spaces. A real chance to rehearse.
        </Body>
        {scenarios.map((scenario, i) => (
          <Pressable
            key={scenario.id}
            accessibilityRole="button"
            accessibilityLabel={`Try demo: ${scenario.name}`}
            onPress={() =>
              start(scenario.description, scenario.id, scenario.name)
            }
            style={({ pressed }) => [
              s.card,
              s.row,
              { padding: 16, gap: 14, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <View
              style={{
                width: 46,
                height: 46,
                borderRadius: 14,
                backgroundColor:
                  i === 1 ? C.sage : i === 0 ? C.peach : "#F0EADB",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon name={scenario.icon as IconName} />
            </View>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={{ color: C.ink, fontWeight: "600", fontSize: 15 }}>
                {scenario.name}
              </Text>
              <Text style={s.small}>{scenario.label}</Text>
            </View>
            <Icon name="arrow-forward" size={18} />
          </Pressable>
        ))}
      </View>
      <View style={[s.row, { justifyContent: "center" }]}>
        <Icon name="leaf-outline" size={15} />
        <Body style={s.small}>Small steps count. Even the quiet ones.</Body>
      </View>
    </Page>
  );
}
