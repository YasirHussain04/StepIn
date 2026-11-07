import React, { useState } from "react";
import { Switch, View } from "react-native";
import { Body, Button, C, Card, Icon, s, TextField } from "./ui";
import { Confirm } from "./Confirm";
import { useApp } from "../src/state/AppProvider";
import {
  authConfigured,
  authRedirectUrl,
  supabase,
} from "../src/services/auth";
import { api } from "../src/services/api";
import { hasGeminiConsent } from "../src/domain/types";
export function AccountCard() {
  const {
    state,
    setState,
    account,
    recovery,
    finishRecovery,
    enableSync,
    flushSync,
    syncStatus,
    syncError,
    resolveConflict,
    signOut,
    deleteAccount,
  } = useApp();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [signup, setSignup] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<
    "sync" | "signout" | "delete" | "cloud" | null
  >(null);
  async function perform(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "This account action could not finish. Retry.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function submit() {
    if (!supabase) return;
    const result = signup
      ? await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: authRedirectUrl() },
        })
      : await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
    if (result.error)
      throw new Error(
        "Could not complete sign-in or registration. Check your details, connection and email confirmation.",
      );
    setPassword("");
    setNotice(
      signup
        ? "Check your email to confirm the account, then sign in."
        : "You are signed in. Cloud sync is a separate choice.",
    );
  }
  function option(key: "processingConsent" | "shareProfile", value: boolean) {
    setState((prev) => ({
      ...prev,
      settings: {
        ...prev.settings,
        [key]: value,
        ...(key === "processingConsent"
          ? { processingProvider: "gemini" as const }
          : {}),
      },
    }));
  }
  return (
    <Card>
      <View style={s.row}>
        <Icon name="cloud-outline" />
        <Body style={{ fontWeight: "700", fontSize: 18 }}>
          Account & live features
        </Body>
      </View>
      {!authConfigured && (
        <Body muted>
          Account sign-in needs the Supabase connection configured in the app’s
          environment. Offline practice remains available. See the setup guide.
        </Body>
      )}
      {recovery ? (
        <>
          <Body>Choose a new password for your account.</Body>
          <TextField
            accessibilityLabel="New password"
            placeholder="New password (8+ characters)"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />
          <Button
            title="Save new password"
            busy={busy}
            disabled={password.length < 8}
            onPress={() =>
              void perform(async () => {
                const { error } = await supabase!.auth.updateUser({ password });
                if (error) throw error;
                setPassword("");
                finishRecovery();
                setNotice("Password updated.");
              })
            }
          />
        </>
      ) : account ? (
        <>
          <Body>Signed in as {account.user.email ?? "your account"}</Body>
          <Body style={s.small}>
            Native account tokens use secure device storage. Browser preview
            tokens stay in this tab’s session storage. Signing out clears this
            device’s account-specific profiles, drafts, chats and pending
            changes.
          </Body>
          <View style={s.between}>
            <Body style={{ flex: 1 }}>Sync profile & saved chats</Body>
            <Switch
              accessibilityLabel="Cloud sync"
              value={!!state.cloud?.enabled}
              onValueChange={(value) =>
                value
                  ? setConfirm("sync")
                  : setState((prev) => ({
                      ...prev,
                      settings: { ...prev.settings, mode: "demo" },
                      cloud: { ...prev.cloud!, enabled: false },
                    }))
              }
              trackColor={{ true: C.green }}
            />
          </View>
          <Body style={s.small}>
            {syncStatus} · {state.cloud?.queue.length ?? 0} pending operations
            {state.cloud?.enabled ? "" : " · sync paused"}
          </Body>
          {state.cloud?.enabled && (
            <Button
              secondary
              title="Sync now"
              busy={busy}
              icon="sync-outline"
              onPress={() => void perform(flushSync)}
            />
          )}
          {!!syncError && <Body style={{ color: C.danger }}>{syncError}</Body>}
          {state.cloud?.conflict && (
            <View
              style={{
                gap: 10,
                backgroundColor: C.peach,
                padding: 14,
                borderRadius: 12,
              }}
            >
              <Body style={{ fontWeight: "600" }}>
                Another version needs your choice
              </Body>
              <Body style={s.small}>
                Cloud profile: version{" "}
                {state.cloud.conflict.profiles.find(
                  (p) => p.id === state.cloud?.conflict?.activeProfileId,
                )?.revision ?? "none"}
                . This device: version{" "}
                {state.profiles.find((p) => p.id === state.activeProfileId)
                  ?.revision ?? "none"}
                . Cloud has {state.cloud.conflict.sessions.length} chats. Your
                pending changes remain local until you choose.
              </Body>
              <Button
                secondary
                title="Use cloud version"
                onPress={() => setConfirm("cloud")}
              />
              <Button
                title="Keep my pending changes & merge"
                busy={busy}
                onPress={() => void perform(() => resolveConflict("local"))}
              />
              <Body style={s.small}>
                Deleted cloud chats stay deleted. Keeping local profile changes
                explicitly activates your reviewed local version.
              </Body>
            </View>
          )}
          <View style={s.divider} />
          <View style={s.between}>
            <Body style={{ flex: 1 }}>Allow live AI processing</Body>
            <Switch
              accessibilityLabel="Allow live AI processing"
              value={hasGeminiConsent(state.settings)}
              onValueChange={(v) => option("processingConsent", v)}
              trackColor={{ true: C.green }}
            />
          </View>
          <Body style={s.small}>
            Live coaching sends your room description, request and recent
            conversation through StepIn’s backend to Google Gemini. With profile
            sharing enabled it also sends your current preferences. Provider
            processing/retention follows the configured API account terms.
            Advice is released only after the server’s independent check; that
            check can still be wrong.
          </Body>
          <View style={s.between}>
            <Body style={{ flex: 1 }}>Share preferences with AI</Body>
            <Switch
              accessibilityLabel="Share preferences with AI"
              value={state.settings.shareProfile !== false}
              onValueChange={(v) => option("shareProfile", v)}
              trackColor={{ true: C.green }}
            />
          </View>
          <Body style={s.small}>
            When off, agents receive generic context without quiz answers. Local
            playback exclusions and the server’s screening gate still apply.
          </Body>
          <Button
            title={
              state.settings.mode === "live"
                ? "Live mode selected"
                : "Use live guidance for new chats"
            }
            secondary={state.settings.mode !== "live"}
            disabled={
              !state.cloud?.enabled ||
              !hasGeminiConsent(state.settings) ||
              !!state.cloud?.conflict
            }
            onPress={() =>
              setState((prev) => ({
                ...prev,
                settings: { ...prev.settings, mode: "live" },
              }))
            }
          />
          <Button
            secondary
            title="Use offline demo for new chats"
            onPress={() =>
              setState((prev) => ({
                ...prev,
                settings: { ...prev.settings, mode: "demo" },
              }))
            }
          />
          <Button
            secondary
            title="Sign out & clear device cache"
            onPress={() => setConfirm("signout")}
          />
          <Button
            secondary
            title="Delete account & cloud data"
            onPress={() => setConfirm("delete")}
          />
        </>
      ) : (
        <>
          <Body muted>
            Sign in for live coaching, in-app transcription and optional account
            sync. No account is needed for offline practice.
          </Body>
          <TextField
            accessibilityLabel="Account email"
            placeholder="Email address"
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            value={email}
            onChangeText={setEmail}
          />
          <TextField
            accessibilityLabel="Account password"
            placeholder="Password (8+ characters)"
            secureTextEntry
            autoComplete={signup ? "new-password" : "current-password"}
            value={password}
            onChangeText={setPassword}
          />
          <Button
            title={signup ? "Create account" : "Sign in"}
            busy={busy}
            disabled={
              !authConfigured || !email.includes("@") || password.length < 8
            }
            onPress={() => void perform(submit)}
          />
          <Button
            secondary
            title={
              signup ? "I already have an account" : "Create a new account"
            }
            onPress={() => {
              setSignup((v) => !v);
              setError("");
            }}
          />
          <Button
            secondary
            title="Reset password by email"
            disabled={!authConfigured || !email.includes("@")}
            busy={busy}
            onPress={() =>
              void perform(async () => {
                const { error } = await supabase!.auth.resetPasswordForEmail(
                  email.trim(),
                  { redirectTo: authRedirectUrl() },
                );
                if (error) throw error;
                setNotice(
                  "If an account exists, a recovery link will arrive by email.",
                );
              })
            }
          />
        </>
      )}
      {!!notice && <Body accessibilityLiveRegion="polite">{notice}</Body>}
      {!!error && (
        <Body accessibilityLiveRegion="polite" style={{ color: C.danger }}>
          {error}
        </Body>
      )}
      <View style={s.divider} />
      <Body style={{ fontWeight: "600" }}>Backend connection</Body>
      <TextField
        accessibilityLabel="Backend URL"
        placeholder="https://your-stepin-api.example"
        autoCapitalize="none"
        autoCorrect={false}
        value={state.settings.apiUrl ?? process.env.EXPO_PUBLIC_API_URL ?? ""}
        onChangeText={(apiUrl) =>
          setState((prev) => ({
            ...prev,
            settings: { ...prev.settings, apiUrl },
          }))
        }
      />
      <Body style={s.small}>
        For a physical phone use your computer’s LAN address during development,
        then HTTPS when deployed. Credentials never go in this field.
      </Body>
      <Button
        secondary
        title="Check server connection"
        busy={busy}
        onPress={() =>
          void perform(async () => {
            const health = await api<{
              capabilities: {
                accounts: boolean;
                coaching: boolean;
                transcription: boolean;
              };
            }>("/health", { public: true, url: state.settings.apiUrl });
            setNotice(
              `Server reachable. Accounts ${health.capabilities.accounts ? "configured" : "need configuration"}; coaching ${health.capabilities.coaching ? "configured" : "needs API key"}; transcription ${health.capabilities.transcription ? "configured" : "needs API key"}. Provider access still requires a successful live request.`,
            );
          })
        }
      />
      <Confirm
        visible={!!confirm}
        title={
          confirm === "sync"
            ? "Enable account sync?"
            : confirm === "delete"
              ? "Delete this account?"
              : confirm === "cloud"
                ? "Use the cloud version?"
                : "Sign out?"
        }
        description={
          confirm === "sync"
            ? "Upload this device’s confirmed profile versions and saved chats, including support answers and audit records, to your authenticated StepIn account. Temporary history-off messages are excluded. You can pause sync at any time."
            : confirm === "delete"
              ? "Permanently delete your account and its StepIn database records, then clear this device’s account cache. Provider-held processing records and backups follow their own retention schedules."
              : confirm === "cloud"
                ? "Replace pending local profile and saved-chat changes with the current cloud version. Local temporary chats remain. Pending deletions will be discarded."
                : "Clear this device’s profiles, quiz drafts, chats and pending sync operations. Changes not yet synchronized will be lost. Saved cloud data remains."
        }
        confirm={
          confirm === "sync"
            ? "Enable sync"
            : confirm === "delete"
              ? "Delete account"
              : confirm === "cloud"
                ? "Use cloud version"
                : "Sign out"
        }
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const choice = confirm;
          setConfirm(null);
          void perform(() =>
            choice === "sync"
              ? enableSync()
              : choice === "delete"
                ? deleteAccount()
                : choice === "cloud"
                  ? resolveConflict("cloud")
                  : signOut(),
          );
        }}
      />
    </Card>
  );
}
