# Triconnect

## Production Realtime Fix

Meetings and live quizzes use WebRTC for media plus Socket.IO for signaling.
Socket.IO session state is in-memory, so running signaling on serverless functions can cause polling `sid` 400/404 errors.

Use this deployment split for production:

1. Frontend: Vercel
2. Realtime signaling (Socket.IO): persistent Node host (Render recommended)
3. REST API: Vercel or persistent host (either works)

## Persistent Socket.IO Host (Render)

This repo includes [render.yaml](render.yaml).

Steps:

1. Create a new Render Blueprint (or Web Service) from this repo.
2. Service root should be `server` (already set in [render.yaml](render.yaml)).
3. Set required env vars on Render:
	1. `SUPABASE_URL`
	2. `SUPABASE_SERVICE_KEY`
	3. `MEETING_TURN_USERNAME`
	4. `MEETING_TURN_CREDENTIAL`
4. Keep `SOCKET_IO_PATH=/socket.io` and set `SOCKET_CORS_ORIGIN=https://www.triconnect.online,https://triconnect.online,https://*.vercel.app`.
5. Deploy and copy your Render URL (example: `https://triconnect-realtime.onrender.com`).

Server env template: [server/.env.example](server/.env.example)

## Vercel Frontend Env (Point To Realtime Host)

Set these in Vercel Project Settings -> Environment Variables:

1. `VITE_SOCKET_URL=https://<your-render-service>.onrender.com`
2. `VITE_SOCKET_PATH=/socket.io`
3. `VITE_SOCKET_TRANSPORTS=websocket,polling`
4. `VITE_SOCKET_RECONNECTION=true`

Optional fallback (for your production custom domain only):

1. `VITE_PROJECT_SOCKET_FALLBACK_URL=https://triconnect-realtime.onrender.com`

Optional (if REST API remains on same Vercel domain):

1. `VITE_API_BASE_URL=https://www.triconnect.online`

Client env template: [client/.env.example](client/.env.example)

## Redeploy Order

1. Deploy Render realtime service first.
2. Update Vercel envs with `VITE_SOCKET_URL`.
3. Redeploy Vercel frontend.

## Local Development

Run both frontend and server locally:

```bash
npm run dev
```

## Security Note

If secrets were exposed in logs or shared files, rotate them immediately:

1. Supabase service key
2. TURN credentials
3. Any project tokens