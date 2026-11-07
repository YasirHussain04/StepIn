# StepIn verification

Date: November 7, 2026. Scope: app-only backend/accounts/voice/event milestone, version 0.2.0. Meta integration remains outside this milestone.

## Automated verification

- **85 tests passed across five files.** TypeScript check passed.
- PostgreSQL tests execute both checked-in Supabase migrations using PGlite (real PostgreSQL in WASM), with a minimal test Auth schema and simulated user identities. This validates SQL/RLS behavior, not a deployed Supabase project or real JWT verification service.
- Coverage includes required screening and scoring, profile activation concurrency, immutable records, operation idempotency, cross-user isolation, direct-write/RPC denial, history deletion epochs and tombstones, sensitive-answer redaction, account cache isolation and sync merge/conflict behavior.
- Fastify tests exercise authenticated routes with the test Store, approved/revised guidance, independent audit rejection, malformed/incomplete outputs, stage timeout, stale-profile suppression, duplicate request handling, reused message IDs, temporary history, audio consent/duration checks and upload-buffer clearing. AI providers are controlled fakes in these tests.
- Gemini adapter tests exercise the official SDK with a mocked HTTP transport: separate role instructions and schemas, exact-candidate audit input, revision feedback, Gemini-only model configuration, cancellation, missing keys and rejection of blocked/truncated/malformed/non-text output. Earlier provider consent cannot authorize the Gemini destination. These tests make no paid AI calls.
- Event tests verify supported organizer HTML, omission of date ranges/untrusted hosts, category boundaries, Calgary summer/winter offsets, concurrent refresh deduplication and last-good-cache fallback.
- Existing domain/persistence tests cover quiz draft/resume, independent scores, exclusions, fixture revision/provenance, playback guards, browser persistence, transient content and deletion.
- Expo dependency compatibility check passed.
- Combined production web, Android and iOS bundle export passed. Native Hermes bundles are approximately **4.2 MB each**, plus assets. These are compilation/export checks, not APK/IPA builds or device runs.
- Current network-enabled npm audit reports **five moderate**, zero high and zero critical advisories in Expo CLI/fingerprint glob/minimatch tooling. The suggested fix downgrades Expo across SDK versions and was not applied.

## Real local API and browser checks

- Started the real Fastify server and reached its health endpoint. Missing credentials are reported as missing capabilities; startup does not claim provider access.
- A real organizer refresh returned **12** supported listings from Calgary Public Library, with organizer provenance and a successful timestamp. The app displayed **10 upcoming** listings after hiding past dates, ordered nearest first.
- In the browser, verified Settings can reach the backend and accurately reports missing account/model configuration.
- Checked Speak's voice panel: recording and browser dictation controls are separate, remote processing is explained and submission stays manual. No microphone permission was accepted and no actual recording was captured during this verification.
- Opened a fictional game-night chat, completed its fixture suggestion/review, inspected the two-check provenance with “Models: none (local fixtures),” and reloaded/reopened the saved conversation successfully.
- Inspected conversation layout at **390 × 844** and the updated tabs/account/event states. No browser warning/error entries were returned in the inspected console sample.
- Earlier baseline walkthrough also completed and resumed the full quiz, preserved the active profile during retake, searched chat content, exercised a simpler follow-up and checked event filtering.

## Configuration still needed

The local ignored `.env` was created from the template and its AI model settings migrated to Gemini. Other connection values were preserved. The user is configuring the existing project. Run `npm run check:backend` after applying both migrations and adding values. Its schema check is read-only; it is not a full sign-in/sync or model smoke test.

Real Supabase email registration, confirmation, password recovery, JWT verification, account sync, multi-device conflicts and account deletion have **not** been exercised against the user's hosted project. Both coaching roles now use Gemini; the earlier provider adapter and dependency have been removed.

The real Gemini model-list request succeeded using the configured local key. Generation with `gemini-flash-latest` returned HTTP 404. The listed explicit `gemini-3.8-flash` returned HTTP 503 on two attempts, so live suggestion/audit completion is **not verified**. A diagnostic request with listed `gemini-2.5-flash` also returned HTTP 404. Defaults and the local alias configuration are pinned to `gemini-3.8-flash`, with no runtime fallback. Only fictional context was sent; no account profiles or chat history were used. Audio transcription has not been exercised. Retry `npm run check:agents` when Google generation is available.

Before a live demo, create a disposable test account through the app and verify: email redirect/recovery; explicit sync consent; initial profile upload; one live audited turn; retry; profile retake on another device; conflict choices; deletion propagation; sign-out cache clearing; history-off behavior; and account deletion.

## Device and deployment checks remaining

No physical Android/iOS phone was available. Verify Expo Go SDK compatibility, microphone permission denial/grant, actual 45-second recording/preview/transcription, transcript edits, interruption/background cleanup, SQLite persistence/deletions, SecureStore recovery, manual TTS and Bluetooth routing, keyboard avoidance, safe areas, large fonts and VoiceOver/TalkBack on the presentation phone.

The backend has not been deployed. Production HTTPS, CORS, email delivery, hosting secrets, monitoring and backup retention need configuration. Cancellation/session locks, rate limits, temporary conversations and the event cache currently assume one server process.

No Meta glasses discovery, native bridge, camera sweep, scene analysis or verified glasses audio routing is implemented. The app does not import a phone camera or image-picker fallback.
