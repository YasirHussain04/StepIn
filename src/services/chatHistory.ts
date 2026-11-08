/** Local history does not depend on account sync; remote history does. */
export function chatHistoryPolicy(
  historyEnabled: boolean,
  sessionPersisted: boolean | undefined,
  cloudSync: boolean,
) {
  const localHistory = historyEnabled && sessionPersisted !== false;
  return { localHistory, serverHistory: cloudSync && localHistory };
}
