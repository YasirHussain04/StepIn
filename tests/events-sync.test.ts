import { afterEach, describe, expect, it, vi } from "vitest";
import { EventService, calgaryDate, parseLibrary } from "../server/events";
import { readConfig } from "../server/config";
import { INITIAL_STATE, AppState } from "../src/domain/types";
import { createProfile } from "../src/domain/quiz";
import {
  changesToOperations,
  emptyCloud,
  isolateAccount,
  mergeCloud,
  seedOperations,
} from "../src/services/sync";
import type { CloudSnapshot } from "../shared/contracts";
const html = `<ul><li class="tile-item"><a href="https://www.calgarylibrary.ca/events-and-programs/programs/coffee"><p class="tile-colour-flag">Central Library | November 12 | 6:00 pm</p><h3 class="tile-title">Newcomer conversation</h3><p class="tile-summary">Practice English</p></a></li><li class="tile-item"><a href="https://www.calgarylibrary.ca/events-and-programs/programs/weekly"><p class="tile-colour-flag">Central Library | November 2 – December 21 | 2:00 pm</p><h3 class="tile-title">Recurring event</h3></a></li><li class="tile-item"><a href="https://malicious.example/phishing"><p class="tile-colour-flag">Central Library | November 15 | 2:00 pm</p><h3 class="tile-title">Untrusted host</h3></a></li></ul>`;
describe("organizer event refresh", () => {
  afterEach(() => vi.useRealTimers());
  it("parses sourced date/time facts without inventing recurring sessions or trusting unrelated hosts", () => {
    const result = parseLibrary(
      html,
      "https://www.calgarylibrary.ca/",
      new Date("2026-11-07"),
    );
    expect(result).toHaveLength(1);
    expect(result[0].date).toBe("2026-11-12T18:00:00-07:00");
    expect(result[0].category).toBe("Meetups");
    expect(result[0].dateSource).toBe("https://www.calgarylibrary.ca/");
    expect(
      parseLibrary(
        html
          .replace("Newcomer conversation", "Entering Entrepreneurship")
          .replace("Practice English", "Start a business"),
        "https://www.calgarylibrary.ca/",
        new Date("2026-11-07"),
      )[0].category,
    ).toBe("Community");
  });
  it("uses the correct Calgary summer and winter offsets", () => {
    expect(calgaryDate(2026, 7, 12, 18, 0)).toContain("-06:00");
    expect(calgaryDate(2026, 11, 12, 18, 0)).toContain("-07:00");
  });
  it("keeps the last valid cache on feed/network/markup failure", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(html, { headers: { "content-type": "text/html" } }),
      )
      .mockRejectedValue(new Error("Offline"));
    const service = new EventService(
      readConfig({}),
      (input, init) => fetcher(String(input), init),
      ".cache/test-events/cache.json",
    );
    const first = await service.get(true);
    expect(first.source).toBe("organizer");
    expect(first.stale).toBe(false);
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 16 * 60_000);
    const fallback = await service.get(true);
    expect(fallback.events).toEqual(first.events);
    expect(fallback.fetchedAt).toBe(first.fetchedAt);
    expect(fallback.stale).toBe(true);
    vi.restoreAllMocks();
  });
  it("deduplicates concurrent refreshes", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(html, { headers: { "content-type": "text/html" } }),
      );
    const service = new EventService(
      readConfig({}),
      (input, init) => fetcher(String(input), init),
      ".cache/test-events/concurrent.json",
    );
    await Promise.all([service.get(true), service.get(true)]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
const base = (): AppState => ({
  ...structuredClone(INITIAL_STATE),
  ownerId: "user-a",
  cloud: { ...emptyCloud(), enabled: true, consented: true },
});
const snapshot = (): CloudSnapshot => ({
  revision: 2,
  historyEpoch: 0,
  activeProfileId: null,
  profiles: [],
  sessions: [],
});
describe("offline sync queue and account isolation", () => {
  it("clears user-specific data and pending operations when signing out or switching accounts", () => {
    const state = base();
    state.draft = { answers: { q1: 5 }, step: 1 };
    state.sessions = [
      {
        id: "private",
        title: "My conversation",
        room: "private",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: [],
      },
    ];
    for (const owner of [null, "user-b"]) {
      const next = isolateAccount(state, owner);
      expect(next.sessions).toEqual([]);
      expect(next.draft).toBeNull();
      expect(next.cloud?.queue).toEqual([]);
      expect(next.ownerId).toBe(owner);
    }
  });
  it("keeps guest onboarding available and requires explicit sync consent before queuing data", () => {
    const guest = structuredClone(INITIAL_STATE);
    const signed = isolateAccount(guest, "user-a");
    const next = {
      ...signed,
      sessions: [
        {
          id: "one",
          title: "Room",
          room: "room",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          messages: [],
        },
      ],
    };
    expect(changesToOperations(signed, next)).toEqual([]);
  });
  it("does not queue temporary messages or client-claimed live assistant results", () => {
    const previous = base();
    const now = new Date().toISOString();
    const next = {
      ...previous,
      sessions: [
        {
          id: "room",
          title: "Room",
          room: "room",
          createdAt: now,
          updatedAt: now,
          messages: [
            {
              id: "u",
              role: "user" as const,
              text: "not saved",
              createdAt: now,
              persisted: false,
            },
            {
              id: "a",
              role: "assistant" as const,
              text: "approved elsewhere",
              createdAt: now,
              audit: {
                source: "live" as const,
                decision: "approved" as const,
                profileId: "p",
                attempts: 1,
                summary: "ok",
                checks: [],
                suggestionVersion: "s",
                auditVersion: "a",
              },
            },
          ],
        },
      ],
    };
    const operations = changesToOperations(previous, next);
    expect(operations.map((o) => o.kind)).toEqual(["session.put"]);
  });
  it("retains local edits made while a cloud snapshot was in flight", () => {
    const current = base();
    const now = new Date().toISOString();
    const cloud = snapshot();
    cloud.sessions = [
      {
        id: "room",
        title: "Cloud title",
        room: "room",
        createdAt: now,
        updatedAt: now,
        messages: [],
      },
    ];
    const merged = mergeCloud(current, cloud, [
      {
        id: "op",
        kind: "session.put",
        session: {
          ...cloud.sessions[0],
          messages: undefined,
          title: "My pending rename",
        } as never,
        historyEpoch: 0,
      },
    ]);
    expect(merged.sessions[0].title).toBe("My pending rename");
    expect(merged.cloud?.revision).toBe(2);
    expect(merged.cloud?.queue).toHaveLength(1);
  });
  it("does not recreate a remotely deleted session just to preserve temporary messages", () => {
    const current = base();
    const now = new Date().toISOString();
    current.sessions = [
      {
        id: "removed",
        title: "Removed",
        room: "room",
        createdAt: now,
        updatedAt: now,
        messages: [
          {
            id: "private",
            role: "user",
            text: "temporary",
            createdAt: now,
            persisted: false,
          },
        ],
      },
    ];
    expect(mergeCloud(current, snapshot(), []).sessions).toHaveLength(0);
  });
  it("keeps deletion operations while sync is paused", () => {
    const previous = base();
    previous.cloud!.enabled = false;
    const now = new Date().toISOString();
    previous.sessions = [
      {
        id: "gone",
        title: "Room",
        room: "room",
        createdAt: now,
        updatedAt: now,
        messages: [],
      },
    ];
    expect(
      changesToOperations(previous, { ...previous, sessions: [] })[0].kind,
    ).toBe("session.delete");
  });
  it("avoids re-uploading already synchronized immutable messages", () => {
    const state = base();
    const now = new Date().toISOString();
    const session = {
      id: "s",
      title: "Room",
      room: "room",
      createdAt: now,
      updatedAt: now,
      messages: [
        { id: "m", role: "user" as const, text: "hello", createdAt: now },
      ],
    };
    state.sessions = [session];
    const cloud = snapshot();
    cloud.sessions = [session];
    expect(seedOperations(state, cloud)).toEqual([]);
  });
});
