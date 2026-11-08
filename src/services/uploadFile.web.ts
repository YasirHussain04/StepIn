export async function uploadFile(
  uri: string,
  signal: AbortSignal,
): Promise<Blob> {
  const response = await fetch(uri, { signal });
  if (!response.ok)
    throw new Error(
      "The temporary file is no longer available. Capture it again.",
    );
  return response.blob();
}
