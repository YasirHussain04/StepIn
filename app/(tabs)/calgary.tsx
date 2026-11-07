import React, { useState } from "react";
import {
  Linking,
  Pressable,
  ScrollView,
  Switch,
  Text,
  View,
} from "react-native";
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
  TextField,
  Title,
} from "../../components/ui";
import { eventFormat, sortedEvents } from "../../src/data/events";
import { useEvents } from "../../src/services/useEvents";
export default function Calgary() {
  const feed = useEvents();
  const [category, setCategory] = useState("All");
  const [query, setQuery] = useState("");
  const [past, setPast] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState("");
  const filtered = sortedEvents(feed.events, Date.now(), past).filter(
    (e) =>
      (category === "All" || category === e.category) &&
      `${e.title} ${e.location} ${e.note}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  async function open(url: string) {
    try {
      await Linking.openURL(url);
    } catch {
      setError(
        "Could not open the organizer’s page. Check your connection and try again.",
      );
    }
  }
  return (
    <Page>
      <View style={{ gap: 12 }}>
        <Label>Find your people, Calgary</Label>
        <Title>Something to{"\n"}look forward to.</Title>
        <Body muted>
          Discover a reason to step out. Start with a place or activity that
          feels like you.
        </Body>
      </View>
      <View style={{ gap: 10 }}>
        <Button
          secondary
          title={
            feed.loading ? "Refreshing events…" : "Refresh organizer listings"
          }
          icon="refresh-outline"
          busy={feed.loading}
          onPress={() => void feed.refresh(true)}
        />
        <Body style={s.small}>
          {feed.fetchedAt
            ? `Last successful refresh: ${new Date(feed.fetchedAt).toLocaleString()} · ${feed.stale ? "cached / may be outdated" : "organizer listings"}`
            : "Original directory · November 7, 2026"}
        </Body>
        {!!feed.warning && (
          <Body accessibilityLiveRegion="polite" style={s.small}>
            {feed.warning}
          </Body>
        )}
      </View>
      <TextField
        accessibilityLabel="Search Calgary events"
        placeholder="Search events or places"
        value={query}
        onChangeText={setQuery}
      />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8 }}
      >
        {["All", "Community", "Meetups", "Arts", "Outdoors", "Games"].map(
          (cat) => (
            <Pressable
              key={cat}
              accessibilityRole="button"
              accessibilityState={{ selected: cat === category }}
              onPress={() => setCategory(cat)}
              style={{
                paddingHorizontal: 17,
                minHeight: 44,
                justifyContent: "center",
                borderRadius: 22,
                backgroundColor: cat === category ? C.green : "#fff",
                borderWidth: 1,
                borderColor: cat === category ? C.green : C.line,
              }}
            >
              <Text
                style={{
                  color: cat === category ? "#fff" : C.ink,
                  fontSize: 13,
                }}
              >
                {cat}
              </Text>
            </Pressable>
          ),
        )}
      </ScrollView>
      <View style={s.between}>
        <View style={s.row}>
          <Icon name="swap-vertical-outline" size={16} />
          <Body style={s.small}>Soonest first · Calgary time</Body>
        </View>
        <Text style={s.small}>{filtered.length} events</Text>
      </View>
      {!!error && <Body style={{ color: C.danger }}>{error}</Body>}
      {filtered.length === 0 && (
        <Card>
          <Icon name="calendar-clear-outline" size={34} />
          <Title small>No events here yet.</Title>
          <Body muted>
            Try another category, clear your search, or browse the organizer’s
            current calendar.
          </Body>
          <Button
            secondary
            title="View library calendar"
            icon="open-outline"
            onPress={() =>
              open("https://www.calgarylibrary.ca/events-and-programs/events")
            }
          />
        </Card>
      )}
      {filtered.map((event) => (
        <Card key={event.id}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Details for ${event.title}`}
            accessibilityState={{ expanded: expanded === event.id }}
            onPress={() => setExpanded(expanded === event.id ? null : event.id)}
            style={[s.row, { alignItems: "flex-start", gap: 15 }]}
          >
            <View
              style={{
                width: 54,
                minHeight: 66,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 13,
                backgroundColor: C.sage,
                gap: 2,
              }}
            >
              <Text
                style={{
                  fontSize: 10,
                  fontWeight: "700",
                  color: C.green,
                  textTransform: "uppercase",
                }}
              >
                {eventFormat(event.date, { month: "short" })}
              </Text>
              <Text style={{ color: C.ink, fontSize: 26, fontWeight: "600" }}>
                {eventFormat(event.date, { day: "numeric" })}
              </Text>
            </View>
            <View style={{ flex: 1, gap: 7 }}>
              <Badge warm>{event.category.toUpperCase()}</Badge>
              <Text
                style={{
                  fontSize: 18,
                  lineHeight: 24,
                  color: C.ink,
                  fontWeight: "600",
                }}
              >
                {event.title}
              </Text>
              <Text style={s.small}>
                {eventFormat(event.date, {
                  weekday: "short",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </Text>
            </View>
            <Icon
              name={expanded === event.id ? "chevron-up" : "chevron-down"}
              size={17}
            />
          </Pressable>
          <View style={s.divider} />
          <View style={s.row}>
            <Icon name="location-outline" size={16} />
            <Body style={{ fontSize: 12, flex: 1 }}>{event.location}</Body>
          </View>
          {expanded === event.id && (
            <>
              <Body muted>{event.note}</Body>
              <Body style={s.small}>
                {feed.fetchedAt
                  ? `Organizer feed checked ${new Date(feed.fetchedAt).toLocaleDateString()}. `
                  : "Original listing checked November 7, 2026. "}
                Confirm registration, pricing and accessibility with the
                organizer before going.
              </Body>
              <Button
                secondary
                title="Details & registration"
                icon="open-outline"
                onPress={() => open(event.url)}
              />
              <Pressable
                accessibilityRole="link"
                onPress={() => open(event.dateSource)}
                style={{ minHeight: 44, justifyContent: "center" }}
              >
                <Text
                  style={[
                    s.small,
                    { color: C.green, textDecorationLine: "underline" },
                  ]}
                >
                  Source for listed date and time
                </Text>
              </Pressable>
            </>
          )}
        </Card>
      ))}
      <View style={s.between}>
        <Body muted style={{ flex: 1 }}>
          Include past listings
        </Body>
        <Switch
          accessibilityLabel="Include past events"
          value={past}
          onValueChange={setPast}
          trackColor={{ true: C.green }}
        />
      </View>
      <Card style={{ backgroundColor: C.sage }}>
        <View style={s.row}>
          <Icon name="information-circle-outline" />
          <Body style={{ fontWeight: "600" }}>
            A starting point, not the whole city.
          </Body>
        </View>
        <Body style={s.small}>
          This directory refreshes from organizer pages through StepIn’s backend
          and caches the last successful result for offline use. Date ranges
          without individual sessions are omitted rather than guessing dates. It
          does not cover every Calgary event. StepIn is not affiliated with the
          organizers.
        </Body>
        <Button
          secondary
          title="Browse more library events"
          icon="open-outline"
          onPress={() =>
            open("https://www.calgarylibrary.ca/events-and-programs/events")
          }
        />
      </Card>
    </Page>
  );
}
