import React, { useEffect, useMemo, useState } from "react";
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
} from "../components/ui";
import { useApp } from "../src/state/AppProvider";
import {
  comfortLabel,
  createProfile,
  questions,
  toggleAnswer,
  validAnswer,
  validateAnswers,
} from "../src/domain/quiz";
import { hasGeminiConsent, type Answers, type Persona } from "../src/domain/types";
import { api, ClientError } from "../src/services/api";
import type { QuizTurnResponse } from "../shared/contracts";

type ChatMsg = { role: "assistant" | "user"; text: string };

function ClassicQuiz({
  onSwitch,
}: {
  onSwitch: () => void;
}) {
  const { state, setState, profile } = useApp();
  const [error, setError] = useState("");
  const answers = state.draft?.answers ?? {};
  const step = state.draft?.step ?? 0;
  const q = questions[Math.min(step, 9)];
  const value = answers[q.id];
  const preview = useMemo(
    () =>
      validateAnswers(answers)
        ? createProfile(answers, (profile?.revision ?? 0) + 1)
        : null,
    [answers, profile?.revision],
  );
  function move(next: number) {
    setState((prev) => ({
      ...prev,
      draft: { answers: prev.draft?.answers ?? {}, step: next },
    }));
  }
  function answer(value: number | string | string[]) {
    setState((prev) => ({
      ...prev,
      draft: { answers: { ...prev.draft?.answers, [q.id]: value }, step },
    }));
  }
  function activate() {
    try {
      const next = createProfile(
        answers,
        Math.max(0, ...state.profiles.map((p) => p.revision)) + 1,
      );
      setState((prev) => ({
        ...prev,
        profiles: [...prev.profiles, next],
        activeProfileId: next.id,
        draft: null,
      }));
      router.replace("/");
    } catch {
      setError("Please answer all 10 questions before confirming.");
    }
  }
  return (
    <Page key={step}>
      <View style={s.between}>
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            router.canGoBack() ? router.back() : router.replace("/")
          }
          style={{ minHeight: 44, justifyContent: "center" }}
        >
          <Body muted>Save & close</Body>
        </Pressable>
        <Badge>CLASSIC FORM</Badge>
      </View>
      <Button secondary title="Use AI conversation instead" onPress={onSwitch} />
      {step < 10 ? (
        <>
          <View style={{ gap: 10 }}>
            <View style={s.between}>
              <Label>A little about you</Label>
              <Body muted>{step + 1} of 10</Body>
            </View>
            <View
              accessibilityRole="progressbar"
              accessibilityValue={{ min: 0, max: 10, now: step + 1 }}
              style={{ height: 5, borderRadius: 9, backgroundColor: C.line }}
            >
              <View
                style={{
                  height: 5,
                  borderRadius: 9,
                  backgroundColor: C.green,
                  width: `${(step + 1) * 10}%`,
                }}
              />
            </View>
          </View>
          <Title small>{q.title}</Title>
          <View style={{ gap: 10 }}>
            {"low" in q
              ? [1, 2, 3, 4, 5].map((n) => (
                  <Pressable
                    key={n}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: value === n }}
                    onPress={() => answer(n)}
                    style={[
                      s.card,
                      s.row,
                      {
                        minHeight: 58,
                        paddingVertical: 14,
                        borderColor: value === n ? C.green : C.line,
                        backgroundColor: value === n ? C.sage : "#fff",
                      },
                    ]}
                  >
                    <Body style={{ flex: 1 }}>
                      {n === 1 ? q.low : n === 5 ? q.high : String(n)}
                    </Body>
                    {value === n && <Icon name="checkmark-circle" size={20} />}
                  </Pressable>
                ))
              : q.options.map((option) => {
                  const checked = Array.isArray(value)
                    ? value.includes(option)
                    : value === option;
                  return (
                    <Pressable
                      key={option}
                      accessibilityRole={q.multi ? "checkbox" : "radio"}
                      accessibilityState={{ checked }}
                      onPress={() =>
                        answer(q.multi ? toggleAnswer(value, option) : option)
                      }
                      style={[
                        s.card,
                        s.row,
                        {
                          minHeight: 56,
                          paddingVertical: 14,
                          backgroundColor: checked ? C.sage : "#fff",
                          borderColor: checked ? C.green : C.line,
                        },
                      ]}
                    >
                      <Icon
                        name={checked ? "checkmark-circle" : "ellipse-outline"}
                        size={21}
                        color={checked ? C.green : "#7A847B"}
                      />
                      <Body style={{ flex: 1 }}>{option}</Body>
                    </Pressable>
                  );
                })}
          </View>
          <Button
            title={step === 9 ? "Review my preferences" : "Continue"}
            icon="arrow-forward"
            disabled={!validAnswer(step, value)}
            onPress={() => move(step + 1)}
          />
          {step > 0 && (
            <Button secondary title="Back" onPress={() => move(step - 1)} />
          )}
        </>
      ) : (
        <>
          <Title>Your pace. Your preferences.</Title>
          {preview && (
            <Card style={{ backgroundColor: C.sage }}>
              <Badge>PREVIEW · VERSION {preview.revision}</Badge>
              <View style={s.between}>
                <Body>Current comfort</Body>
                <Body style={{ fontWeight: "700" }}>
                  {comfortLabel(preview.comfortScore)} · {preview.comfortScore}
                  /100
                </Body>
              </View>
            </Card>
          )}
          {!!error && <Body style={{ color: C.danger }}>{error}</Body>}
          <Button
            title="Confirm my preferences"
            icon="checkmark"
            disabled={!preview}
            onPress={activate}
          />
          <Button title="Back to questions" secondary onPress={() => move(9)} />
        </>
      )}
    </Page>
  );
}

