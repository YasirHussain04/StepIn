import { Platform } from "react-native";
import { isGlassesBuild } from "./glassesCapability";

/**
 * Mic and speaker use the OS Bluetooth route (HFP / A2DP), not the DAT SDK.
 * When Meta glasses are the active headset, expo-audio recording and Expo Speech
 * use them automatically. HFP (mic) forces mono voice-quality playback.
 */
export type AudioRouteHint = "glasses_likely" | "phone" | "unknown";

export function audioRouteHint(glassesConnected: boolean): AudioRouteHint {
  if (Platform.OS === "web") return "phone";
  if (!isGlassesBuild()) return "phone";
  if (glassesConnected) return "glasses_likely";
  return "unknown";
}

export function audioRouteLabel(hint: AudioRouteHint): string {
  switch (hint) {
    case "glasses_likely":
      return "Audio route: Glasses (Bluetooth). Recording uses the glasses mic; read-aloud uses the glasses speaker. While the mic is active, playback is call quality.";
    case "phone":
      return "Audio route: Phone. Connect Meta glasses as a Bluetooth headset to use their mic and speakers.";
    default:
      return "Audio route: Unknown. Keep glasses connected in Meta AI / system Bluetooth for mic and speaker.";
  }
}
