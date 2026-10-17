# Deploying to Render

The app is a Node server that runs a compiled C++ engine and keeps its data in files, so it runs as a Docker web service with a persistent disk.

## Steps

1. Push this project to a GitHub repository. `.env` and `data/*.json*` are git-ignored; keep it that way.
2. In Render: **New > Blueprint**, pick the repo. Render reads `render.yaml`. (Or **New > Web Service**, runtime Docker, and add a disk mounted at `/app/data`.)
3. Choose a paid instance (Starter or above). A persistent disk is required, otherwise users, sessions, recipes and the audit log are lost on every deploy or restart.
4. Enter the secrets when prompted: any of `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, `OPENAI_API_KEY`, `GROQ_API_KEY`. With none set, the offline generator is used.
5. First admin: set `BOOTSTRAP_ADMIN_USERNAME` and `ADMIN_PASSWORD` (it must pass the password policy). The entrypoint creates the account on start. An existing account is left alone. After the first successful start, delete `ADMIN_PASSWORD` from the Render environment.
6. Open the `onrender.com` URL. `/` is the landing page.

## Settings that matter

| Variable | Value | Why |
|---|---|---|
| `NODE_ENV` | `production` | secure cookies, HSTS |
| `COOKIE_SECURE` | `true` | cookies only over HTTPS (Render provides it) |
| `TRUST_PROXY_HOPS` | `1` | Render puts one proxy in front; without it every user shares one IP for rate limits |
| `CORS_ORIGINS` | empty | site and API share one origin |

## Limits

- Run one instance only. Rate limits and the login throttle are held in memory, and the JSON files are not safe for several writers.
- Redeploys restart the app, and the disk keeps `data/`. Back up the disk with Render snapshots or by downloading `data/`.
- The Docker build has not been run by the author. If the first build fails, send the build log.
