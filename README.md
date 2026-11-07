# StepIn

A lightweight mobile companion for newcomers practicing a first conversation. This is the **mobile-first, offline demonstration milestone** from the supplied development brief, with four tabs: **Speak, Chats, Calgary, Settings**.

## Run

```sh
npm ci
npm start
```

Scan Metro’s QR code with **Expo Go compatible with SDK 58**. Keep the phone and computer on the same network and permit Node/Metro through the local firewall when prompted. No backend or API keys are required. The presentation phone’s installed Expo Go version has not been inspected; verify SDK compatibility before the demo. See [Expo Go downloads](https://expo.dev/go).

For a browser preview, run `npm run web`. For a specific port on Windows PowerShell, use `node scripts/run.cjs expo start --web --port 8091` (some npm PowerShell wrappers consume forwarded flags).

Dependencies and the lockfile are pinned. Expo SDK 58.0.23 uses React Native 0.88.1 and React 19.3.0. A project-local Node 22.22.0 runtime is installed as a development dependency; the command launcher uses it without changing the system runtime. With an existing supported Node installation, the local runtime is optional. Expo’s required Node range begins at 22.13.0 for Node 22.

## Try the app

1. In Speak, choose **Get to know me**. All 10 questions need valid answers; questions 8 and 9 accept **Prefer not to say**. Closing and reopening resumes the draft.
2. Review and explicitly confirm the profile. Comfort and desired activity are scored separately. This is personalization, not a clinical assessment.
3. Choose one of three **fictional demo rooms**, then **Help me get started**. The game-night fixture demonstrates a revision and second rule check. No rejected draft is displayed or spoken.
4. Open **What was checked** to inspect fixture provenance, profile version, decisions and template versions. Try **Another idea**, **Make it simpler**, **Encourage me**, or a message asking to take a break.
5. Use **Read aloud** and **Stop playback**. Leaving the screen or backgrounding the app stops speech; microphone input is never required.
6. Reopen, rename and search saved conversations in Chats. Delete a chat from its conversation. Settings provides separate all-chat, profile and sensitive-answer removal controls.
7. Browse Calgary’s sourced listings, filter by category, and open organizer pages. Dates sort from soonest to furthest; past listings are hidden unless requested.
8. Retake the quiz in Settings. The existing profile remains active until the new revision is reviewed and confirmed. New turns in old chats reference the latest profile; prior responses retain their original version marker.

## Voice input

**iOS/Android in Expo Go:** tap the Speak microphone to focus the text field, then use the microphone on the platform keyboard. StepIn does not implement an embedded native speech recognizer. Dictation availability depends on keyboard, device settings and language; typing is always available.

**Supported web browsers:** explicit **Start voice input** uses the browser’s speech recognition API after an explanation. Review or edit the transcript before submitting. There is no automatic submission. Browser recognition can send audio to its provider and may require internet access; it is [not universally supported](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition). Stop input or leave the tab to cancel it. StepIn receives text and does not retain raw audio.

These paths are not a streaming voice assistant. In-app native recording/transcription and the selected Realtime model transport remain future work. Manual playback uses [Expo Speech](https://docs.expo.dev/versions/latest/sdk/speech/) on already approved fixture text. Audio routing and actual speech input/output have not been tested on a physical phone.

## Data and privacy

Native builds use `expo-sqlite`: a versioned initialization migration, profile records, preferences/quiz draft, sessions and ordered messages. Snapshot writes are serialized and transactional. The browser preview uses localStorage behind the same repository interface, so it does not require SQLite’s web worker or cross-origin headers. Native SQLite migrations are in `src/services/repository.ts`; no Supabase migrations exist yet.

History is on by default. When off, new sessions and new messages in existing sessions are marked transient and excluded from persistence. Existing saved history stays until explicitly deleted. Re-enabling history does not save earlier transient content. Profiles and quiz drafts remain local so required screening can resume. Storage failures are visible and retryable; failed reads do not silently overwrite the previous database.

Profile deletion removes every profile version and draft and restores the screening gate. Historical messages retain a non-sensitive “profile removed” reference. Sensitive-answer removal replaces questions 8 and 9 with non-disclosure in all versions, clears their draft answers, and activates a new version. Historical messages and user-authored chat text are separate from profile answers and remain until the relevant chats are deleted.

No app lock or database encryption is provided. No StepIn cloud service, account sync, analytics, model API calls, image capture, or raw audio storage is enabled. Keyboard/browser speech services have their own processing and retention. Provider keys must never be added to mobile code or `EXPO_PUBLIC_` variables.

## Calgary event sources

Listings were manually checked on **November 7, 2026**, using [Calgary Public Library’s featured program calendar](https://www.calgarylibrary.ca/), its [event calendar](https://www.calgarylibrary.ca/events-and-programs/events), individual linked program pages and the [Library Foundation’s Locked Library page](https://libraryfoundation.ca/event/locked-library-nov-20/). Each record includes a detail URL and a separate source for its listed date/time. Locked Library uses the Foundation detail page’s 7 pm time; the library overview lists a different time, so confirm with the organizer.

This is a small cached directory, not all Calgary events and not live discovery. Open the organizer page to verify dates, registration, price and accessibility. All times use Calgary’s `America/Edmonton` zone. StepIn is not affiliated with these organizations. Fictional coaching rooms are separate from these real listings.

## Code map

| Location                   | Responsibility                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------- |
| `app/(tabs)`               | Speak, searchable Chats, chronological Calgary listings and Settings                  |
| `app/quiz.tsx`             | Draft/resume, 10 answers, review and explicit activation                              |
| `app/chat/[id].tsx`        | Scripted coaching, cancellation/retry, audit inspection and playback                  |
| `src/domain`               | Shared types, validation, deterministic scores and exclusions                         |
| `src/demo`                 | Three clearly labeled fictional rooms                                                 |
| `src/services/coach.ts`    | Deterministic suggestion and separate rule-check fixtures                             |
| `src/services/playback.ts` | Approval and audio preference gate                                                    |
| `src/services/repository*` | SQLite native and localStorage browser repositories                                   |
| `src/state`                | Hydration and serialized persistence                                                  |
| `tests`                    | Required screening, fixtures, playback guards, event ordering and browser persistence |

## Checks and next milestones

```sh
npm run typecheck
npm test
node scripts/run.cjs expo install --check
npm run export:web
node scripts/run.cjs expo export --platform android --output-dir dist-native
```

See `VERIFICATION.md` for performed checks and physical-device limitations. This build is not the completed app-only or glasses product from the full brief. Outstanding work includes Fastify/Zod contracts; authenticated Supabase storage and sync; server-side ownership, idempotency and conflict handling; the real Realtime suggestion and Responses audit adapters with fail-closed coordination; Gemini scene analysis; and a native Meta adapter/custom build tested against real glasses. There are no placeholder controls claiming those integrations work.

Offline custom descriptions and arbitrary follow-ups receive clarification rather than invented analysis. Fixture rules are demonstrations, not evidence that an AI auditor ran. The mobile code has no LangChain/LangGraph, phone camera, image-picker, provider SDK or credential dependency.
