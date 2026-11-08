import {
  AudioModule,
  createAudioPlayer,
  setAudioModeAsync,
  type AudioPlayer,
} from "expo-audio";
import { File, Paths } from "expo-file-system";
import { discardAudio } from "./audioFiles";

const PLAY_RATE = 24_000;

function writeWavHeader(
  dataLength: number,
  sampleRate: number,
  channels = 1,
  bitsPerSample = 16,
) {
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const buffer = new ArrayBuffer(44);
  const view = new DataView(buffer);
  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++)
      view.setUint8(offset + i, value.charCodeAt(i));
  };
  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, "data");
  view.setUint32(40, dataLength, true);
  return new Uint8Array(buffer);
}

export async function prepareLiveAudioMode() {
  const permission = await AudioModule.requestRecordingPermissionsAsync();
  if (!permission.granted)
    throw new Error(
      "Microphone access is off. Enable it so glasses HFP can capture your voice.",
    );
  await setAudioModeAsync({
    allowsRecording: true,
    playsInSilentMode: true,
    shouldPlayInBackground: false,
    interruptionMode: "doNotMix",
    shouldRouteThroughEarpiece: false,
  });
}

export class LivePlaybackQueue {
  private queue: Uint8Array[] = [];
  private playing = false;
  private stopped = false;
  private player: AudioPlayer | null = null;
  private tempUris: string[] = [];

  enqueue(pcm: Uint8Array) {
    if (this.stopped || !pcm.byteLength) return;
    this.queue.push(pcm);
    void this.drain();
  }

  interrupt() {
    this.queue = [];
    try {
      this.player?.pause();
    } catch {
      /* ignore */
    }
    try {
      this.player?.remove();
    } catch {
      /* ignore */
    }
    this.player = null;
    this.playing = false;
  }

  async dispose() {
    this.stopped = true;
    this.interrupt();
    const uris = [...this.tempUris];
    this.tempUris = [];
    await Promise.all(uris.map((uri) => discardAudio(uri)));
  }

  private async drain() {
    if (this.playing || this.stopped) return;
    this.playing = true;
    while (this.queue.length && !this.stopped) {
      const chunk = this.queue.shift()!;
      try {
        await this.playChunk(chunk);
      } catch {
        /* keep draining remaining chunks */
      }
    }
    this.playing = false;
  }

  private async playChunk(pcm: Uint8Array) {
    const wav = new Uint8Array(44 + pcm.byteLength);
    wav.set(writeWavHeader(pcm.byteLength, PLAY_RATE), 0);
    wav.set(pcm, 44);
    const file = new File(Paths.cache, `stepin-live-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`);
    file.create({ overwrite: true });
    // Expo File.write accepts string | Uint8Array depending on platform bindings.
    await (file as { write: (data: Uint8Array) => Promise<void> }).write(wav);
    this.tempUris.push(file.uri);
    const player = createAudioPlayer({ uri: file.uri });
    this.player = player;
    player.play();
    await new Promise<void>((resolve) => {
      const started = Date.now();
      const expectedMs = Math.max(120, (pcm.byteLength / 2 / PLAY_RATE) * 1000);
      const timer = setInterval(() => {
        const done =
          player.currentTime > 0 &&
          player.duration > 0 &&
          player.currentTime >= player.duration - 0.05;
        const timedOut = Date.now() - started > expectedMs + 1500;
        if (done || timedOut || this.stopped || !this.player) {
          clearInterval(timer);
          resolve();
        }
      }, 40);
    });
    try {
      player.remove();
    } catch {
      /* ignore */
    }
    if (this.player === player) this.player = null;
  }
}
