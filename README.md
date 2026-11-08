# StepIn

A lightweight Expo mobile app for newcomers finding a comfortable way to join community activities. Four tabs provide **Speak, Chats, Calgary and Settings**. Version 0.2 adds a Fastify backend, Supabase accounts and optional sync, independently reviewed live guidance, in-app recording/transcription, and organizer event refreshes. Meta glasses mic/speaker (Bluetooth) and camera stills (Wearables DAT in a development build) are supported without a Meta Wearables Developer Center account when Meta AI Developer Mode is enabled.

## Meta glasses (development build)

Expo Go cannot load the Meta DAT native module. Use a custom build:

```sh
npm run prebuild
npm run run:android   # or npm run run:ios
```

1. Pair Ray-Ban / Meta glasses in the **Meta AI** app.
2. Enable **Developer Mode**: Meta AI → Settings → App Info → tap the version number five times.
3. In StepIn: **Register with Meta AI**, allow camera, start a camera session, capture a still, review, then send for Gemini scene context.
4. Mic and speaker use system Bluetooth (HFP/A2DP) with the existing recorder and Read aloud — no Meta developer project IDs required for local testing (`APPLICATION_ID` / `CLIENT_TOKEN` stay unset / `0`).

## Run locally

```sh
npm ci
npm run server
```

In a second terminal:

```sh
node scripts/run.cjs expo start --web --port 8091
```

Use `npm start` for the Expo Go QR code. The project uses Expo SDK 58.0.23, React Native 0.88.1 and React 19.3.0. Check that the presentation phone has a compatible Expo Go version. Commands use the installed project-local Node 22.22.0 runtime. Offline practice needs no account or provider keys.

## Configure your existing Supabase project

1. Open **SQL Editor** in your Supabase project. Run [001_accounts_sync.sql](database/migrations/001_accounts_sync.sql) once, then [002_coaching_message_integrity.sql](database/migrations/002_coaching_message_integrity.sql). The second migration also updates projects that received an earlier copy of 001. Do not rerun 001 against existing tables.
2. Copy `.env.example` to the ignored `.env`. Set `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` from the project's URL and public anon/publishable key.
3. Set server `SUPABASE_URL` and `SUPABASE_ANON_KEY` to those same values. Put the secret service-role/server key only in `SUPABASE_SERVICE_ROLE_KEY`. Never put secret keys in an `EXPO_PUBLIC_` variable.
4. Under **Authentication**, enable Email sign-in and configure confirmation/reset redirect URLs. For the local web preview allow `http://localhost:8091/auth/callback` and set `EXPO_PUBLIC_AUTH_REDIRECT_URL` accordingly. For a development or installed phone build, allow the exact callback URL for that build; the app defaults to Expo Linking's `/auth/callback`. Expo Go URLs depend on the current Metro address. Password recovery links should open the same browser/device that requested them for the PKCE flow.
5. Add `GEMINI_API_KEY` for both coaching agents and voice transcription. Restart the backend and Expo after changing environment values.
6. Run `npm run check:backend`. This checks Auth reachability and calls a read-only schema validator with the server key; it does not create an account or read private rows. Then use **Settings → Check server connection**.
7. Create/sign into a test account in the app. Confirm its email if required. Complete and confirm the quiz, explicitly enable account sync, and confirm remote AI processing. Select live guidance to make the first real suggestion/audit request.

