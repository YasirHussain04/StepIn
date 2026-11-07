export type Answers = Record<string, number | string | string[]>;
export type Profile = {
  id: string;
  revision: number;
  answers: Answers;
  comfortScore: number;
  desiredActivityScore: number;
  completedAt: string;
  questionnaireVersion: "1";
  scoringVersion: "1";
};
export type Audit = {
  source: "fixture";
  decision: "approved" | "clarification";
  profileId: string;
  attempts: number;
  summary: string;
  checks: string[];
  suggestionVersion: "fixture-1";
  auditVersion: "rules-1";
};
export type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  audit?: Audit;
  icebreaker?: string;
  affirmation?: string;
  action?: "start" | "follow_up" | "another" | "simplify" | "encourage";
  persisted?: boolean;
};
export type Session = {
  id: string;
  title: string;
  room: string;
  scenarioId?: string;
  createdAt: string;
  updatedAt: string;
  messages: Message[];
  persisted?: boolean;
};
export type Settings = {
  history: boolean;
  affirmations: boolean;
  rate: number;
  audio: boolean;
  interests: string;
};
export type AppState = {
  profiles: Profile[];
  activeProfileId: string | null;
  draft: { answers: Answers; step: number } | null;
  sessions: Session[];
  settings: Settings;
};
export const INITIAL_STATE: AppState = {
  profiles: [],
  activeProfileId: null,
  draft: null,
  sessions: [],
  settings: {
    history: true,
    affirmations: true,
    rate: 0.9,
    audio: true,
    interests: "",
  },
};
export function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
}
