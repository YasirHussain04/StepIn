import * as SQLite from "expo-sqlite";
import {
  AppState,
  INITIAL_STATE,
  Message,
  Profile,
  Session,
} from "../domain/types";

let database: Promise<SQLite.SQLiteDatabase> | undefined;
async function db() {
  if (!database)
    database = (async () => {
      const connection = await SQLite.openDatabaseAsync("stepin.db");
      await connection.execAsync(`PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS preferences(id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS profiles(id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, position INTEGER NOT NULL, body TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS messages_session ON messages(session_id, position);
      INSERT OR IGNORE INTO schema_migrations(version) VALUES(1);`);
      return connection;
    })().catch((error) => {
      database = undefined;
      throw error;
    });
  return database;
}
export async function loadState(): Promise<AppState> {
  const connection = await db();
  const pref = await connection.getFirstAsync<{ body: string }>(
    "SELECT body FROM preferences WHERE id=1",
  );
  if (!pref) return JSON.parse(JSON.stringify(INITIAL_STATE));
  const profiles = await connection.getAllAsync<{ body: string }>(
    "SELECT body FROM profiles",
  );
  const sessions = await connection.getAllAsync<{ id: string; body: string }>(
    "SELECT id, body FROM sessions",
  );
  const messages = await connection.getAllAsync<{
    session_id: string;
    body: string;
  }>("SELECT session_id, body FROM messages ORDER BY position");
  const metadata = JSON.parse(pref.body);
  return {
    ...INITIAL_STATE,
    ...metadata,
    profiles: profiles.map((p) => JSON.parse(p.body) as Profile),
    sessions: sessions.map(
      (s) =>
        ({
          ...JSON.parse(s.body),
          messages: messages
            .filter((m) => m.session_id === s.id)
            .map((m) => JSON.parse(m.body) as Message),
        }) as Session,
    ),
  };
}
export async function saveState(state: AppState): Promise<void> {
  const connection = await db();
  // A complete small local snapshot commits together; serialized by AppProvider.
  await connection.withTransactionAsync(async () => {
    await connection.runAsync("DELETE FROM messages");
    await connection.runAsync("DELETE FROM sessions");
    await connection.runAsync("DELETE FROM profiles");
    for (const profile of state.profiles)
      await connection.runAsync(
        "INSERT INTO profiles VALUES(?, ?)",
        profile.id,
        JSON.stringify(profile),
      );
    for (const session of state.sessions.filter((s) => s.persisted !== false)) {
      const { messages: allMessages, ...metadata } = session;
      const messages = allMessages.filter((m) => m.persisted !== false);
      await connection.runAsync(
        "INSERT INTO sessions VALUES(?, ?)",
        session.id,
        JSON.stringify(metadata),
      );
      for (let index = 0; index < messages.length; index++)
        await connection.runAsync(
          "INSERT INTO messages VALUES(?, ?, ?, ?)",
          messages[index].id,
          session.id,
          index,
          JSON.stringify(messages[index]),
        );
    }
    await connection.runAsync(
      "INSERT OR REPLACE INTO preferences VALUES(1, ?)",
      JSON.stringify({ ...state, profiles: undefined, sessions: undefined }),
    );
  });
}
