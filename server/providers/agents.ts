import type { Draft, SceneSummary } from "../../shared/contracts";

export type AgentInput = {
  room: string;
  profile: unknown;
  request: string;
  action: string;
  history: { role: string; text: string }[];
  affirmations: boolean;
  /** Phone photo scene evidence; never treat typed room text as camera data. */
  scene: SceneSummary | null;
};
export interface Agents {
  suggest(
    input: AgentInput,
    signal: AbortSignal,
    revision?: { draft: Draft; changes: string[] },
  ): Promise<unknown>;
  review(
    input: AgentInput,
    draft: Draft,
    signal: AbortSignal,
  ): Promise<unknown>;
}
