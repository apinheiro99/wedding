# Wedding Photos — a private, self-hosted album for every guest's photos and videos

A private web app where wedding guests upload their **original, full-quality** photos and videos, browse everyone's
memories, and download them per person as ZIP packages. Built to run at home (Docker + PostgreSQL + a NAS) and be
exposed to the internet through a **Cloudflare Tunnel**, with no open router ports.

> The UI is in Brazilian Portuguese (it was built for a Brazilian wedding). Everything else — code, docs, logs — is in English.

## Highlights

- **Resumable, chunked uploads** (tus-style `PATCH` with `Upload-Offset`) that survive flaky mobile networks and Cloudflare's
  per-request body limit. Files are streamed to disk, never buffered in memory.
- **Global SHA-256 de-duplication** (client hashes in a Web Worker, the server always re-verifies) with soft-delete restore.
- **Background worker** on a PostgreSQL job queue (`FOR UPDATE SKIP LOCKED`): thumbnails, HEIC conversion, video probing
  (`ffmpeg`/`libheif`/`libvips`), versioned per-person ZIPs, e-mail digests.
- **Passwordless guests**: shared family credential + e-mail OTP sign-up; admin has a separate, LAN-only session.
- **Admin dashboard**: metrics, jobs, media moderation, branding (landing/login backgrounds), settings.
- **Production-grade logging**: levels, request tracing, secret redaction, daily rotated files, tunable at runtime.
- **Hardened by default**: CSRF checks, argon2id, hashed sessions/OTPs, rate limiting, security headers, safe file serving.

## Architecture

```
Browser (Next.js / React)
  → API route handlers (src/app/api/**)                 ← SSE at /api/events
    → Services / domain (src/server/services, src/server/domain)
      → PostgreSQL   (metadata, state, job queue)
      → Filesystem   (originals, thumbnails, ZIPs — e.g. a NAS over NFS)
  Worker (src/worker/main.ts) — same image, no exposed port
```

Two containers are built from one image: **web** (UI + API + uploads) and **worker** (background jobs).
Specification (Portuguese): [`casamento_fotos_especificacao_tecnica_v1.0.md`](casamento_fotos_especificacao_tecnica_v1.0.md).

---

# Install it with an AI assistant