function ConversationQuiz({ onSwitch }: { onSwitch: () => void }) {
  const { state, setState, profile } = useApp();
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [proposal, setProposal] = useState<{
    answers: Answers;
    persona: Persona;
    confirmSummary: string;
  } | null>(null);

  async function runTurn(history: ChatMsg[]) {
    setBusy(true);
    setError("");
    try {
      const result = await api<QuizTurnResponse>("/api/quiz/turn", {
        method: "POST",
        url: state.settings.apiUrl,
        body: {
          messages: history,
          processingConsent: true,
          processingProvider: "gemini",
        },
      });
      const next = [
        ...history,
        { role: "assistant" as const, text: result.assistantMessage },
      ];
      setMessages(next);
      if (
        result.complete &&
        result.answers &&
        result.persona &&
        result.confirmSummary
      ) {
        setProposal({
          answers: result.answers,
          persona: result.persona,
          confirmSummary: result.confirmSummary,
        });
      }
    } catch (e) {
      setError(
        e instanceof ClientError
          ? e.message
          : "Quiz chat failed. Retry or use the classic form.",
      );
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!hasGeminiConsent(state.settings)) return;
    if (messages.length || busy || proposal) return;
    void runTurn([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.settings.processingConsent]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    const history = [...messages, { role: "user" as const, text }];
    setMessages(history);
    setInput("");
    await runTurn(history);
  }

  function confirm() {
    if (!proposal) return;
    try {
      const next = createProfile(
        proposal.answers,
        Math.max(0, ...state.profiles.map((p) => p.revision)) + 1,
        proposal.persona,
      );
      setState((prev) => ({
        ...prev,
        profiles: [...prev.profiles, next],
        activeProfileId: next.id,
        draft: null,
      }));
      router.replace("/");
    } catch {
      setError("Could not save that profile. Retry the conversation.");
    }
  }

  if (!hasGeminiConsent(state.settings)) {
    return (
      <Page>
        <Title small>Allow live AI first</Title>
        <Body muted>
          The conversational quiz uses Gemini on your StepIn server. Turn on
          live AI processing in Settings, or use the classic form offline.
        </Body>
        <Button title="Open Settings" onPress={() => router.push("/settings")} />
        <Button secondary title="Use classic form" onPress={onSwitch} />
      </Page>
    );
  }

  return (
    <Page>
      <View style={s.between}>
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            router.canGoBack() ? router.back() : router.replace("/")
          }
          style={{ minHeight: 44, justifyContent: "center" }}
        >
          <Body muted>Save & close</Body>
        </Pressable>
        <Badge>{profile ? "PROFILE RETAKE" : "AI CONVERSATION"}</Badge>
      </View>
      <Title small>A short chat so coaching sounds like you.</Title>
      <Body muted>
        Not a test. We store preferences and a style card so suggestions stay
        natural for you.
      </Body>
      <Button secondary title="Use classic form instead" onPress={onSwitch} />
      <View style={{ gap: 10 }}>
        {messages.map((m, i) => (
          <Card
            key={`${m.role}-${i}`}
            style={{
              backgroundColor: m.role === "assistant" ? C.sage : "#fff",
              alignSelf: m.role === "user" ? "flex-end" : "stretch",
              maxWidth: "100%",
            }}
          >
            <Body style={s.small}>
              {m.role === "assistant" ? "StepIn" : "You"}
            </Body>
            <Body>{m.text}</Body>
          </Card>
        ))}
      </View>
      {proposal ? (
        <Card style={{ backgroundColor: C.sage }}>
          <Body style={{ fontWeight: "700" }}>Does this sound like you?</Body>
          <Body>{proposal.confirmSummary}</Body>
          <Body style={s.small}>{proposal.persona.summary}</Body>
          <Body style={s.small}>
            Tone: {proposal.persona.tone.join(", ") || "—"} · Pacing:{" "}
            {proposal.persona.pacing}
          </Body>
          <Button title="Confirm my preferences" icon="checkmark" onPress={confirm} />
          <Button
            secondary
            title="Keep chatting"
            onPress={() => setProposal(null)}
          />
        </Card>
      ) : (
        <>
          <TextField
            accessibilityLabel="Your reply"
            placeholder="Type your reply…"
            value={input}
            onChangeText={setInput}
            multiline
            maxLength={2000}
          />
          <Button
            title="Send"
            icon="arrow-up"
            busy={busy}
            disabled={!input.trim() || busy}
            onPress={() => void send()}
          />
        </>
      )}
      {!!error && <Body style={{ color: C.danger }}>{error}</Body>}
      {busy && !proposal ? <Body muted>Thinking…</Body> : null}
    </Page>
  );
}

export default function Quiz() {
  const [mode, setMode] = useState<"conversation" | "classic">("conversation");
  if (mode === "classic")
    return <ClassicQuiz onSwitch={() => setMode("conversation")} />;
  return <ConversationQuiz onSwitch={() => setMode("classic")} />;
}
