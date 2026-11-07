export async function discardAudio(uri: string) {
  if (uri.startsWith("blob:")) URL.revokeObjectURL(uri);
}
