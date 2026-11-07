import { load } from "cheerio";
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { events as seeds } from "../src/data/events";
import {
  EventSchema,
  EventsResponse,
  EventsResponseSchema,
} from "../shared/contracts";
import { Config } from "./config";

const allowedHosts = new Set([
  "calgarylibrary.ca",
  "www.calgarylibrary.ca",
  "libraryfoundation.ca",
  "www.libraryfoundation.ca",
]);
const months = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];
function category(
  text: string,
): "Community" | "Meetups" | "Arts" | "Outdoors" | "Games" {
  return /walk|hike|garden/i.test(text)
    ? "Outdoors"
    : /game|puzzl|arcade/i.test(text)
      ? "Games"
      : /\b(?:arts?|artists?|music|musical|crafts?|dance|collage)\b/i.test(text)
        ? "Arts"
        : /social|conversation|network|newcomer|meetup/i.test(text)
          ? "Meetups"
          : "Community";
}
// Calgary wall-clock to ISO with the actual IANA zone offset, including DST.
export function calgaryDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
) {
  const initial = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Edmonton",
    timeZoneName: "longOffset",
  }).formatToParts(initial);
  const offset =
    parts.find((p) => p.type === "timeZoneName")?.value.replace("GMT", "") ||
    "-07:00";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00${offset}`;
}
export function parseLibrary(
  html: string,
  sourceUrl: string,
  now = new Date(),
) {
  const $ = load(html);
  const result: EventsResponse["events"] = [];
  $("li.tile-item").each((_, element) => {
    const tile = $(element);
    const anchor = tile
      .find('a[href*="/events-and-programs/programs/"]')
      .first();
    const title = tile.find(".tile-title").first().text().trim();
    const meta = tile
      .find(".tile-colour-flag")
      .first()
      .text()
      .replace(/\s+/g, " ")
      .trim();
    const fields = meta.split("|").map((v) => v.trim());
    if (
      !title ||
      !anchor.attr("href") ||
      fields.length !== 3 ||
      /online/i.test(fields[0])
    )
      return;
    const date = fields[1].match(/^([A-Za-z]+) (\d{1,2})(?:,? (20\d\d))?$/);
    const time = fields[2].match(/^(\d{1,2}):(\d\d)\s*(am|pm)$/i);
    if (!date || !time) return; // Do not invent occurrences from recurring date ranges.
    const month = months.indexOf(date[1].toLowerCase()) + 1;
    if (!month || Number(date[2]) > 31) return;
    const year =
      Number(date[3] ?? now.getUTCFullYear()) +
      (date[3] ? 0 : now.getUTCMonth() >= 9 && month <= 2 ? 1 : 0);
    let hour = Number(time[1]) % 12;
    if (time[3].toLowerCase() === "pm") hour += 12;
    const url = new URL(anchor.attr("href")!, sourceUrl).href;
    if (!allowedHosts.has(new URL(url).hostname)) return;
    const parsed = EventSchema.safeParse({
      id: createHash("sha256")
        .update(`${url}:${year}:${month}:${date[2]}:${hour}`)
        .digest("hex")
        .slice(0, 24),
      title,
      date: calgaryDate(year, month, Number(date[2]), hour, Number(time[2])),
      location: fields[0],
      category: category(`${title} ${tile.find(".tile-summary").text()}`),
      note: "An organizer-listed community activity. Confirm registration, pricing and accessibility before attending.",
      url,
      dateSource: sourceUrl,
    });
    if (parsed.success) result.push(parsed.data);
  });
  // Also support organizer-provided schema.org Event feeds when available.
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const raw = JSON.parse($(el).text());
      const entries = Array.isArray(raw) ? raw : (raw["@graph"] ?? [raw]);
      for (const entry of entries) {
        if (entry["@type"] !== "Event" || !entry.startDate || !entry.url)
          continue;
        const url = new URL(entry.url, sourceUrl).href;
        if (!allowedHosts.has(new URL(url).hostname)) continue;
        const candidate = EventSchema.safeParse({
          id: createHash("sha256")
            .update(`${url}:${entry.startDate}`)
            .digest("hex")
            .slice(0, 24),
          title: entry.name,
          date: entry.startDate,
          location: entry.location?.name ?? "See organizer for location",
          category: category(entry.name ?? ""),
          note: "Organizer listing. Check current details and accessibility before going.",
          url,
          dateSource: sourceUrl,
        });
        if (candidate.success) result.push(candidate.data);
      }
    } catch {
      /* An invalid organizer block cannot replace a valid cached feed. */
    }
  });
  return [
    ...new Map(result.map((e) => [`${e.url}:${e.date}`, e])).values(),
  ].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
}
export class EventService {
  private cached: EventsResponse | null = null;
  private inFlight: Promise<EventsResponse> | null = null;
  private lastAttempt = 0;
  constructor(
    private config: Config,
    private fetcher: typeof fetch = fetch,
    private cachePath = ".cache/events.json",
  ) {}
  async get(refresh = false): Promise<EventsResponse> {
    if (!this.cached) {
      try {
        this.cached = EventsResponseSchema.parse(
          JSON.parse(await readFile(this.cachePath, "utf8")),
        );
      } catch {}
    }
    const fresh =
      this.cached?.fetchedAt &&
      Date.now() - Date.parse(this.cached.fetchedAt) < 15 * 60_000;
    if (fresh && !refresh)
      return { ...this.cached!, source: "cache", stale: false };
    if (this.inFlight) return this.inFlight;
    if (Date.now() - this.lastAttempt < 60_000)
      return fresh
        ? { ...this.cached!, source: "cache", stale: false }
        : this.fallback();
    this.lastAttempt = Date.now();
    this.inFlight = this.update().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }
  private fallback(): EventsResponse {
    return this.cached
      ? {
          ...this.cached,
          source: "cache",
          stale: true,
          warning:
            "Could not refresh organizer listings. Showing the last successful cache; verify with the organizer.",
        }
      : {
          events: seeds,
          fetchedAt: null,
          source: "seed",
          stale: true,
          warning:
            "Live listings are unavailable. Showing the original November 7, 2026 directory.",
        };
  }
  private async update(): Promise<EventsResponse> {
    try {
      const urls = this.config.EVENTS_FEED_URLS.split(",")
        .map((u) => u.trim())
        .filter(Boolean)
        .slice(0, 3);
      const all = await Promise.allSettled(
        urls.map(async (url) => {
          const parsed = new URL(url);
          if (
            parsed.protocol !== "https:" ||
            !allowedHosts.has(parsed.hostname)
          )
            throw new Error("Unsupported organizer host");
          const response = await this.fetcher(url, {
            signal: AbortSignal.timeout(10_000),
            redirect: "error",
            headers: { "user-agent": "StepIn/0.2 community-event-directory" },
          });
          if (
            !response.ok ||
            !response.headers.get("content-type")?.includes("text/html")
          )
            throw new Error("Invalid feed");
          const reader = response.body?.getReader();
          if (!reader) throw new Error("Empty feed");
          let bytes = 0;
          const chunks: Uint8Array[] = [];
          try {
            while (true) {
              const part = await reader.read();
              if (part.done) break;
              bytes += part.value.byteLength;
              if (bytes > 2_000_000) throw new Error("Feed too large");
              chunks.push(part.value);
            }
          } finally {
            await reader.cancel().catch(() => {});
          }
          return parseLibrary(Buffer.concat(chunks).toString("utf8"), url);
        }),
      );
      const events = all.flatMap((v) =>
        v.status === "fulfilled" ? v.value : [],
      );
      if (!events.length) return this.fallback();
      const result: EventsResponse = {
        events: [
          ...new Map(events.map((e) => [`${e.url}:${e.date}`, e])).values(),
        ].slice(0, 250),
        fetchedAt: new Date().toISOString(),
        source: "organizer",
        stale: false,
        warning: all.some((v) => v.status === "rejected")
          ? "Some organizers could not be refreshed."
          : null,
      };
      this.cached = result;
      await mkdir(
        this.cachePath.substring(0, this.cachePath.lastIndexOf("/")),
        { recursive: true },
      )
        .then(() => writeFile(this.cachePath, JSON.stringify(result)))
        .catch(() => {});
      return result;
    } catch {
      return this.fallback();
    }
  }
}
