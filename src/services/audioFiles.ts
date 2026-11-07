import { File } from "expo-file-system";
export async function discardAudio(uri: string) {
  try {
    if (uri.startsWith("file://")) {
      const file = new File(uri);
      if (file.exists) file.delete();
    }
  } catch {
    /* Temporary app cache can also be reclaimed by the OS. */
  }
}
