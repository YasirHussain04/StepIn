import { Answers, Profile, uid } from "./types";

export const questions = [
  {
    id: "q1",
    title:
      "How comfortable do you currently feel starting a conversation with someone new?",
    low: "Not comfortable at all",
    high: "Very comfortable",
  },
  {
    id: "q2",
    title:
      "How comfortable do you feel joining a small group that is already talking?",
    low: "Not comfortable at all",
    high: "Very comfortable",
  },
  {
    id: "q3",
    title:
      "How comfortable are you keeping a conversation going after introductions?",
    low: "Not comfortable at all",
    high: "Very comfortable",
  },
  {
    id: "q4",
    title:
      "How comfortable do you feel participating in an unfamiliar community activity?",
    low: "Not comfortable at all",
    high: "Very comfortable",
  },
  {
    id: "q5",
    title: "How often would you like to meet someone new at community events?",
    low: "Never or rarely",
    high: "Very often",
  },
  {
    id: "q6",
    title: "How much interaction would you like during a typical event?",
    low: "Almost none",
    high: "Frequent interaction",
  },
  {
    id: "q7",
    title: "What kind of interaction feels best for you?",
    options: [
      "One to one",
      "Small group",
      "Larger group",
      "Structured activity",
      "Observe first",
      "No preference",
    ],
    multi: false,
  },
  {
    id: "q8",
    title: "What would make communication easier for you?",
    options: [
      "Short wording",
      "More processing time",
      "Text instead of audio",
      "Audio instead of reading",
      "Language support",
      "Alternative or augmentative communication support",
      "None",
      "Prefer not to say",
    ],
    multi: true,
  },
  {
    id: "q9",
    title: "Are there accessibility needs you want StepIn to accommodate?",
    options: [
      "Quieter setting or sensory breaks",
      "Hearing access",
      "Visual access",
      "Speech or communication access",
      "Mobility or seating access",
      "Attention or memory support",
      "Other self-described support",
      "None",
      "Prefer not to say",
    ],
    multi: true,
  },
  {
    id: "q10",
    title: "What support would you like from StepIn right now?",
    options: [
      "A low-pressure first step",
      "Icebreakers",
      "Follow-up questions",
      "Encouragement",
      "Help joining an activity",
      "Help taking a break or leaving politely",
      "No coaching right now",
    ],
    multi: true,
  },
] as const;

const exclusive = ["None", "Prefer not to say", "No coaching right now"];
export function toggleAnswer(current: unknown, value: string): string[] {
  const values = Array.isArray(current) ? (current as string[]) : [];
  if (values.includes(value)) return values.filter((v) => v !== value);
  if (exclusive.includes(value)) return [value];
  // Opposite audio preferences cannot be active together.
  return [
    ...values.filter(
      (v) =>
        !exclusive.includes(v) &&
        !(
          value === "Text instead of audio" && v === "Audio instead of reading"
        ) &&
        !(
          value === "Audio instead of reading" && v === "Text instead of audio"
        ),
    ),
    value,
  ];
}
export function validAnswer(index: number, value: unknown): boolean {
  const q = questions[index];
  if (!q) return false;
  if ("low" in q)
    return (
      typeof value === "number" &&
      Number.isInteger(value) &&
      value >= 1 &&
      value <= 5
    );
  if (!q.multi)
    return (
      typeof value === "string" &&
      (q.options as readonly string[]).includes(value)
    );
  if (
    !Array.isArray(value) ||
    !value.length ||
    new Set(value).size !== value.length
  )
    return false;
  if (
    !value.every(
      (v) =>
        typeof v === "string" && (q.options as readonly string[]).includes(v),
    )
  )
    return false;
  if (value.length > 1 && value.some((v) => exclusive.includes(v)))
    return false;
  return !(
    value.includes("Text instead of audio") &&
    value.includes("Audio instead of reading")
  );
}
export function validateAnswers(answers: Answers): boolean {
  return (
    Object.keys(answers).length === 10 &&
    questions.every((q, i) => validAnswer(i, answers[q.id]))
  );
}
export function score(values: number[]): number {
  if (
    !values.length ||
    values.some((v) => !Number.isInteger(v) || v < 1 || v > 5)
  )
    throw new Error("Invalid score answers");
  return Math.round(
    ((values.reduce((a, b) => a + b, 0) / values.length - 1) / 4) * 100,
  );
}
export function comfortLabel(score: number) {
  return score < 20
    ? "Very low"
    : score < 40
      ? "Low"
      : score < 60
        ? "Moderate"
        : score < 80
          ? "High"
          : "Very high";
}
export function createProfile(
  answers: Answers,
  revision: number,
  persona?: Profile["persona"],
): Profile {
  if (!validateAnswers(answers)) throw new Error("SCREENING_REQUIRED");
  return {
    id: uid(),
    revision,
    answers: JSON.parse(JSON.stringify(answers)),
    comfortScore: score([1, 2, 3, 4].map((n) => answers[`q${n}`] as number)),
    desiredActivityScore: score([5, 6].map((n) => answers[`q${n}`] as number)),
    completedAt: new Date().toISOString(),
    questionnaireVersion: "1",
    scoringVersion: "1",
    ...(persona ? { persona: JSON.parse(JSON.stringify(persona)) } : {}),
  };
}
export function requireProfile(
  profile: Profile | undefined | null,
): asserts profile is Profile {
  if (!profile || !profile.completedAt || !validateAnswers(profile.answers))
    throw new Error("SCREENING_REQUIRED");
}
export function preference(profile: Profile, question: string, value: string) {
  const answer = profile.answers[question];
  return Array.isArray(answer) ? answer.includes(value) : answer === value;
}
export function canSpeak(profile: Profile | null | undefined, audio: boolean) {
  return (
    !!profile && audio && !preference(profile, "q8", "Text instead of audio")
  );
}
