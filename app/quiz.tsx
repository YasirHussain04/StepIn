import React, { useMemo, useState } from "react";
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

export default function Quiz() {
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
        <Badge>{profile ? "PROFILE RETAKE" : "YOUR FIRST STEP"}</Badge>
      </View>
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
          <Body muted>
            {step < 6
              ? "Choose the answer that feels right today. There are no right or wrong answers."
              : step === 7 || step === 8
                ? "Sharing support needs is optional. “Prefer not to say” is a complete answer. Select all that apply."
                : "multi" in q && q.multi
                  ? "Select all that apply."
                  : "Choose one preference."}
          </Body>
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
                    <View
                      style={{
                        height: 27,
                        width: 27,
                        borderRadius: 9,
                        backgroundColor: value === n ? C.green : C.bg,
                        justifyContent: "center",
                        alignItems: "center",
                      }}
                    >
                      <Text
                        style={{
                          color: value === n ? "#fff" : C.green,
                          fontWeight: "600",
                        }}
                      >
                        {n}
                      </Text>
                    </View>
                    <Body style={{ flex: 1 }}>
                      {n === 1
                        ? q.low
                        : n === 5
                          ? q.high
                          : step < 4
                            ? [
                                "Slightly comfortable",
                                "Moderately comfortable",
                                "Quite comfortable",
                              ][n - 2]
                            : step === 4
                              ? ["Occasionally", "Sometimes", "Often"][n - 2]
                              : [
                                  "A little interaction",
                                  "Some interaction",
                                  "Quite a bit of interaction",
                                ][n - 2]}
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
          <Body style={s.small}>
            A personalization quiz, not a personality test or disability
            assessment. Answers stay on this device in this demo.
          </Body>
        </>
      ) : (
        <>
          <Label>Made for where you are today</Label>
          <Title>Your pace. Your preferences.</Title>
          <Body muted>
            Review before you confirm.{" "}
            {profile
              ? "Your current profile stays active until you confirm this revision."
              : "Confirming unlocks practice and coaching."}
          </Body>
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
              <View style={s.between}>
                <Body>Desired activity</Body>
                <Body style={{ fontWeight: "700" }}>
                  {preview.desiredActivityScore}/100
                </Body>
              </View>
              <Body>{String(answers.q7)}</Body>
              <Body style={s.small}>
                Comfort and desired interaction are separate. Support needs
                never affect either score.
              </Body>
            </Card>
          )}
          {profile && (
            <Body muted>
              Current profile: {comfortLabel(profile.comfortScore)} comfort (
              {profile.comfortScore}/100), desired activity{" "}
              {profile.desiredActivityScore}/100.
            </Body>
          )}
          {questions.map((question, i) => (
            <Pressable
              key={question.id}
              accessibilityRole="button"
              accessibilityLabel={`Edit question ${i + 1}`}
              onPress={() => move(i)}
              style={[s.card, { padding: 15 }]}
            >
              <Text style={[s.small, { color: C.ink }]}>
                {i + 1}. {question.title}
              </Text>
              <Body>
                {Array.isArray(answers[question.id])
                  ? (answers[question.id] as string[]).join(" · ")
                  : String(answers[question.id] ?? "Not answered")}
                {i < 6 ? " / 5" : ""}
              </Body>
              <Text style={[s.small, { color: C.green }]}>Edit answer →</Text>
            </Pressable>
          ))}
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
