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
  Label,
  Page,
  s,
  TextField,
  Title,
} from "../../components/ui";
import { useApp } from "../../src/state/AppProvider";
export default function Chats() {
  const { state, syncStatus, syncError, flushSync } = useApp();
  const [query, setQuery] = useState("");
  const sessions = [...state.sessions]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .filter((session) =>
      `${session.title} ${session.room} ${session.messages.map((m) => `${m.text} ${m.icebreaker ?? ""}`).join(" ")}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    );
  return (
    <Page>
      <View style={{ gap: 12 }}>
        <Label>Your words, kept close</Label>
        <Title>Pick up where{"\n"}you left off.</Title>
        <Body muted>
          Your practice, small wins, and conversations.{"\n"}All in one familiar
          place.
        </Body>
      </View>
      <Button
        title="Start a new chat"
        icon="add"
        onPress={() => router.push("/")}
      />
      <TextField
        accessibilityLabel="Search chats"
        placeholder="Search your conversations"
        value={query}
        onChangeText={setQuery}
      />
      <View style={s.between}>
        <Text style={s.section}>Your conversations</Text>
        <Text style={s.small}>{sessions.length} chats</Text>
      </View>
      {state.cloud?.consented && (
        <Card>
          <Body>
            {state.cloud.enabled ? syncStatus : "Account sync paused"} ·{" "}
            {state.cloud.queue.length} queued changes
          </Body>
          {!!syncError && <Body muted>{syncError}</Body>}
          {state.cloud.conflict ? (
            <Button
              title="Review sync conflict"
              secondary
              onPress={() => router.push("/settings")}
            />
          ) : state.cloud.enabled ? (
            <Button
              title="Sync chats now"
              secondary
              onPress={() => void flushSync().catch(() => {})}
            />
          ) : null}
        </Card>
      )}
      {!sessions.length && (
        <Card style={{ alignItems: "center", paddingVertical: 34 }}>
          <View
            style={{ padding: 20, backgroundColor: C.sage, borderRadius: 50 }}
          >
            <Icon name="chatbubbles-outline" size={34} />
          </View>
          <Title small>
            {query ? "No matching chats." : "Your first hello awaits."}
          </Title>
          <Body muted style={{ textAlign: "center" }}>
            {query
              ? "Try a different word from the title or conversation."
              : "Try a demo room in Speak. You can come back to your conversation here."}
          </Body>
        </Card>
      )}
      {sessions.map((session) => (
        <Pressable
          key={session.id}
          accessibilityRole="button"
          accessibilityLabel={`Open ${session.title}`}
          onPress={() =>
            router.push({ pathname: "/chat/[id]", params: { id: session.id } })
          }
          style={[s.card, { gap: 12 }]}
        >
          <View style={s.between}>
            <Badge warm>
              {session.persisted === false
                ? "NOT SAVED"
                : session.mode === "live"
                  ? "LIVE GUIDANCE"
                  : "DEMO PRACTICE"}
            </Badge>
            <Text style={s.small}>
              {new Date(session.updatedAt).toLocaleDateString("en-CA", {
                month: "short",
                day: "numeric",
              })}
            </Text>
          </View>
          <View style={s.between}>
            <Text style={[s.section, { fontSize: 19, flex: 1 }]}>
              {session.title}
            </Text>
            <Icon name="arrow-forward" size={19} />
          </View>
          <Text numberOfLines={2} style={s.body}>
            {session.messages.at(-1)?.icebreaker ??
              session.messages.at(-1)?.text ??
              "Ready when you are."}
          </Text>
          <Text style={s.small}>
            {session.messages.length} messages ·{" "}
            {session.persisted === false
              ? "temporary"
              : state.cloud?.consented
                ? "account sync"
                : "local only"}
          </Text>
        </Pressable>
      ))}
      <View style={s.row}>
        <Icon name="lock-closed-outline" size={15} />
        <Body style={[s.small, { flex: 1 }]}>
          {state.settings.history
            ? state.cloud?.consented
              ? "Saved chats participate in account sync. Manage sync and deletion in Settings."
              : "History stays on this device until you enable account sync in Settings."
            : "History is off. New chats are temporary; existing saved chats remain until you delete them."}
        </Body>
      </View>
    </Page>
  );
}
