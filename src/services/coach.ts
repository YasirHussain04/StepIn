import { Audit, Message, Profile, uid } from "../domain/types";
import { preference, requireProfile } from "../domain/quiz";
import { scenarios } from "../demo/scenarios";

export type CoachAction =
  "start" | "follow_up" | "another" | "simplify" | "encourage";
type Candidate = {
  text: string;
  icebreaker?: string;
  affirmation?: string;
  forceRevision?: boolean;
  clarification?: boolean;
};
// Deliberately deterministic fixtures. No model is called or implied by these stages.
export function draftFixture(
  profile: Profile,
  room: string,
  scenarioId: string | undefined,
  action: CoachAction,
  turn: number,
  message = "",
): Candidate {
  requireProfile(profile);
  if (preference(profile, "q10", "No coaching right now"))
    return {
      text: "Coaching is paused, just as you asked. You can explore Calgary events or change your support preferences in Settings.",
    };
  const scenario = scenarios.find((s) => s.id === scenarioId);
  if (!scenario)
    return {
      text: `This offline demo cannot interpret a new room description or answer arbitrary questions. You wrote: “${room.slice(0, 350)}”\n\nWhat activity can you directly see? Try one of the three demo rooms for a tailored practice idea.`,
      clarification: true,
    };
  if (
    /\b(leave|break|overwhelm|quiet)\b/i.test(message) ||
    preference(profile, "q10", "Help taking a break or leaving politely")
  )
    return {
      text: "You can take a break whenever you need. If you want a closing line, try:",
      icebreaker: "Thanks for chatting. I’m going to take a little break.",
    };
  if (action === "follow_up") {
    if (/another|different/i.test(message)) action = "another";
    else if (/simpl|short/i.test(message)) action = "simplify";
    else if (/encourag|nervous/i.test(message)) action = "encourage";
    else
      return {
        text: "This offline room follows a short practice script. Would you like another idea, simpler wording, encouragement, or help taking a break?",
        clarification: true,
      };
  }
  if (action === "encourage")
    return {
      text: "You can choose one small step, or simply observe. There is no deadline to join in.",
      affirmation: "Your pace is a good place to start.",
    };
  const observe = preference(profile, "q7", "Observe first");
  const text =
    action === "simplify" || preference(profile, "q8", "Short wording")
      ? "Try one question. Then take your time."
      : observe
        ? "You could watch the activity for a little while. When you feel ready, try a question."
        : profile.comfortScore < 40
          ? profile.desiredActivityScore >= 40
            ? `A small first step can help you move toward the connection you want. ${scenario.entry}`
            : "You can observe, or try one small step if you want. There is no need to interact more than feels right today."
          : scenario.entry;
  const accommodation = preference(
    profile,
    "q9",
    "Quieter setting or sensory breaks",
  )
    ? " You can look for a quieter spot or take a sensory break if you want."
    : preference(profile, "q9", "Mobility or seating access")
      ? " You can ask the organizer about seating or an accessible way to participate."
      : "";
  const pacing = preference(profile, "q8", "More processing time")
    ? " Take as much time as you need before replying."
    : "";
  return {
    text: text + accommodation + pacing,
    icebreaker:
      action === "another" || turn % 2 === 1
        ? scenario.alternative
        : scenario.icebreaker,
    affirmation: "You don’t have to have the perfect words.",
    forceRevision: scenario.revision && action === "start",
  };
}
export function auditFixture(
  candidate: Candidate,
  profile: Profile,
  scenarioId?: string,
): { approved: boolean; checks: string[] } {
  requireProfile(profile);
  const checks = [
    "Confirmed screening and current profile version",
    "No claims about strangers’ emotions or willingness",
    "Explicit support preferences respected",
  ];
  if (candidate.forceRevision) return { approved: false, checks };
  if (
    preference(profile, "q10", "No coaching right now") &&
    candidate.icebreaker
  )
    return { approved: false, checks };
  if (!scenarioId)
    checks.push("Insufficient evidence: asked for clarification");
  return { approved: true, checks };
}
export function runFixture(
  profile: Profile,
  room: string,
  scenarioId: string | undefined,
  action: CoachAction,
  turn: number,
  affirmations: boolean,
  message = "",
): Message {
  requireProfile(profile);
  let candidate = draftFixture(
    profile,
    room,
    scenarioId,
    action,
    turn,
    message,
  );
  let audit = auditFixture(candidate, profile, scenarioId);
  let attempts = 1;
  if (!audit.approved) {
    // The unsuitable fixture is never returned to the UI or speech service.
    candidate = {
      ...candidate,
      forceRevision: false,
      text:
        (preference(profile, "q7", "Observe first")
          ? "Watch for a moment. When ready, ask one person a question."
          : preference(profile, "q8", "Short wording")
            ? "Ask one person a short question. Take your time."
            : "Start with one person at the game table. You can ask a short question and decide what to do next.") +
        (preference(profile, "q9", "Quieter setting or sensory breaks")
          ? " You can choose a quieter spot or take a break."
          : "") +
        (preference(profile, "q9", "Mobility or seating access")
          ? " Ask about an accessible place to join from."
          : "") +
        (preference(profile, "q8", "More processing time")
          ? " There is no rush to reply."
          : ""),
    };
    audit = auditFixture(candidate, profile, scenarioId);
    attempts = 2;
  }
  if (!audit.approved) throw new Error("AUDIT_FAILED");
  const clarification = !!candidate.clarification;
  const record: Audit = {
    source: "fixture",
    decision: clarification ? "clarification" : "approved",
    profileId: profile.id,
    attempts,
    summary: clarification
      ? "The offline fixture cannot interpret an unfamiliar room. No social recommendation was released."
      : attempts === 2
        ? "The game-night fixture requested a smaller first step, revised it, and checked the revision. This is a simulated review."
        : "Local fixture rules checked the response against this profile. No live AI review ran.",
    checks: audit.checks,
    suggestionVersion: "fixture-1",
    auditVersion: "rules-1",
  };
  return {
    id: uid(),
    role: "assistant",
    text: candidate.text,
    createdAt: new Date().toISOString(),
    audit: record,
    icebreaker: clarification ? undefined : candidate.icebreaker,
    affirmation:
      !clarification && affirmations ? candidate.affirmation : undefined,
  };
}
