# Run and share a live StepIn demo

Live guidance and public hosting are separate. You can use real Gemini coaching at localhost before deploying anything. Deploying does not switch an existing offline chat to live mode.

## Enable live coaching locally

1. Start the backend and app. In Settings, sign in and confirm the quiz profile.
2. Enable **Sync profile & saved chats**, confirm the upload, and press **Sync now**. Resolve any conflict. Wait for **Up to date · 0 pending operations**.
3. Enable **Allow live AI processing** after reading the Google Gemini explanation. Choose whether to share your preferences with the models.
4. Press **Use live guidance for new chats**, return to Speak, and start a new description. Its badge should say **LIVE GUIDANCE**.
5. For an existing chat, press **Switch this chat to live guidance**, then send another request. Changing the default in Settings does not change that chat's saved mode or replace earlier fixture messages.

`npm run check:agents` exercises the actual coordinator with fictional context, an in-memory screening fixture, and real Gemini calls. It verifies all seven audit checks, revision limits and the final approval gate without reading or writing Supabase rows. It does not test account authentication or persistence. Normal Gemini API usage charges apply. A failed call produces an error; the app never silently releases offline fixtures as live output.

## Publish the backend and web app on Render

The repository includes `render.yaml` for a Node API and a static Expo web app. The existing Supabase project remains your database and authentication service. No database migrations need to change for hosting.

Push your reviewed changes to GitHub, including the new backend files and deployment configuration. The local `.env` is ignored and must stay out of Git. The manual steps below create the API first, so its URL is available when building the frontend.

### 1. Create a Web Service for the API

In Render, create a **Web Service** from your StepIn GitHub repository. Use the repository root containing `package.json`.

| Field             | Value                  |
| ----------------- | ---------------------- |
| Runtime           | Node                   |
| Build command     | `npm ci --include=dev` |
| Start command     | `npm run backend`      |
| Health check path | `/health`              |

Set these environment variables in that service:

```env
NODE_VERSION=22.22.0
NODE_ENV=production
HOST=0.0.0.0
SUPABASE_URL=YOUR_EXISTING_SUPABASE_PROJECT_URL
SUPABASE_ANON_KEY=YOUR_SUPABASE_PUBLISHABLE_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_SUPABASE_SECRET_KEY
GEMINI_API_KEY=YOUR_GEMINI_KEY
CONVERSATION_MODEL=gemini-3.8-flash
AUDIT_MODEL=gemini-3.8-flash
TRANSCRIPTION_MODEL=gemini-3.8-flash
CORS_ORIGINS=http://localhost:8091
```

Let Render supply `PORT`. The backend must bind to `0.0.0.0`. Include development dependencies because this launch command uses `tsx`. Do not paste the whole local `.env` into the frontend service.

After deployment, copy the actual HTTPS API URL assigned by Render and open its `/health` endpoint. The capability flags indicate configured credentials, not verified model access. At this stage the explicit localhost CORS origin allows your local web preview; add the hosted frontend origin in step 3.

### 2. Create a Static Site for the Expo app

Create a **Static Site** from the same repository:

| Field             | Value                                        |
| ----------------- | -------------------------------------------- |
| Build command     | `npm ci --include=dev && npm run export:web` |
| Publish directory | `dist`                                       |

Set these build-time variables:

```env
NODE_VERSION=22.22.0
EXPO_PUBLIC_API_URL=https://YOUR-ACTUAL-API-HOST
EXPO_PUBLIC_SUPABASE_URL=YOUR_EXISTING_SUPABASE_PROJECT_URL
EXPO_PUBLIC_SUPABASE_ANON_KEY=YOUR_SUPABASE_PUBLISHABLE_KEY
EXPO_PUBLIC_AUTH_REDIRECT_URL=https://YOUR-ACTUAL-FRONTEND-HOST/auth/callback
```

Use the API service URL from step 1. The frontend hostname becomes available when the Static Site is created: set its callback value and trigger a rebuild after you know that hostname. You can leave the callback variable unset initially; the app's web Linking callback defaults to its own origin. Public variables are embedded during the Expo export, so changing them requires another frontend build/deploy.

Add a **Rewrite** rule with source `/*` and destination `/index.html`. It keeps direct chat links and `/auth/callback` working after reload. Publish only `dist`, never the repository root. The frontend receives no Gemini key or Supabase secret/service-role key.

### 3. Connect the actual public URLs

1. In the API service, replace `CORS_ORIGINS` with the actual frontend HTTPS origin, without a trailing slash or path. To keep local testing, use a comma-separated list such as `https://YOUR-FRONTEND-HOST,http://localhost:8091`. Restart/redeploy the API after changing it.
2. In Supabase Authentication URL Configuration, set the hosted app as the Site URL and allow `https://YOUR-FRONTEND-HOST/auth/callback` as a redirect URL. Retain localhost's callback if you still need local development.
3. Rebuild the frontend if you changed any `EXPO_PUBLIC_` values. In the hosted app's Settings, clear any old custom Backend URL or set it to the hosted API's HTTPS URL.
4. Sign in on the hosted app, sync your confirmed profile, enable Gemini processing and select live guidance. Try a new description. Verify the response's **What was checked** panel says live and lists the current Gemini models and profile version.
5. Open the same account in another browser, enable sync, and verify the saved chat appears. Refresh a direct `/chat/...` URL to confirm the rewrite works.

### Blueprint alternative

Create a Render Blueprint from this repository to use `render.yaml` instead of entering both service definitions manually. Render prompts for the `sync: false` values. If service URLs are unknown during initial creation, use `http://localhost:8091` for API CORS and a temporary HTTPS placeholder for the frontend API URL, then replace them with the actual assigned URLs and redeploy. The initial frontend will not connect until those URLs are corrected. Existing Blueprint updates do not prompt again for new `sync: false` values; add them in the service's environment settings.

The API definition selects Render's free plan. Check current account limits before deploying; free services can sleep when idle. Open the API and app before presenting and wait for a successful health check. The backend currently assumes one process for rate limits, cancellation, event cache and temporary conversations. Hosted microphone input requires a secure browser context and user permission. Native app-store builds and Meta glasses integration are separate milestones.

Sources: [Render web services](https://render.com/docs/web-services), [Blueprint reference](https://render.com/docs/blueprint-spec), [static routing](https://render.com/docs/redirects-rewrites), [Expo web deployment](https://docs.expo.dev/guides/publishing-websites/), [Supabase redirect configuration](https://supabase.com/docs/guides/auth/redirect-urls).
