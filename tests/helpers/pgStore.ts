import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import type { Store, RunContext } from "../../server/store";
import type {
  CloudSnapshot,
  CoachRequest,
  CoachResponse,
  SyncOperation,
} from "../../shared/contracts";
import { ApiError } from "../../server/errors";
export const USER_A = "00000000-0000-4000-8000-000000000001";
export const USER_B = "00000000-0000-4000-8000-000000000002";
export async function postgres() {
  const db = new PGlite();
  await db.exec(`create schema auth; create table auth.users(id uuid primary key);
    create role anon; create role authenticated; create role service_role bypassrls;
    grant usage on schema public,auth to anon,authenticated,service_role;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    insert into auth.users values('${USER_A}'),('${USER_B}');`);
  await db.exec(
    await readFile("database/migrations/001_accounts_sync.sql", "utf8"),
  );
  await db.exec(
    await readFile(
      "database/migrations/002_coaching_message_integrity.sql",
      "utf8",
    ),
  );
  return db;
}
export class PgStore implements Store {
  constructor(public db: PGlite) {}
  async call<T>(name: string, params: unknown[]): Promise<T> {
    const signatures: Record<string, string[]> = {
      stepin_snapshot: ["uuid"],
      stepin_sync: ["uuid", "bigint", "jsonb"],
      stepin_reserve_run: ["uuid", "jsonb", "text"],
      stepin_finish_run: ["uuid", "jsonb", "text", "jsonb"],
      stepin_fail_run: ["uuid", "text"],
      stepin_assert_profile: ["uuid", "text"],
    };
    try {
      const query = await this.db.query<{ data: T }>(
        `select public.${name}(${signatures[name].map((s, i) => `$${i + 1}::${s}`).join(",")}) as data`,
        params.map((v) => (typeof v === "object" ? JSON.stringify(v) : v)),
      );
      return query.rows[0].data;
    } catch (e) {
      const message = e instanceof Error ? e.message : "DB_ERROR";
      const code = [
        "REVISION_CONFLICT",
        "PROFILE_CONFLICT",
        "STALE_PROFILE",
        "SCREENING_REQUIRED",
        "NOT_FOUND",
        "REQUEST_IN_PROGRESS",
        "IDEMPOTENCY_CONFLICT",
        "IMMUTABLE_MESSAGE",
        "IMMUTABLE_PROFILE",
        "INVALID_PROFILE",
        "DELETED",
        "UNTRUSTED_ASSISTANT",
      ].find((c) => message.includes(c));
      if (code)
        throw new ApiError(
          code,
          code,
          code === "NOT_FOUND"
            ? 404
            : code === "SCREENING_REQUIRED"
              ? 403
              : 409,
        );
      throw e;
    }
  }
  async authenticate(token: string) {
    if (token === "test-user-a") return { id: USER_A };
    if (token === "test-user-b") return { id: USER_B };
    throw new ApiError("UNAUTHENTICATED", "Invalid test credential", 401);
  }
  snapshot(userId: string) {
    return this.call<CloudSnapshot>("stepin_snapshot", [userId]);
  }
  sync(userId: string, revision: number, ops: SyncOperation[]) {
    return this.call<CloudSnapshot>("stepin_sync", [userId, revision, ops]);
  }
  reserve(userId: string, request: CoachRequest, hash: string) {
    return this.call<RunContext>("stepin_reserve_run", [userId, request, hash]);
  }
  finish(
    userId: string,
    request: CoachRequest,
    hash: string,
    response: CoachResponse,
  ) {
    return this.call<void>("stepin_finish_run", [
      userId,
      request,
      hash,
      response,
    ]);
  }
  fail(userId: string, requestId: string) {
    return this.call<void>("stepin_fail_run", [userId, requestId]);
  }
  assertProfile(userId: string, profileId: string) {
    return this.call<void>("stepin_assert_profile", [userId, profileId]);
  }
  async deleteAccount(userId: string) {
    await this.db.query("delete from auth.users where id=$1", [userId]);
  }
}
