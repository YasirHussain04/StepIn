# StepIn

A social confidence coach for people who want to be more active outside — especially if communication feels hard (including neurodivergent newcomers). Runs in **Expo Go** on your phone.

**Flow:** AI quiz builds a style card → pick a Calgary event → photograph the scene → get live conversation coaching tailored to how you speak.

The previous Meta glasses build is preserved on the `meta-glasses-build` branch.

## Demo (Expo Go)

```sh
npm ci
npm run server
```

In a second terminal:

```sh
npm start
```

Scan the QR code with Expo Go. Point `EXPO_PUBLIC_API_URL` in `.env` at your computer’s LAN IP (not `localhost` on a physical phone), e.g. `http://192.168.1.10:3001`, with server `HOST=0.0.0.0`.

1. Open **Coach** → **Start the AI quiz** and chat until you confirm your style card.
2. Open **Calgary** → expand an event → **Coach me for this**.
3. Take a photo of the gathering (or skip) → **Analyze** / **Start coaching**.
4. Chat gets an auto first turn; continue with text or spoken coaching.

Live coaching uses Gemini on your StepIn server (`GEMINI_API_KEY`). Local device mode needs no Supabase account when `LOCAL_DEV_BYPASS=true`.

## Configure

Copy `.env.example` → `.env`. Minimum for a live demo:

- `EXPO_PUBLIC_API_URL` — phone-reachable API base
- `GEMINI_API_KEY`
- `HOST=0.0.0.0`, `PORT=3001`, `LOCAL_DEV_BYPASS=true`

Optional Supabase account sync is documented in prior versions; not required for the Expo Go demo path.

## Tabs

| Tab | Role |
| --- | --- |
| Coach | Quiz gate, event context, phone scene photo, start coaching |
| Chats | Saved / temporary coaching conversations |
| Calgary | Upcoming events + “Coach me for this” |
| Settings | Live AI consent, voice, history, account tools |

## Checks

```sh
npm run typecheck
npm test
npm run check:backend
```
