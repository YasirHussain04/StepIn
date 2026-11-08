import React, { useState } from "react";
import { Image, Pressable, Text, View } from "react-native";
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
import { SpokenCoachCard } from "../../components/SpokenCoachCard";
import { useApp } from "../../src/state/AppProvider";
import { scenarios } from "../../src/demo/scenarios";
import { uid, hasGeminiConsent } from "../../src/domain/types";
import { analyzeSceneStills, roomFromScene } from "../../src/services/scene";
import { ClientError } from "../../src/services/api";
import type { SceneSummary } from "../../shared/contracts";

export default function Speak() {
  const { state, setState, profile } = useApp();
  const [stills, setStills] = useState<CapturedStill[]>([]);
  const [glassesConnected, setGlassesConnected] = useState(false);
  const [sceneBusy, setSceneBusy] = useState(false);
  const [sceneError, setSceneError] = useState("");
  const [activeScene, setActiveScene] = useState<SceneSummary | null>(null);
  const [coachSessionId, setCoachSessionId] = useState<string | null>(null);

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

  function queueStill(still: CapturedStill | null) {
    if (!still) return;
    setStills((prev) => {
      if (prev.length >= 3) return prev;
      if (prev.some((p) => p.uri === still.uri)) return prev;
      return [...prev, still];
    });
    setSceneError("");
  }

  async function analyzeQueued() {
    if (!stills.length) return;
    if (!profile) {
      router.push("/quiz");
      return;
    }
    if (state.settings.mode === "live" && !hasGeminiConsent(state.settings)) {
      setSceneError(
        "Live scene analysis needs remote AI consent in Settings. You can still describe the room in text for offline demo.",
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
        stills.map((s) => s.uri),
        state.settings.apiUrl,
        AbortSignal.timeout(120_000),
      );
      setActiveScene(scene);
      setCoachSessionId(uid());
      setStills([]);
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
          See the gathering, then get approach advice that fits how you
          communicate.
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
            A short AI chat learns your pace and style so coaching stays
            natural. Classic form is available too.
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
            {profile.persona
              ? "Style card ready. Coaching will match your voice."
              : "Your preferences are ready. Go at your pace."}
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
        onStillReady={queueStill}
        onConnectedChange={setGlassesConnected}
      />
      {stills.length > 0 ? (
        <Card>
          <Body style={{ fontWeight: "600" }}>
            Stills ready ({stills.length}/3)
          </Body>
          <Body muted style={s.small}>
            Capture up to three reviewed stills. Nothing is uploaded until you
            analyze. We use them to understand the kind of gathering—not
            continuous camera.
          </Body>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {stills.map((still) => (
              <View key={still.uri} style={{ width: "30%" }}>
                <Image
                  source={{ uri: still.uri }}
                  style={{
                    width: "100%",
                    height: 72,
                    borderRadius: 10,
                    backgroundColor: C.line,
                  }}
                  accessibilityLabel="Queued glasses still"
                />
                <Button
                  secondary
                  title="Remove"
                  onPress={() =>
                    setStills((prev) => prev.filter((p) => p.uri !== still.uri))
                  }
                  disabled={sceneBusy}
                />
              </View>
            ))}
          </View>
          {sceneError ? (
            <Body style={{ color: C.danger }}>{sceneError}</Body>
          ) : null}
          <Button
            title={
              sceneBusy
                ? "Analyzing…"
                : `Analyze ${stills.length} still${stills.length === 1 ? "" : "s"}`
            }
            icon="cloud-upload-outline"
            onPress={() => void analyzeQueued()}
            disabled={sceneBusy || !profile || stills.length === 0}
          />
          <Button
            secondary
            title="Clear stills"
            icon="trash-outline"
            onPress={() => {
              setStills([]);
              setSceneError("");
            }}
            disabled={sceneBusy}
          />
        </Card>
      ) : null}
      {activeScene ? (
        <Card style={{ backgroundColor: C.sage }}>
          <Badge>SCENE READY</Badge>
          <Body style={{ fontWeight: "700" }}>
            Looks like: {activeScene.eventKind}
          </Body>
          <Body>
            Social setup: {activeScene.socialSetup.replaceAll("_", " ")}
          </Body>
          {activeScene.coachingFocus.map((c) => (
            <Body key={c} style={s.small}>
              · {c}
            </Body>
          ))}
          {activeScene.uncertainties.length ? (
            <Body style={s.small}>
              Uncertain: {activeScene.uncertainties.join(" · ")}
            </Body>
          ) : null}
          <SpokenCoachCard
            room={roomFromScene(activeScene)}
            scene={activeScene}
            sessionId={coachSessionId ?? undefined}
            glassesConnected={glassesConnected}
          />
          <Button
            secondary
            title="Open text chat with this scene"
            icon="chatbubble-outline"
            onPress={() =>
              start(
                roomFromScene(activeScene),
                undefined,
                "Glasses scene",
                activeScene,
              )
            }
          />
          <Button
            secondary
            title="Discard scene"
            onPress={() => {
              setActiveScene(null);
              setCoachSessionId(null);
            }}
          />
        </Card>
      ) : profile ? (
        <SpokenCoachCard
          room="General practice — describe what you see when you talk."
          glassesConnected={glassesConnected}
        />
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
