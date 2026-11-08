/** Only start the mic if this hold is still active after native preparation. */
export async function prepareHeldRecording(options: {
  isHeld: () => boolean;
  isCurrent: () => boolean;
  stopSpeech: () => Promise<void>;
  configureAudio: () => Promise<void>;
  prepare: () => Promise<void>;
  onPrepared: () => void;
  record: () => void;
}): Promise<void> {
  const canStart = () => options.isCurrent() && options.isHeld();
  await options.stopSpeech();
  if (!canStart()) return;
  await options.configureAudio();
  if (!canStart()) return;
  await options.prepare();
  options.onPrepared();
  if (canStart()) options.record();
}