Don't want to follow the guide by hand? Open an AI coding assistant that can run commands on the server
(e.g. [Claude Code](https://claude.com/claude-code)) **on the machine that will host the app**, and paste the prompt below.
It will ask you for what it needs, do the technical parts itself, and stop to tell you exactly what to click in the
Cloudflare / Resend dashboards (those need your accounts).

<details>
<summary><b>Copy this prompt</b></summary>

````text
You are installing the open-source "Wedding Photos" app for me, step by step, on THIS machine.
Repository: https://github.com/apinheiro99/wedding  (read its README.md first — it is the source of truth for setup).
The app is a private album where wedding guests upload original photos/videos. It runs as two Docker containers
(web + worker), uses an external PostgreSQL, stores files in a folder, sends e-mail through Resend, and is exposed to the
internet through a Cloudflare Tunnel (no router ports opened).

## Rules
- Work in small steps and tell me briefly what you are doing. Ask before anything destructive or irreversible
  (deleting data, dropping a database, `docker system prune`, changing DNS, overwriting an existing .env).
- Secrets: generate them yourself with `openssl rand -hex 32`. Never print secrets back to me, never commit `.env`,
  and `chmod 600 .env`. If I paste an API key in chat, put it in `.env` and tell me to rotate it afterwards.
- Never open router ports and never expose port 3000 to the internet directly: the admin panel is only safe because it
  is reachable from the local network only.
- Do not invent values. If you need something, ask me. Ask everything you need up front, in ONE message.

## 1. Ask me for
1. Public domain to use (e.g. photos.example.com) and whether it is already on Cloudflare (nameservers changed).
2. Names for the landing page eyebrow (e.g. "Ana & Bruno") and the e-mail sender display name.
3. PostgreSQL: host, port, user, password (must be allowed to CREATE DATABASE). If I have none, offer to run one with Docker.
4. Folder where photos are stored (local disk or NFS mount) and confirm it has plenty of free space.
5. Admin e-mail (login only, does not need to receive mail), a REAL e-mail for the daily report,
   and a strong password for the admin and one for the shared family login (you may generate and show them ONCE).
6. Resend: do I have an account and a verified sending domain? (If not, guide me through README section 5.)

## 2. Check the machine
Verify `docker`, `docker compose`, `git`, `openssl`, `curl`. Confirm the database is reachable from this machine
(`psql`, or a Docker one-liner) and the storage folder exists and is writable. Report anything missing and how to fix it.

## 3. Install
1. `git clone https://github.com/apinheiro99/wedding && cd wedding`
2. `cp .env.example .env`, then fill it with my answers. Set `NODE_ENV=production`, `APP_BASE_URL=https://<domain>`,
   `EMAIL_PROVIDER=resend`, `EMAIL_FROM="<Name> <noreply@<domain>>"`, `REPORT_EMAIL`, the PG_* values, `SESSION_SECRET`
   (32+ random chars, NOT the placeholder), and `APP_UID`/`APP_GID` = owner of the storage folder
   (`stat -c '%u:%g' <folder>`). Never leave placeholder secrets: production refuses to start with them.
3. Guide me through the parts that need my accounts, one at a time, waiting for my confirmation after each:
   - Cloudflare: add the site, change nameservers at my registrar, SSL mode Full, Always Use HTTPS.
   - Cloudflare Tunnel: create it in Zero Trust, give me the token; you install `cloudflared` as a service on this
     machine with the token and I add a Public hostname `<domain>` -> HTTP -> `localhost:3000`.
   - Resend: add the domain, put the SPF/DKIM DNS records in Cloudflare (DNS only), wait until "Verified",
     create a Sending-access API key and put it in `RESEND_API_KEY`.
4. `STORAGE_HOST_PATH=<folder> docker compose up -d --build` (the first build takes a few minutes).
   Wait until `docker compose ps` shows web as healthy.

## 4. Verify (show me each result)
- `curl -s http://localhost:3000/ready` returns `"ready":true`.
- `curl -s https://<domain>/ready` works from the public internet.
- `https://<domain>/admin/login` returns 404 from the internet and the admin loads on the local network at
  `http://<lan-ip>:3000/admin/login`.
- Send a real test e-mail through Resend to my address and confirm it arrives (check spam).
- Log in to the admin, then use "Primeiro acesso" with the family credential to create a guest and complete the e-mail code.
- Upload one photo and one video as that guest and confirm thumbnails appear (the worker is running).

## 5. If something fails
Read `docker compose logs web worker` and the files in `<storage>/logs` (structured JSON, one per day; each request has a
request id). Known cases: `EACCES` on /storage -> fix `APP_UID`/`APP_GID`; container "unhealthy" -> `/ready` shows which
check fails (database, migrations, storage, bootstrap); e-mail bounces -> the sender domain is not verified in Resend or
the recipient address is invalid. Fix the root cause; do not disable checks.

## 6. Finish
Give me a short summary: the URLs, where the config and logs live, how to restart (`docker compose restart`),
how to update (`git pull && docker compose up -d --build`), what to back up (the database and the storage folder),
and the three things I must do myself (rotate any key I pasted in chat, set up backups, tell guests to check spam
for the login code).
````

</details>

---

# Setup guide

You need: a domain, a free Cloudflare account, a Resend account (for e-mail), a PostgreSQL server, and a machine with Docker.

## 1. Prerequisites

| Piece | Notes |
|---|---|
| Docker + Docker Compose | Runs `web` and `worker`. |
| PostgreSQL 14+ | Any reachable server (another machine, a VM, a container). The role needs `CREATE DATABASE` for the first boot. |
| Storage | A folder with plenty of space (local disk or NFS/NAS). Mounted at `/storage` in the containers. |
| Node 20+ (dev only) | Plus `ffmpeg`, `libheif-examples` and `libvips-tools` if you run outside Docker. |

## 2. Local development

```bash
cp .env.example .env          # fill in PG_*, SESSION_SECRET, bootstrap passwords
npm install
npm run dev                   # http://localhost:3000 — creates the database and applies migrations on first boot
npm run worker:dev            # background jobs (second terminal)
```

- Health: `/health` (process) · Readiness: `/ready` (database, migrations, storage).
- With `EMAIL_PROVIDER=dev`, e-mails are written to `storage/temp/mail` and shown at `/dev/mail` (disabled in production).
- Admin: `/admin/login` with `ADMIN_EMAIL` / `ADMIN_BOOTSTRAP_PASSWORD` (created on first boot).

Generate a strong session secret:

```bash
openssl rand -hex 32
```

## 3. Configuration (`.env`)

Copy [`.env.example`](.env.example). Configuration is validated at startup and the app fails fast on bad values.

| Variable | Purpose |
|---|---|
| `NODE_ENV` | `production` in deployment (enables `Secure` cookies and HSTS, and forbids the dev e-mail provider). |
| `APP_BASE_URL` | Public URL, e.g. `https://photos.example.com`. Used in e-mail links. |
| `EVENT_TITLE` | Default eyebrow text on the landing page (editable later in the admin). |
| `PG_HOST` `PG_PORT` `PG_USER` `PG_PASSWORD` `PG_APP_DB` `PG_MAINTENANCE_DB` | PostgreSQL connection. The app database is created if missing. |
| `STORAGE_ROOT` | Where files live (overridden to `/storage` inside the containers). |
| `SESSION_SECRET` | ≥ 32 random chars. **Production refuses placeholder values.** |
| `FAMILY_BOOTSTRAP_LOGIN` / `FAMILY_BOOTSTRAP_PASSWORD` | Shared guest credential, created on first boot (change it later in the admin). |
| `ADMIN_EMAIL` / `ADMIN_BOOTSTRAP_PASSWORD` | Admin account, created on first boot. |
| `REPORT_EMAIL` | Recipient of the daily admin report (a real, deliverable address). Default only: it can be changed in *Admin → Settings → Relatório diário*. Falls back to `ADMIN_EMAIL`; addresses ending in `.local` are skipped. |
| `EMAIL_PROVIDER` | `dev`, `memory` (tests) or `resend`. |
| `EMAIL_FROM` | e.g. `Photos <noreply@photos.example.com>` — must belong to a domain verified in Resend. |
| `RESEND_API_KEY` | Required when `EMAIL_PROVIDER=resend`. |
| `MAX_UPLOAD_BYTES` | Largest accepted file (default 10 GiB). |
| `UPLOAD_CHUNK_BYTES` | Chunk size (default 8 MiB — keep it well under Cloudflare's per-request limit). |
| `LOG_LEVEL` `LOG_FORMAT` `LOG_DIR` `LOG_RETAIN_DAYS` `LOG_DEBUG` | See [Logging](#logging). |

Bootstrap credentials are only used if the accounts do not exist yet; afterwards manage them in the admin panel.

## 4. Domain and Cloudflare

1. **Buy a domain** (GoDaddy, Namecheap, Registro.br…).
2. **Create a free Cloudflare account** and click *Add a site* → enter your domain → choose the **Free** plan.
3. **Change the nameservers** at your registrar to the two Cloudflare nameservers shown (e.g. GoDaddy → *Domain → DNS → Nameservers → Change → Enter my own nameservers*). Propagation can take from minutes to a few hours; Cloudflare emails you when the zone is active.
4. In Cloudflare → **SSL/TLS**, set the mode to **Full** (the tunnel already encrypts the hop to Cloudflare) and enable **Edge Certificates → Always Use HTTPS**.
5. Do **not** cache `/api/*`. Responses already carry `Cache-Control: private, no-store`.

### Cloudflare Tunnel (no open ports on your router)

On the machine that runs the containers:

```bash
# Debian/Ubuntu — see https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
sudo apt install cloudflared
```

**Dashboard method (simplest):**

1. Cloudflare dashboard → **Zero Trust → Networks → Tunnels → Create a tunnel** (type *Cloudflared*).
2. Copy the tunnel **token**, then on the server:
   ```bash
   sudo mkdir -p /etc/cloudflared && echo '<TOKEN>' | sudo tee /etc/cloudflared/token >/dev/null && sudo chmod 600 /etc/cloudflared/token
   sudo cloudflared service install "$(sudo cat /etc/cloudflared/token)"   # or run: cloudflared tunnel run --token-file /etc/cloudflared/token
   ```
3. Add a **Public hostname**: subdomain/domain of your choice (e.g. `photos.example.com`) → service `HTTP` → `localhost:3000`.
   Cloudflare creates the DNS record for you.
4. Verify from outside your network (e.g. mobile data): `https://photos.example.com/ready` must return `{"ready":true,…}`.

### Keep `/admin` private (LAN only)

The app itself refuses `/admin/*` and `/api/admin/*` when a request arrives through Cloudflare (the tunnel always adds
`cf-ray` / `cf-connecting-ip`; see [`src/middleware.ts`](src/middleware.ts)). Reach the admin from your local network
directly: `http://<server-lan-ip>:3000/admin`. Do not expose port 3000 to the internet by any other path (port-forwarding, a
second tunnel hostname, a reverse proxy that strips those headers), or this protection no longer holds.

## 5. E-mail with Resend

1. Create an account at [resend.com](https://resend.com).
2. **Domains → Add Domain** and enter the (sub)domain you will send from, e.g. `photos.example.com`.
3. Add the DNS records Resend shows (SPF, DKIM and, optionally, DMARC) **in Cloudflare DNS** — set them to *DNS only* (grey cloud).
   Wait until the domain shows **Verified**.
4. **API Keys → Create API Key** with the **Sending access** permission, restricted to that domain. Copy it once.
5. Set in `.env`:
   ```env
   EMAIL_PROVIDER=resend
   RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxx
   EMAIL_FROM="Photos <noreply@photos.example.com>"
   ```
6. Test the key without touching the app:
   ```bash
   curl https://api.resend.com/emails -H "Authorization: Bearer $RESEND_API_KEY" -H 'Content-Type: application/json' \
     -d '{"from":"Photos <noreply@photos.example.com>","to":["you@example.com"],"subject":"Test","html":"<p>It works.</p>"}'
   ```

Until a domain is verified, Resend only allows the `onboarding@resend.dev` sender and only to your own account e-mail.
Never commit the API key; if it leaks, revoke it in the Resend dashboard and create a new one.

Optional: add a support address with **Cloudflare Email Routing** (e.g. `support@photos.example.com` → your inbox) for guests who need help.

## 6. Run in production (Docker Compose)

```bash
cp .env.example .env               # set NODE_ENV=production, APP_BASE_URL, secrets, PG_*, Resend
STORAGE_HOST_PATH=/mnt/nas/wedding docker compose up -d --build
docker compose ps                  # web should become "healthy"
curl -s http://localhost:3000/ready
```

- `web` and `worker` share the image; the worker starts after `web` is healthy.
- `STORAGE_HOST_PATH` is bind-mounted at `/storage` (originals, thumbnails, ZIPs and logs).
- Migrations run on boot under an advisory lock; failures show up in `/ready`.
- Use `docker compose logs -f web worker` to tail output, or read the files in `/storage/logs`.

**Pre-launch checklist**

- [ ] `https://<your-domain>/ready` returns `ready: true` from a network outside your own
- [ ] Login → upload a photo and a large video → thumbnails appear (worker running)
- [ ] A sign-up OTP e-mail arrives (Resend domain verified)
- [ ] `https://<your-domain>/admin/login` returns **404** from the internet, and works on your LAN
- [ ] Backups cover the PostgreSQL database and `STORAGE_ROOT`

## Logging

Structured logs with levels `trace < debug < info < warn < error < fatal`.

| Setting | Default | Meaning |
|---|---|---|
| `LOG_LEVEL` | `debug` in dev, `info` in production | Minimum level. |
| `LOG_FORMAT` | `pretty` in dev, `json` in production | Human-readable vs. one JSON object per line. |
| `LOG_DIR` | `./logs` (`/storage/logs` in Docker) | Daily files `app-YYYY-MM-DD.log` (everything) and `error-YYYY-MM-DD.log` (warn and above). Empty disables files. |
| `LOG_RETAIN_DAYS` | `7` | One file per day; older files are deleted. |
| `LOG_DEBUG` | – | e.g. `upload,worker` forces debug output for those scopes only. |

**Level and retention can be changed live in *Admin → Settings → Logs*** (stored in the database and applied to both the web
and worker processes within a minute). Every request is logged with a request id (also returned as `x-request-id`),
method, path, status and duration; errors include `stack` and `cause`. Passwords, tokens, OTPs and API keys are redacted.

## Storage layout

```
STORAGE_ROOT/
  originals/users/<Name>__<uuid8>/   ← original files, byte for byte, never modified
  staging/<upload_id>/data           ← uploads in progress
  thumbnails/<media_id>/{sm,lg}.webp ← disposable derivatives
  packages/<user_id>/NN_<pkg>_vN.zip ← versioned ZIPs
  branding/                          ← landing/login backgrounds (managed in the admin, not in git)
  logs/  temp/
```

Recovery: thumbnails and ZIPs can be deleted and regenerated (admin → rebuild); uploads stuck in `VERIFYING` and jobs stuck
in `RUNNING` are re-queued by the worker. Originals plus the database are the source of truth.

## Security

- Secrets live only in `.env` (git-ignored); CI runs gitleaks. Production refuses placeholder secrets.
- Passwords use argon2id; session tokens and OTPs are stored only as hashes. Cookies are `HttpOnly; SameSite=Lax; Secure`.
- Mutations require same-origin (CSRF); auth endpoints are rate-limited per client IP (`CF-Connecting-IP`).
- Uploaded files can never run as active content: only passive image/video/audio types render inline; everything else is
  forced to download as `application/octet-stream` under a sandbox CSP. Upload size is capped (`MAX_UPLOAD_BYTES`).
- Physical paths are never exposed and `abs()` blocks path traversal.
- Security headers: `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, COOP, HSTS (production), and a
  baseline CSP (`frame-ancestors`, `base-uri`, `object-src`, `form-action`).
- The admin panel is unreachable from the internet (see [Keep `/admin` private](#keep-admin-private-lan-only)) and the admin
  account cannot upload or appear in metrics.

Report vulnerabilities privately to the repository owner rather than opening a public issue.

## Tests

```bash
npm run typecheck
npm run test:unit
npm run test:int     # real PostgreSQL: creates wedding_test_<hex>, migrates, tests, drops. Requires NODE_ENV=test.
npm run test:e2e     # Playwright
```

Integration tests use `PG_TEST_HOST` / `PG_TEST_USER` / `PG_TEST_PASSWORD` and a temp storage dir — never your real database or storage.

## Project layout

```
src/app/            Next.js routes (UI + api/)
src/server/         config, db + migrations, services, domain rules, email providers, logger
src/worker/         background job runner
src/middleware.ts   keeps /admin off the public internet
tests/              unit, integration, e2e
```
