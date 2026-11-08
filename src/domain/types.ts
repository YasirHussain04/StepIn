export type Answers = Record<string, number | string | string[]>;
export type Persona = {
  summary: string;
  tone: string[];
  pacing: "slow" | "medium";
  do: string[];
  dont: string[];
  exampleVoice: string;
  source: "conversation_v1";
};
export type Profile = {
  id: string;
  revision: number;
  answers: Answers;
  comfortScore: number;
  desiredActivityScore: number;
  completedAt: string;
  questionnaireVersion: "1";
  scoringVersion: "1";
  persona?: Persona;
};
export type Audit = {
  source: "fixture" | "live";
  decision: "approved" | "clarification";
  profileId: string;
  attempts: number;
  summary: string;
  checks: string[];
  suggestionVersion: string;
  auditVersion: string;
  models?: { conversation: string; audit: string };
  personalized?: boolean;
  checkedAt?: string;
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
  requestId?: string;
  requestProfileId?: string;
  requestPolicy?: string;
};
export type Session = {
  id: string;
  title: string;
  room: string;
  scenarioId?: "games" | "garden" | "welcome";
  createdAt: string;
  updatedAt: string;
  messages: Message[];
  persisted?: boolean;
  mode?: "demo" | "live";
};
export type Settings = {
  history: boolean;
  affirmations: boolean;
  rate: number;
  audio: boolean;
  interests: string;
  apiUrl?: string;
  mode?: "demo" | "live";
  shareProfile?: boolean;
  processingConsent?: boolean;
  processingProvider?: "gemini";
  voiceConsent?: boolean;
};
export function hasGeminiConsent(settings: Settings) {
  return (
    settings.processingConsent === true &&
    settings.processingProvider === "gemini"
  );
}
export type AppState = {
  profiles: Profile[];
  activeProfileId: string | null;
  draft: { answers: Answers; step: number } | null;
  sessions: Session[];
  /** Local-only scene summaries keyed by session id — never synced. */
  scenes?: Record<string, import("../../shared/contracts").SceneSummary>;
  /** Event the user picked in Calgary to coach for next. */
  pendingEvent?: {
    id: string;
    title: string;
    location: string;
    note: string;
  } | null;
  settings: Settings;
  ownerId?: string | null;
  cloud?: {
    enabled: boolean;
    revision: number;
    historyEpoch: number;
    consented?: boolean;
    queue: import("../../shared/contracts").SyncOperation[];
    conflict?: import("../../shared/contracts").CloudSnapshot;
  };
  eventCache?: import("../../shared/contracts").EventsResponse;
};
export const INITIAL_STATE: AppState = {
  profiles: [],
  activeProfileId: null,
  draft: null,
  sessions: [],
  scenes: {},
  pendingEvent: null,
  settings: {
    history: true,
    affirmations: true,
    rate: 0.9,
    audio: true,
    interests: "",
    mode: "live",
    shareProfile: true,
    processingConsent: true,
    processingProvider: "gemini",
    voiceConsent: true,
  },
};
export function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
}
