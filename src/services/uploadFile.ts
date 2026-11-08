import { File } from "expo-file-system";

/** Expo fetch needs a Blob/File with bytes(), not React Native's URI descriptor. */
export async function uploadFile(
  uri: string,
  signal: AbortSignal,
): Promise<Blob> {
  signal.throwIfAborted();
  const file = new File(uri);
  if (!file.exists)
    throw new Error(
      "The temporary file is no longer available. Capture it again.",
    );
  return file;
}
