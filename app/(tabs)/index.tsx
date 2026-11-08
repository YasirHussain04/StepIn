import React, { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import {
  Badge,
  Body,
  Button,
  C,
  Card,
  Icon,
  Label,
  Page,
  s,
  Title,
} from "../../components/ui";
import { SceneCapture, type CapturedPhoto } from "../../components/SceneCapture";
import { SpokenCoachCard } from "../../components/SpokenCoachCard";
import { useApp } from "../../src/state/AppProvider";
import { uid, hasGeminiConsent } from "../../src/domain/types";
import {
  analyzeSceneStills,
  roomFromEvent,
  roomFromScene,
} from "../../src/services/scene";
import { withLiveAi } from "../../src/services/enableLiveAi";
import { ClientError } from "../../src/services/api";
import type { SceneSummary } from "../../shared/contracts";

export default function CoachHome() {
  const { state, setState, profile } = useApp();
  const [photos, setPhotos] = useState<CapturedPhoto[]>([]);
  const [sceneBusy, setSceneBusy] = useState(false);
  const [sceneError, setSceneError] = useState("");
  const [activeScene, setActiveScene] = useState<SceneSummary | null>(null);
  const pending = state.pendingEvent;

  useEffect(() => {
    // Fresh installs default to live AI; older saved state may still be gated.
    if (!hasGeminiConsent(state.settings) || state.settings.mode !== "live") {
      setState((prev) => withLiveAi(prev));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function baseRoom() {
    if (pending) return roomFromEvent(pending);
    if (activeScene) return roomFromScene(activeScene);
    return "I am at a community gathering and would like gentle help starting a conversation.";
  }

  function startChat(
    room: string,
    name?: string,
    scene?: SceneSummary | null,
  ) {
    if (!profile) {
      router.push("/quiz");
      return;
    }
    const id = uid();
    const now = new Date().toISOString();
    const title =
      name ??
      (pending?.title
        ? `Coach: ${pending.title}`
        : scene
          ? "Photo scene"
          : "Coaching chat");
    setState((prev) => ({
      ...prev,
      pendingEvent: null,
      sessions: [
        {
          id,
          title: title.slice(0, 80),
          room,
          createdAt: now,
          updatedAt: now,
          messages: [],
          persisted: prev.settings.history,
          mode: "live",
        },
        ...prev.sessions,
      ],
      scenes: scene
        ? { ...(prev.scenes ?? {}), [id]: scene }
        : { ...(prev.scenes ?? {}) },
    }));
    router.push({ pathname: "/chat/[id]", params: { id, autostart: "1" } });
  }

  async function analyzeQueued() {
    if (!photos.length) return;
    if (!profile) {
      router.push("/quiz");
      return;
    }
    if (!hasGeminiConsent(state.settings)) {
      setState((prev) => withLiveAi(prev));
    }
    setSceneBusy(true);
    setSceneError("");
    try {
      const scene = await analyzeSceneStills(
        photos.map((p) => p.uri),
        state.settings.apiUrl,
        AbortSignal.timeout(120_000),
      );
      setActiveScene(scene);
      setPhotos([]);
      const room = pending
        ? `${roomFromEvent(pending)}\n\n${roomFromScene(scene)}`.slice(0, 2000)
        : roomFromScene(scene);
      startChat(room, pending?.title ? `Coach: ${pending.title}` : "Photo scene", scene);
    } catch (error) {
      setSceneError(
        error instanceof ClientError
          ? error.message
          : "Scene analysis failed. Retry, or start a chat from the event description alone.",
      );
    } finally {
      setSceneBusy(false);
    }
  }

  return (
    <Page>
      <View style={{ gap: 12 }}>
        <View style={s.between}>
          <Label>Your outdoor coach</Label>
          <Badge>EXPO GO · LIVE</Badge>
        </View>
        <Title>Small steps{"\n"}outside.</Title>
        <Body muted>
          Built for people who want more confidence in the real world —
          especially if social situations feel hard. Quiz → pick an event → snap
          a photo → get advice that sounds like you.
        </Body>
      </View>

      <Card style={{ backgroundColor: C.sage, borderColor: "#D6DFCF" }}>
        <Body style={{ fontWeight: "700" }}>Demo path</Body>
        <Body muted style={s.small}>
          1. Get to know you · 2. Choose a Calgary event · 3. Photograph the
          scene · 4. Chat with your coach
        </Body>
      </Card>

      {!profile ? (
        <Card>
          <View style={s.row}>
            <Icon name="sparkles-outline" />
            <Text style={[s.section, { fontSize: 18 }]}>Step 1 · Get to know you</Text>
          </View>
          <Body muted>
            A short AI chat learns how you speak and what feels comfortable, then
            builds a style card so coaching stays natural.
          </Body>
          <Button
            title="Start the AI quiz"
            icon="arrow-forward"
            onPress={() => router.push("/quiz")}
          />
        </Card>
      ) : (
        <Card>
          <View style={s.row}>
            <Icon name="checkmark-circle-outline" />
            <Body style={{ fontWeight: "700", flex: 1 }}>Style card ready</Body>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push("/quiz")}
              style={{ minHeight: 44, justifyContent: "center" }}
            >
              <Body muted style={s.small}>
                Retake
              </Body>
            </Pressable>
          </View>
          <Body>
            {profile.persona?.summary ??
              "Your preferences are saved. Coaching will respect your pace."}
          </Body>
          {profile.persona ? (
            <Body style={s.small}>
              Tone: {profile.persona.tone.join(", ") || "—"} · Pacing:{" "}
              {profile.persona.pacing}
            </Body>
          ) : null}
        </Card>
      )}

      <Card>
        <View style={s.row}>
          <Icon name="calendar-outline" />
          <Text style={[s.section, { fontSize: 18 }]}>Step 2 · Pick an event</Text>
        </View>
        {pending ? (
          <>
            <Body style={{ fontWeight: "700" }}>{pending.title}</Body>
            <Body muted>
              {pending.location}
              {pending.note ? ` · ${pending.note}` : ""}
            </Body>
            <Button
              secondary
              title="Clear event"
              onPress={() =>
                setState((prev) => ({ ...prev, pendingEvent: null }))
              }
            />
          </>
        ) : (
          <>
            <Body muted>
              Browse Calgary listings and tap “Coach me for this” so advice fits
              the gathering.
            </Body>
            <Button
              title="Browse Calgary events"
              icon="arrow-forward"
              onPress={() => router.push("/calgary")}
              disabled={!profile}
            />
          </>
        )}
      </Card>

      <View style={{ gap: 8 }}>
        <Text accessibilityRole="header" style={s.section}>
          Step 3 · Photograph the scene
        </Text>
        <SceneCapture
          photos={photos}
          onChange={setPhotos}
          busy={sceneBusy}
          error={sceneError}
          onAnalyze={() => void analyzeQueued()}
        />
      </View>

      <Card>
        <View style={s.row}>
          <Icon name="chatbubbles-outline" />
          <Text style={[s.section, { fontSize: 18 }]}>Step 4 · Get advice</Text>
        </View>
        <Body muted>
          Open a live coaching chat. Your coach suggests one gentle next step and
          a line you could say — checked against your style card.
        </Body>
        <Button
          title={
            pending
              ? "Start coaching for this event"
              : activeScene
                ? "Continue with photo context"
                : "Start coaching chat"
          }
          icon="arrow-forward"
          onPress={() =>
            startChat(
              pending
                ? activeScene
                  ? `${roomFromEvent(pending)}\n\n${roomFromScene(activeScene)}`.slice(
                      0,
                      2000,
                    )
                  : roomFromEvent(pending)
                : baseRoom(),
              pending?.title ? `Coach: ${pending.title}` : undefined,
              activeScene,
            )
          }
          disabled={!profile}
        />
      </Card>

      {profile && activeScene ? (
        <SpokenCoachCard
          room={
            pending
              ? `${roomFromEvent(pending)}\n\n${roomFromScene(activeScene)}`.slice(
                  0,
                  2000,
                )
              : roomFromScene(activeScene)
          }
          scene={activeScene}
        />
      ) : profile ? (
        <SpokenCoachCard room={baseRoom()} />
      ) : null}

      <View style={[s.row, { justifyContent: "center" }]}>
        <Icon name="leaf-outline" size={15} />
        <Body style={s.small}>Small steps count. Even the quiet ones.</Body>
      </View>
    </Page>
  );
}
