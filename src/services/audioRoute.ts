import { Platform } from "react-native";

export type AudioRouteHint = "phone" | "unknown";

export function audioRouteHint(_connected = false): AudioRouteHint {
  if (Platform.OS === "web") return "phone";
  return "phone";
}

export function audioRouteLabel(hint: AudioRouteHint): string {
  switch (hint) {
    case "phone":
      return "Audio route: Phone mic and speaker.";
    default:
      return "Audio route: Phone.";
  }
}
