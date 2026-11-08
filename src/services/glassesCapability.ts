import { Platform } from "react-native";
import Constants from "expo-constants";

/** True only in a custom development / standalone build — never Expo Go or web. */
export function isGlassesBuild(): boolean {
  if (Platform.OS === "web") return false;
  const env = Constants.executionEnvironment;
  return env === "bare" || env === "standalone";
}

export function glassesUnavailableReason(): string {
  if (Platform.OS === "web")
    return "Meta glasses need the phone app in a custom development build, not the web preview.";
  if (Constants.executionEnvironment === "storeClient")
    return "Expo Go cannot access Meta glasses. Install a StepIn development build, enable Developer Mode in the Meta AI app, and register this app there. No Meta Wearables Developer Center account is required for local testing.";
  return "Meta glasses native support is unavailable on this install.";
}
