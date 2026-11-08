import React, { useState } from "react";
import { Switch, Text, View } from "react-native";
import { router } from "expo-router";
import * as Speech from "expo-speech";
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
  TextField,
  Title,
} from "../../components/ui";
import { Confirm } from "../../components/Confirm";
import { GlassesPanel } from "../../components/GlassesPanel";
import { useApp } from "../../src/state/AppProvider";
import { createProfile, comfortLabel, preference } from "../../src/domain/quiz";
import { Settings } from "../../src/domain/types";
import { AccountCard } from "../../components/AccountCard";

function Toggle({
  label,
  detail,
  value,
  onChange,
}: {
  label: string;
  detail: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <View style={[s.row, { alignItems: "center", paddingVertical: 9 }]}>
      <View style={{ flex: 1, gap: 3 }}>
        <Body style={{ fontWeight: "600" }}>{label}</Body>
        <Body style={s.small}>{detail}</Body>
      </View>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={onChange}
        trackColor={{ false: "#B9C0B6", true: C.green }}
      />
    </View>
  );
}
export default function Preferences() {
  const { state, setState, profile, deleteAllChats } = useApp();
  const [confirm, setConfirm] = useState<
    "history" | "profile" | "sensitive" | null
  >(null);
  function setting<K extends keyof Settings>(key: K, value: Settings[K]) {
    if (key === "audio" && !value) void Speech.stop();
    setState((prev) => ({
      ...prev,
      settings: { ...prev.settings, [key]: value },
    }));
  }
  function remove() {
    void Speech.stop();
    if (confirm === "history") deleteAllChats();
    if (confirm === "profile")
      setState((prev) => ({
        ...prev,
        activeProfileId: null,
        profiles: [],
        draft: null,
      }));
    if (confirm === "sensitive" && profile) {
      const answers = {
        ...profile.answers,
        q8: ["Prefer not to say"],
        q9: ["Prefer not to say"],
      };
      const next = createProfile(
        answers,
        Math.max(...state.profiles.map((p) => p.revision)) + 1,
      );
      setState((prev) => ({
        ...prev,
        activeProfileId: next.id,
        profiles: [
          ...prev.profiles.map((p) => ({
            ...p,
            answers: {
              ...p.answers,
              q8: ["Prefer not to say"],
              q9: ["Prefer not to say"],
            },
          })),
          next,
        ],
        draft: prev.draft
          ? {
              ...prev.draft,
              answers: Object.fromEntries(
                Object.entries(prev.draft.answers).filter(
                  ([key]) => key !== "q8" && key !== "q9",
                ),
              ),
            }
          : null,
      }));
    }
    setConfirm(null);
  }
  return (
    <Page>
      <View style={{ gap: 12 }}>
        <Label>Make yourself at home</Label>
        <Title>Made for you.{"\n"}Changed by you.</Title>
        <Body muted>Your preferences can change. StepIn can, too.</Body>
      </View>
      <AccountCard />
      <Card style={{ backgroundColor: C.sage }}>
        <View style={s.between}>
          <View style={s.row}>
            <Icon name="person-circle-outline" size={27} />
            <Text style={s.section}>Your social preferences</Text>
          </View>
        </View>
        {profile ? (
          <>
            <Badge>ACTIVE PROFILE · VERSION {profile.revision}</Badge>
            <View style={s.between}>
              <Body>Current comfort</Body>
              <Text style={{ color: C.ink, fontWeight: "700" }}>
                {comfortLabel(profile.comfortScore)} · {profile.comfortScore}
                /100
              </Text>
            </View>
            <View style={s.between}>
              <Body>Desired activity</Body>
              <Text style={{ color: C.ink, fontWeight: "700" }}>
                {profile.desiredActivityScore}/100
              </Text>
            </View>
            <View style={s.divider} />
            <Body>{String(profile.answers.q7)}</Body>
            <Body style={s.small}>
              Communication: {(profile.answers.q8 as string[]).join(" · ")}
              {"\n"}Access: {(profile.answers.q9 as string[]).join(" · ")}
              {"\n"}Support: {(profile.answers.q10 as string[]).join(" · ")}
            </Body>
            <Body style={s.small}>
              This describes today’s preferences, not a permanent label. Support
              needs do not affect your scores.
            </Body>
          </>
        ) : (
          <Body muted>
            Complete and confirm all 10 questions to unlock practice. Sensitive
            disclosure is optional.
          </Body>
        )}
        <Button
          title={
            state.draft
              ? "Continue my quiz"
              : profile
                ? "Retake the quiz"
                : "Take my preferences quiz"
          }
          icon="refresh-outline"
          onPress={() => {
            if (!state.draft)
              setState((prev) => ({
                ...prev,
                draft: { answers: {}, step: 0 },
              }));
            router.push("/quiz");
          }}
        />
        {profile && (
          <>
            <Body style={s.small}>
              Your current version stays active during a retake. Review and
              confirm to activate the new version.
            </Body>
            <Button
              secondary
              title="Remove sensitive answers"
              icon="shield-outline"
              onPress={() => setConfirm("sensitive")}
            />
          </>
        )}
      </Card>
      <View style={{ gap: 12 }}>
        <Text accessibilityRole="header" style={s.section}>
          Sound & encouragement
        </Text>
        <Card>
          <Toggle
            label="Read aloud"
            detail="Manual playback only. Automatic speech is off."
            value={state.settings.audio}
            onChange={(value) => setting("audio", value)}
          />
          {profile && preference(profile, "q8", "Text instead of audio") && (
            <Body style={s.small}>
              Your profile requests text instead of audio, so playback is
              disabled. Retake the quiz to change that preference.
            </Body>
          )}
          <View style={s.divider} />
          <Toggle
            label="Gentle encouragement"
            detail="Include optional affirmations in new responses."
            value={state.settings.affirmations}
            onChange={(value) => setting("affirmations", value)}
          />
          <View style={s.divider} />
          <Body style={{ fontWeight: "600" }}>Reading speed</Body>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {[
              { label: "Slower", rate: 0.75 },
              { label: "Easy pace", rate: 0.9 },
              { label: "Standard", rate: 1 },
            ].map((item) => (
              <Button
                key={item.rate}
                title={item.label}
                secondary={state.settings.rate !== item.rate}
                onPress={() => {
                  void Speech.stop();
                  setting("rate", item.rate);
                }}
              />
            ))}
          </View>
        </Card>
      </View>
      <View style={{ gap: 12 }}>
        <Text accessibilityRole="header" style={s.section}>
          A little more about you
        </Text>
        <Card>
          <Body style={{ fontWeight: "600" }}>Interests</Body>
          <TextField
            accessibilityLabel="Your interests"
            placeholder="Board games, gardening, books…"
            value={state.settings.interests}
            onChangeText={(value) => setting("interests", value)}
            maxLength={250}
          />
          <Body style={s.small}>
            Saved for your profile. The current scripted demo does not match
            events or ideas to interests yet.
          </Body>
          <View style={s.divider} />
          <View style={s.between}>
            <Body>Language</Body>
            <Badge>ENGLISH</Badge>
          </View>
          <Body style={s.small}>
            This first build supports English. Other languages need reviewed
            translations.
          </Body>
        </Card>
      </View>
      <View style={{ gap: 12 }}>
        <Text accessibilityRole="header" style={s.section}>
          Your data, your choice
        </Text>
        <Card>
          <Toggle
            label="Save chat history"
            detail="When off, new chats stay temporary. Existing chats remain until deleted."
            value={state.settings.history}
            onChange={(value) => setting("history", value)}
          />
          <View style={s.divider} />
          <Body style={s.small}>
            Profiles and saved chats use the local database (browser storage in
            the web preview). Account sync uploads them only after your
            confirmation. History-off messages stay temporary and are excluded
            from database sync. Chat storage is not encrypted by StepIn or
            protected by an app lock. Account tokens use separate secure storage
            on the phone.
          </Body>
          <Body style={s.small}>
            The in-app recorder keeps temporary audio on this device. Only your
            explicit transcription action uploads it to StepIn and Google; the
            server does not durably store the audio. Keyboard and browser
            dictation use their own providers. Glasses stills upload only after
            you review and send them for scene analysis; phone camera is not
            used as a product fallback.
          </Body>
          <Button
            secondary
            title="Delete all chats"
            icon="trash-outline"
            onPress={() => setConfirm("history")}
          />
          <Button
            secondary
            title="Delete my profiles & quiz"
            icon="person-remove-outline"
            onPress={() => setConfirm("profile")}
          />
        </Card>
      </View>
      <GlassesPanel />
      <Card>
        <View style={s.row}>
          <Icon name="headset-outline" />
          <Text style={s.section}>Glasses mic & speaker</Text>
        </View>
        <Body muted>
          Mic and speaker use system Bluetooth (HFP for recording, A2DP when
          only playing). Keep Meta glasses connected as a headset; the Speak
          recorder and Read aloud then use them automatically. While the mic is
          active, playback is call quality. Camera stills need a development
          build — Expo Go cannot load the Meta DAT native module.
        </Body>
      </Card>
      <View style={{ alignItems: "center", gap: 6 }}>
        <Text style={{ color: C.green, fontWeight: "700" }}>
          StepIn · 0.2.0
        </Text>
        <Body style={s.small}>A small step toward feeling at home.</Body>
        <Badge>
          {state.settings.mode === "live"
            ? "LIVE GUIDANCE · ACCOUNT SYNC"
            : "OFFLINE DEMO AVAILABLE"}
        </Badge>
      </View>
      <Confirm
        visible={!!confirm}
        title={
          confirm === "history"
            ? "Delete all chats?"
            : confirm === "sensitive"
              ? "Remove sensitive answers?"
              : "Delete your profiles?"
        }
        description={
          confirm === "history"
            ? "All saved and temporary chats, messages and check records will be removed. With account sync enabled, deletion is also queued for the cloud and retries when online. This cannot be undone."
            : confirm === "sensitive"
              ? "Communication and accessibility answers in all profiles will become “Prefer not to say”. Draft answers to these questions will be cleared. A new active version will preserve your other preferences."
              : "All quiz drafts and profile versions will be removed. Chats remain with a “profile removed” marker. You will need to complete the quiz before new coaching or playback."
        }
        confirm={
          confirm === "sensitive"
            ? "Remove sensitive answers"
            : "Delete from this device"
        }
        onCancel={() => setConfirm(null)}
        onConfirm={remove}
      />
    </Page>
  );
}
