# Drift Inbox web client

Standalone Vite client for browsing temporary inboxes served by the worker API.

## Setup

```bash
cd web
bun install
cp .env.example .env
bun run dev
```

`VITE_API_URL` sets the API origin and defaults to `https://temp-mail.me2r.workers.dev`. The API must allow
the deployed web origin through CORS.

## Production server

Build and serve the SPA with Bun's authenticated static server:

```bash
bun run build
FRONTEND_PASSWORD='use-a-strong-secret' bun run serve
```

`FRONTEND_PASSWORD` is required and the process exits at startup if it is missing or blank.
`FRONTEND_USERNAME` is optional and defaults to `admin`. The server binds to `HOST` (default
`127.0.0.1`) and `PORT` (default `4173`).

`FRONTEND_PASSWORD` and `FRONTEND_USERNAME` are server-only secrets. Never prefix either name with
`VITE_`: Vite exposes `VITE_*` values to browser code. `VITE_API_URL` remains a public build-time
setting for the API origin.

## Checks

```bash
bun run typecheck
bun test
bun run build
```

## Deploy

Run `bun run serve` from this directory to serve the generated `dist/` directory with HTTP Basic
Auth and SPA fallback for direct `/inbox/:address` navigation. Set `VITE_API_URL` in the build
environment when using a different API origin.

cd /home/ubuntu/temp-mail/web
bun install --frozen-lockfile
bun run build

sudo cp /home/ubuntu/temp-mail/deploy/temp-mail.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now temp-mail.service
