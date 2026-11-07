// Manually checked against organizer pages on 2026-11-07. Not a live or exhaustive feed.
export type CalgaryEvent = {
  id: string;
  title: string;
  date: string;
  location: string;
  category: "Community" | "Meetups" | "Arts" | "Outdoors" | "Games";
  note: string;
  url: string;
  dateSource: string;
};
const library = "https://www.calgarylibrary.ca/events-and-programs/programs/";
export const events: CalgaryEvent[] = [
  {
    id: "library-future",
    title: "Celebrate the Future of Your Library",
    date: "2026-11-07T13:00:00-07:00",
    location: "All Calgary library locations",
    category: "Community",
    note: "Music, activities and a chance to meet your library community.",
    url: `${library}lets-celebrate-the-future-of-your-library`,
    dateSource: "https://www.calgarylibrary.ca/events-and-programs/events",
  },
  {
    id: "networking",
    title: "Networking for Refugees & Newcomers",
    date: "2026-11-12T18:00:00-07:00",
    location: "Central Library",
    category: "Meetups",
    note: "Explore ways to build professional connections in Canada.",
    url: `${library}networking-strategies-for-refugees-and-newcomers`,
    dateSource: "https://www.calgarylibrary.ca/",
  },
  {
    id: "diy-music",
    title: "DIY Instruments Workshop",
    date: "2026-11-14T13:00:00-07:00",
    location: "Memorial Park Library",
    category: "Arts",
    note: "Experiment with recycled materials and electronic sound. Ages 12+.",
    url: `${library}musical-artist-in-residence-electrifying-and-capturing-diy-instruments`,
    dateSource: "https://www.calgarylibrary.ca/",
  },
  {
    id: "walk",
    title: "Calgary’s Best Walks",
    date: "2026-11-16T10:00:00-07:00",
    location: "Nose Hill Library",
    category: "Outdoors",
    note: "A guided city walk of 6–7 km, including hills. Confirm route access with the organizer.",
    url: `${library}calgarys-best-walks`,
    dateSource: "https://www.calgarylibrary.ca/",
  },
  {
    id: "locked-library",
    title: "Locked Library: High Score",
    date: "2026-11-20T19:00:00-07:00",
    location: "Central Library",
    category: "Games",
    note: "A team puzzle adventure. Ticketed fundraiser; check current availability.",
    url: "https://libraryfoundation.ca/event/locked-library-nov-20/",
    dateSource: "https://libraryfoundation.ca/event/locked-library-nov-20/",
  },
  {
    id: "heritage",
    title: "Hindu Heritage Month at the Library",
    date: "2026-11-21T12:00:00-07:00",
    location: "Central Library",
    category: "Arts",
    note: "Community celebrations with art, music and dance.",
    url: `${library}hindu-heritage-month-at-the-library`,
    dateSource: "https://www.calgarylibrary.ca/events-and-programs/events",
  },
];
export function sortedEvents(
  list: CalgaryEvent[],
  now = Date.now(),
  includePast = false,
) {
  return list
    .filter((e) => includePast || new Date(e.date).getTime() >= now)
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
}
// These curated ISO values already carry the organizer's Calgary wall time and
// UTC offset. Preserve that wall time even when the viewer's device/browser
// overrides its Intl timezone. Sorting still uses the absolute timestamp above.
export function eventFormat(date: string, options: Intl.DateTimeFormatOptions) {
  const [calendar, clock] = date.split("T");
  const [year, month, day] = calendar.split("-").map(Number);
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  if (options.month) return months[month - 1];
  if (options.day) return String(day);
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][
    new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  ];
  const hour = Number(clock.slice(0, 2));
  return `${weekday} ${hour % 12 || 12}:${clock.slice(3, 5)} ${hour >= 12 ? "p.m." : "a.m."}`;
}
