import { describe, expect, it } from "vitest";
import { Answers, Profile } from "../src/domain/types";
import {
  canSpeak,
  comfortLabel,
  createProfile,
  score,
  toggleAnswer,
  validateAnswers,
} from "../src/domain/quiz";
import { draftFixture, runFixture } from "../src/services/coach";
import { approvedSpokenText } from "../src/services/playback";
import { eventFormat, events, sortedEvents } from "../src/data/events";

const answers = (): Answers => ({
  q1: 2,
  q2: 2,
  q3: 2,
  q4: 2,
  q5: 5,
  q6: 5,
  q7: "One to one",
  q8: ["Prefer not to say"],
  q9: ["Prefer not to say"],
  q10: ["A low-pressure first step"],
});
const profile = (changes: Answers = {}): Profile =>
  createProfile({ ...answers(), ...changes }, 1);
describe("required screening and deterministic scoring", () => {
  it("keeps comfort, desire and sensitive answers separate", () => {
    const p = profile();
    expect(p.comfortScore).toBe(25);
    expect(p.desiredActivityScore).toBe(100);
    expect(profile({ q9: ["Mobility or seating access"] }).comfortScore).toBe(
      p.comfortScore,
    );
  });
  it.each([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])(
    "rejects an incomplete answer set missing question %s",
    (index) => {
      const a = answers();
      delete a[`q${index + 1}`];
      expect(validateAnswers(a)).toBe(false);
      expect(() => createProfile(a, 1)).toThrow("SCREENING_REQUIRED");
    },
  );
  it("rejects unknown, duplicate, fractional, coerced, conflicting and out-of-range answers", () => {
    for (const change of [
      { extra: 1 },
      { q1: "2" },
      { q2: 6 },
      { q3: 2.5 },
      { q4: 0 },
      { q7: "Unknown" },
      { q8: [] },
      { q8: ["None", "Short wording"] },
      { q9: ["Prefer not to say", "Visual access"] },
      { q10: ["Icebreakers", "Icebreakers"] },
      { q8: ["Text instead of audio", "Audio instead of reading"] },
    ])
      expect(
        validateAnswers({ ...answers(), ...change } as unknown as Answers),
      ).toBe(false);
  });
  it("accepts explicit non-disclosure and exclusive selection behavior", () => {
    expect(validateAnswers(answers())).toBe(true);
    expect(toggleAnswer(["Short wording"], "Prefer not to say")).toEqual([
      "Prefer not to say",
    ]);
    expect(toggleAnswer(["None"], "Short wording")).toEqual(["Short wording"]);
    expect(
      toggleAnswer(["Text instead of audio"], "Audio instead of reading"),
    ).toEqual(["Audio instead of reading"]);
    expect(toggleAnswer(["No coaching right now"], "Icebreakers")).toEqual([
      "Icebreakers",
    ]);
  });
  it("scores endpoints and ranges", () => {
    expect(score([1, 1, 1, 1])).toBe(0);
    expect(score([5, 5, 5, 5])).toBe(100);
    expect(score([1, 2, 3, 4])).toBe(38);
    expect([0, 19, 20, 39, 40, 59, 60, 79, 80, 100].map(comfortLabel)).toEqual([
      "Very low",
      "Very low",
      "Low",
      "Low",
      "Moderate",
      "Moderate",
      "High",
      "High",
      "Very high",
      "Very high",
    ]);
  });
  it("makes independent revisions without mutating the original", () => {
    const a = answers();
    const p1 = createProfile(a, 1);
    const p2 = createProfile({ ...a, q1: 5 }, 2);
    a.q2 = 5;
    expect(p1.answers.q2).toBe(2);
    expect(p2.id).not.toBe(p1.id);
    expect(p2.revision).toBe(2);
  });
});
describe("fixture gate and speech", () => {
  it("blocks incomplete profiles at the service boundary", () => {
    expect(() =>
      runFixture(
        { ...profile(), answers: {} },
        "room",
        "games",
        "start",
        0,
        true,
      ),
    ).toThrow("SCREENING_REQUIRED");
  });
  it("keeps the first draft private, revises once and records fixture provenance", () => {
    const p = profile();
    expect(draftFixture(p, "room", "games", "start", 0).forceRevision).toBe(
      true,
    );
    const response = runFixture(p, "room", "games", "start", 0, true);
    expect(response.audit?.attempts).toBe(2);
    expect(response.audit?.source).toBe("fixture");
    expect(response.audit?.decision).toBe("approved");
    expect(response.audit?.profileId).toBe(p.id);
  });
  it("returns distinct room-specific practice and uses current profile version", () => {
    const p = profile();
    const messages = ["games", "garden", "welcome"].map((s) =>
      runFixture(p, "room", s, "start", 0, true),
    );
    expect(new Set(messages.map((m) => m.icebreaker)).size).toBe(3);
    const next = createProfile(answers(), 2);
    expect(
      runFixture(next, "room", "games", "start", 0, true).audit?.profileId,
    ).toBe(next.id);
  });
  it("supports observe-first, processing time and sensory breaks after revision", () => {
    const p = profile({
      q7: "Observe first",
      q8: ["More processing time"],
      q9: ["Quieter setting or sensory breaks"],
    });
    const response = runFixture(p, "room", "games", "start", 0, true);
    expect(response.text).toMatch(/Watch/);
    expect(response.text).toMatch(/quieter/);
    expect(response.text).toMatch(/no rush/);
  });
  it("does not suggest social actions for unfamiliar descriptions or arbitrary follow-ups", () => {
    const p = profile();
    for (const m of [
      runFixture(p, "something unclear", undefined, "start", 0, true),
      runFixture(
        p,
        "room",
        "games",
        "follow_up",
        1,
        true,
        "What is my friend thinking?",
      ),
    ]) {
      expect(m.audit?.decision).toBe("clarification");
      expect(m.icebreaker).toBeUndefined();
      expect(m.affirmation).toBeUndefined();
    }
  });
  it("respects no-coaching, encouragement and audio opt-outs", () => {
    const p = profile({ q10: ["No coaching right now"] });
    expect(
      runFixture(p, "room", "games", "start", 0, true).icebreaker,
    ).toBeUndefined();
    expect(
      runFixture(profile(), "room", "games", "start", 0, false).affirmation,
    ).toBeUndefined();
    expect(canSpeak(profile({ q8: ["Text instead of audio"] }), true)).toBe(
      false,
    );
  });
  it("speaks only exactly approved content, with both current and historical exclusions", () => {
    const p = profile();
    const m = runFixture(p, "room", "garden", "start", 0, true);
    expect(approvedSpokenText(m, p, [p], true)).toBe(
      [m.text, m.icebreaker, m.affirmation].filter(Boolean).join("\n"),
    );
    expect(() =>
      approvedSpokenText({ ...m, audit: undefined }, p, [p], true),
    ).toThrow("APPROVED_TEXT_REQUIRED");
    expect(() => approvedSpokenText(m, p, [p], false)).toThrow(
      "SPEECH_DISABLED",
    );
    expect(() => approvedSpokenText(m, null, [p], true)).toThrow(
      "SCREENING_REQUIRED",
    );
    expect(() => approvedSpokenText(m, p, [], true)).toThrow("SPEECH_DISABLED");
    const quiet = profile({ q8: ["Text instead of audio"] });
    expect(() => approvedSpokenText(m, quiet, [p, quiet], true)).toThrow(
      "SPEECH_DISABLED",
    );
  });
});
describe("Calgary calendar", () => {
  it("preserves organizer-local times rather than converting them to the viewer timezone", () => {
    expect(
      eventFormat("2026-11-12T18:00:00-07:00", {
        weekday: "short",
        hour: "numeric",
      }),
    ).toBe("Thu 6:00 p.m.");
    expect(eventFormat("2026-11-12T18:00:00-07:00", { day: "numeric" })).toBe(
      "12",
    );
  });
  it("sorts soonest first, hides past events and retains original array order", () => {
    const shuffled = [...events].reverse();
    const snapshot = shuffled.map((e) => e.id);
    const result = sortedEvents(
      shuffled,
      Date.parse("2026-11-08T00:00:00-07:00"),
    );
    expect(result[0].id).toBe("networking");
    expect(result.at(-1)?.id).toBe("heritage");
    expect(shuffled.map((e) => e.id)).toEqual(snapshot);
    expect(sortedEvents(shuffled, Date.parse("2027-01-01"))).toHaveLength(0);
    expect(sortedEvents(shuffled, Date.parse("2027-01-01"), true)).toHaveLength(
      events.length,
    );
  });
});
