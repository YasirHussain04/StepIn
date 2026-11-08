import { AudioQuality, IOSOutputFormat, type RecordingOptions } from "expo-audio";

/**
 * Gemini-friendly recording: iOS Linear PCM WAV (best for inlineData),
 * Android AAC/M4A with correct extension for mime sniffing.
 */
export const TRANSCRIBE_WAV_PRESET: RecordingOptions = {
  extension: ".wav",
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 128000,
  android: {
    extension: ".m4a",
    outputFormat: "mpeg4",
    audioEncoder: "aac",
    sampleRate: 16000,
  },
  ios: {
    extension: ".wav",
    outputFormat: IOSOutputFormat.LINEARPCM,
    audioQuality: AudioQuality.HIGH,
    sampleRate: 16000,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: {
    mimeType: "audio/webm",
    bitsPerSecond: 64000,
  },
};

export function recordingUploadMeta(uri: string): {
  name: string;
  type: string;
} {
  const lower = uri.toLowerCase();
  if (lower.includes(".wav")) return { name: "voice.wav", type: "audio/wav" };
  if (lower.includes(".webm")) return { name: "voice.webm", type: "audio/webm" };
  if (lower.includes(".mp3")) return { name: "voice.mp3", type: "audio/mpeg" };
  return { name: "voice.m4a", type: "audio/mp4" };
}
