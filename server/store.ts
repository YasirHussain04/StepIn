import { createClient, SupabaseClient } from "@supabase/supabase-js";
import {
  CloudSnapshot,
  CoachRequest,
  CoachResponse,
  SyncOperation,
} from "../shared/contracts";
import { Profile, Session } from "../src/domain/types";
import { Config } from "./config";
import { ApiError, unavailable } from "./errors";

export type RunContext = {
  profile: Profile;
  session: Session;
  cached?: CoachResponse;
};
export interface Store {
  authenticate(token: string): Promise<{ id: string }>;
  snapshot(userId: string): Promise<CloudSnapshot>;
  sync(
    userId: string,
    revision: number,
    ops: SyncOperation[],
  ): Promise<CloudSnapshot>;
  reserve(
    userId: string,
    request: CoachRequest,
    hash: string,
  ): Promise<RunContext>;
  finish(
    userId: string,
    request: CoachRequest,
    hash: string,
    response: CoachResponse,
  ): Promise<void>;
  fail(userId: string, requestId: string): Promise<void>;
  assertProfile(userId: string, profileId: string): Promise<void>;
  deleteAccount(userId: string): Promise<void>;
}
export class SupabaseStore implements Store {
  private admin: SupabaseClient | null;
  private auth: SupabaseClient | null;
  constructor(config: Config) {
    const options = {
      auth: { persistSession: false, autoRefreshToken: false },
    };
    this.admin =
      config.SUPABASE_URL && config.SUPABASE_SERVICE_ROLE_KEY
        ? createClient(
            config.SUPABASE_URL,
            config.SUPABASE_SERVICE_ROLE_KEY,
            options,
          )
        : null;
    this.auth =
      config.SUPABASE_URL && config.SUPABASE_ANON_KEY
        ? createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, options)
        : null;
  }
  async authenticate(token: string) {
    if (!this.auth) throw unavailable("Accounts");
    const { data, error } = await this.auth.auth.getUser(token);
    if (error || !data.user)
      throw new ApiError("UNAUTHENTICATED", "Sign in again to continue.", 401);
    return { id: data.user.id };
  }
  private async rpc<T>(
    name: string,
    params: Record<string, unknown>,
  ): Promise<T> {
    if (!this.admin) throw unavailable("Account storage");
    const { data, error } = await this.admin.rpc(name, params);
    if (error) {
      const codes = [
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
      ];
      const code = codes.find((c) => error.message.includes(c));
      if (code)
        throw new ApiError(
          code,
          code === "SCREENING_REQUIRED"
            ? "Complete and sync your confirmed profile before live coaching."
            : code === "NOT_FOUND"
              ? "This record does not exist in your account."
              : "Your account changed or this request conflicts with saved data. Sync and retry.",
          code === "NOT_FOUND"
            ? 404
            : code === "SCREENING_REQUIRED"
              ? 403
              : 409,
        );
      throw new ApiError(
        "DATABASE_UNAVAILABLE",
        "Account storage is unavailable. Your local data is preserved; retry sync.",
        503,
      );
    }
    return data as T;
  }
  snapshot(userId: string) {
    return this.rpc<CloudSnapshot>("stepin_snapshot", { p_user: userId });
  }
  sync(userId: string, revision: number, ops: SyncOperation[]) {
    return this.rpc<CloudSnapshot>("stepin_sync", {
      p_user: userId,
      p_revision: revision,
      p_ops: ops,
    });
  }
  async reserve(
    userId: string,
    request: CoachRequest,
    hash: string,
  ): Promise<RunContext> {
    return this.rpc<RunContext>("stepin_reserve_run", {
      p_user: userId,
      p_request: request,
      p_hash: hash,
    });
  }
  async finish(
    userId: string,
    request: CoachRequest,
    hash: string,
    response: CoachResponse,
  ) {
    await this.rpc("stepin_finish_run", {
      p_user: userId,
      p_request: request,
      p_hash: hash,
      p_response: response,
    });
  }
  async fail(userId: string, requestId: string) {
    await this.rpc("stepin_fail_run", {
      p_user: userId,
      p_request_id: requestId,
    });
  }
  async assertProfile(userId: string, profileId: string) {
    await this.rpc("stepin_assert_profile", {
      p_user: userId,
      p_profile: profileId,
    });
  }
  async deleteAccount(userId: string) {
    if (!this.admin) throw unavailable("Account deletion");
    const { error } = await this.admin.auth.admin.deleteUser(userId);
    if (error)
      throw new ApiError(
        "DELETE_FAILED",
        "Account deletion did not complete. Retry; your local data has not been cleared.",
        503,
      );
  }
}
