import { AudioQuality, IOSOutputFormat, type RecordingOptions } from "expo-audio";

/**
 * Gemini-friendly AAC/M4A recording. Prefer MPEG4AAC over LINEARPCM/.wav —
 * AVAudioRecorder AAC is reliable and Gemini accepts audio/m4a.
 */
export const TRANSCRIBE_WAV_PRESET: RecordingOptions = {
  extension: ".m4a",
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
    extension: ".m4a",
    outputFormat: IOSOutputFormat.MPEG4AAC,
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
  return { name: "voice.m4a", type: "audio/m4a" };
}