Both agents default to `gemini-3.8-flash`: a suggestion agent drafts guidance and an independent audit agent reviews it in a separate call with its own instructions. Transcription also uses `gemini-3.8-flash`. `CONVERSATION_MODEL`, `AUDIT_MODEL` and `TRANSCRIPTION_MODEL` can be configured independently, and accept only Gemini IDs. A key being present is not evidence that a project has access to a model. Failed live calls show errors and do not silently substitute fixtures. A real fictional-context turn passed the full approval gate with seven checks after earlier provider availability failures. See [Google's model documentation](https://ai.google.dev/gemini-api/docs/models).

Run `npm run check:agents` for a complete live coordinator check using fictional room context and an in-memory screening fixture (normal Gemini usage charges apply). It checks the seven-check approval gate and allows at most one revision, without reading or writing accounts or chats. A successful turn uses two model calls, or four with revision. To list available text models, use `node scripts/run.cjs tsx scripts/check-agents.ts --list-models`. Invalid keys, unavailable models, access restrictions, quota limits and temporary Google outages produce distinct safe errors; the app never changes models automatically.

The Gemini-only hackathon rule supersedes the provider choices in the original development brief. The app has no OpenAI adapter or key requirement. Existing users must reconfirm **Allow live AI processing** in Settings for Google Gemini; earlier processing consent is not reused for the new provider.

**Physical phone networking:** `localhost` refers to the phone. For local testing set server `HOST=0.0.0.0`, use your computer's LAN address in `EXPO_PUBLIC_API_URL` or Settings, and use the same private network. Allow the development server through the firewall only on that network. Browser CORS origins must be listed explicitly in `CORS_ORIGINS`. Deployed builds require HTTPS.

## App flow

- Complete all 10 quiz questions, review the independently scored comfort/activity preferences, and confirm activation. Sensitive questions support **Prefer not to say**. A retake keeps the current version active until confirmation.
- Speak supports typed descriptions, three labeled fictional rooms, and a microphone panel. Choose offline practice or live guidance explicitly. Offline arbitrary descriptions ask for clarification rather than pretending to understand a room.
- In-app voice records up to 45 seconds into temporary device cache. Stop, preview, discard, or explicitly send to StepIn and Google for transcription. Review/edit the transcript before submitting a chat. Sign-in and a configured Gemini key are required for remote transcription. Supported browser dictation and keyboard dictation remain alternatives.
- Live requests use the current synced profile and owned conversation. Two stateless calls through Google's official `@google/genai` SDK use separate suggestion and audit prompts and JSON schemas. The auditor receives the exact candidate, profile and context. Rejected drafts get at most one revision and another review. Only completed, schema-validated responses can pass the server's approval gate; blocked or truncated output fails closed. Only approved guidance or a safe clarification reaches the app. Drafts and model thoughts never reach playback.
- **What was checked** distinguishes fixtures from live review and records profile version, configured model IDs, prompt versions, review outcome and timestamp. **Read aloud** is manual and uses approved visible text through Expo Speech. Voice input is bounded recording, not a streaming voice conversation.
- Chats can be searched, reopened, renamed, reflected on and deleted. Settings provides retakes, separate sensitive-answer/profile/chat removal, sync conflicts, account sign-out and account deletion.
- Calgary sorts upcoming listings from nearest to furthest date, with category filtering and optional past events. It refreshes while open, on foreground and on request.

## Storage, ownership and deletion

Native app data uses SQLite; web preview data uses localStorage. Writes are serialized. Native account tokens use Expo SecureStore; browser tokens use sessionStorage for the current tab. Local chat/profile storage has no StepIn encryption or app lock.

Signing in does not upload local profiles/chats. Sync requires a separate confirmation. Once enabled, queued changes persist through offline periods; pausing sync keeps later changes queued until resumed. Conflicts are visible. Server transactions enforce profile activation pointers, immutable messages, operation idempotency, deletion tombstones and history epochs. Ownership comes from a verified Supabase user token, never a client-supplied user ID. RLS restricts direct reads, direct client writes are revoked, and mutation RPCs are server-only.

With history off, new content is excluded from local and cloud database persistence. Live temporary conversations are held in bounded server memory for up to 15 minutes from creation and disappear on restart. Live model processing still occurs when explicitly requested. History-off does not delete older saved chats. Profile sync is still needed for mandatory screening.

Removing sensitive answers replaces questions 8 and 9 across stored profile versions and activates a redacted version. Deleting profiles restores the screening gate; old chat text and audit profile references remain until those chats are deleted. Destructive profile operations clear stale queued profile payloads. Cloud removals need a successful sync; another offline device can retain its cache until it reconnects. Sign-out clears this device's account cache and local auth session. Account deletion removes the Supabase Auth user and cascades its StepIn rows.

Audio is not stored in the StepIn database. The app attempts to remove temporary clips on discard, completed transcription, backgrounding, screen exit and account changes; a crash or failed file deletion can leave OS-managed cache. Uploads are capped at 4 MB; the app enforces 45 seconds and the server validates the reported duration. The server clears its upload buffer after processing. Google and hosting/database backups have their own retention policies; StepIn does not erase provider processing or historical backups. There is no automatic chat retention schedule yet.

## Event updates

The backend reads supported dated listings from Calgary Public Library's public organizer page and supported JSON-LD Event data on allowlisted organizer hosts. It skips unsupported ranges/online entries, uses Calgary's timezone, deduplicates refreshes and caches for 15 minutes. Failed refreshes retain the last good cache or bundled November 7 seed data, with stale/source status visible.

This directory covers supported organizer listings rather than all Calgary events. Open each organizer page to verify registration, price, accessibility and changes. No organizer partnership is implied.

## Backend and deployment

For the exact live-mode controls and hosted API/frontend setup, follow [DEPLOYMENT.md](DEPLOYMENT.md). A Render Blueprint is included in `render.yaml`; no hosted services have been created by this session.

`npm run server` (or its alias `npm run backend`) starts the API; `npm run server:watch` reloads during development. Run it as a persistent Node process with `npm ci` dependencies installed. The TypeScript runtime is included in development dependencies, so do not omit them for this launch command. Supply server secrets through the host's environment, set `NODE_ENV=production`, configure HTTPS through the host/reverse proxy, set `HOST`/`PORT`, and list your actual web origin in `CORS_ORIGINS`. Point Expo's public API URL at that HTTPS address before exporting. Never serve the workspace or its `.env` as a static directory.

Health is public at `GET /health`; events at `GET /api/events`. Authenticated routes cover sync, profiles/revisions/activation, paginated sessions/messages/audits, coaching/cancellation, transcription, glasses scene analysis (`POST /api/scene`), and account deletion. Fastify applies body limits, validation, explicit CORS and rate limits. Request bodies, tokens, audio and draft reasoning are not routinely logged.

The MVP is designed for one backend process: cancellation/session locks, transient chats and rate limits are process-local. A multi-instance deployment needs shared coordination and a shared event cache. Production provisioning, email deliverability, backup retention and host monitoring remain deployment work.

## Code map and checks

| Location                    | Responsibility                                                               |
| --------------------------- | ---------------------------------------------------------------------------- |
| `app`, `components`         | Tabs, screening, account controls, recorder and conversations                |
| `src/domain`, `src/demo`    | Deterministic preferences and labeled fixtures                               |
| `src/services`, `src/state` | Local persistence, account isolation, queued sync, audio and events          |
| `shared/contracts.ts`       | Validated request, response and sync contracts                               |
| `server`                    | Authenticated API, provider adapters, approval coordinator and event updates |
| `database/migrations`       | Supabase tables, RLS and transactional functions                             |
| `tests`                     | Domain, browser persistence, PostgreSQL, API, sync and event tests           |

```sh
npm run typecheck
npm test
node scripts/run.cjs expo install --check
node scripts/run.cjs expo export --platform all --output-dir dist-final
```

See [VERIFICATION.md](VERIFICATION.md) for performed checks and remaining live/device validation. The Meta native bridge and Gemini scene-analysis path are implemented; physical glasses capture and Bluetooth audio still require device validation.
