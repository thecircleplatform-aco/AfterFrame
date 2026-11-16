# Afterframe on a DigitalOcean droplet (self-hosted)

The VPS runs the **same server as the Electron build**: `desktop/embedded-server.ts`.
It mounts every `/api/*` plugin from `server/plugins`, serves `dist/` statically and
streams `/media/uploads` — a single Node process on `127.0.0.1:5199`, with Caddy
terminating TLS in front of it.

There is no `start`/`serve` npm script in this repo by design (dev is a Vite plugin),
so one was added for production:

| script | what it does |
| --- | --- |
| `npm run build` | `tsc -b && vite build` → `dist/` |
| `npm run build:server` | esbuild-bundles `server/serve-prod.ts` → `server-dist/serve-prod.mjs` |
| `npm run vps:build` | both of the above |
| `npm run serve:prod` | `node server-dist/serve-prod.mjs` (reads `dist/`, port from affinity) |

`server/serve-prod.ts` is the VPS entry: it calls `startEmbeddedServer(dist)`, logs the
origin, and drains on `SIGTERM`/`SIGINT` (10 s hard stop for in-flight exports).

---

## 0. Droplet sizing

The **$12 tier** (2 GB RAM / 1 vCPU / 50 GB SSD) builds this repo, but `tsc -b` +
`vite build` on a 2 GB box will swap-thrash or OOM without swap. The Dockerfile is
multi-stage so the *runtime* only needs ~400 MB; the build needs ~2.5 GB.

Two options:

* **Build on the droplet** → add swap first (step 2).
* **Build locally / in CI** and push the image (faster, recommended once it works).

---

## 1. Create the droplet

* Image: **Ubuntu 24.04 LTS**
* Size: **2 GB / 1 vCPU ($12/mo)** minimum
* Add your SSH key at creation, then note the **public IPv4**

DNS: create an `A` record for `video.example.com` → droplet IP (and `AAAA` only if
you also configure IPv6). Caddy needs this to resolve **before** first start.

---

## 2. Bootstrap (as root)

```bash
ssh root@YOUR_DROPLET_IP

# 2 GB swap — required for the Vite build on this tier
fallocate -l 2G /swapfile && chmod 600 /swapfile
mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
sysctl -w vm.swappiness=10 && echo 'vm.swappiness=10' >> /etc/sysctl.conf

# Updates + firewall
apt-get update && apt-get -y upgrade
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable

# Docker
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker

# Non-root deploy user
adduser --disabled-password --gecos "" deploy
usermod -aG docker deploy
rsync -a ~/.ssh/ /home/deploy/.ssh/ && chown -R deploy:deploy /home/deploy/.ssh
```

---

## 3. Get the code up

**Option A — git clone (simplest)**

```bash
su - deploy
git clone <your-repo-url> afterframe && cd afterframe
git checkout develop
```

**Option B — rsync from your machine** (avoids putting the repo on the server)

```bash
# run from c:\Users\Dell\Afterframe
rsync -az --delete \
  --exclude node_modules --exclude dist --exclude server-dist --exclude data \
  --exclude .git --exclude token-backup.local --exclude .cf-token.local \
  ./ deploy@YOUR_DROPLET_IP:/home/deploy/afterframe/
```

---

## 4. Secrets and domain

```bash
cd ~/afterframe
cp .env.vps.example .env          # set AFTERFRAME_DOMAIN + ACME_EMAIL
nano .env

# API keys stay server-side; compose mounts this read-only.
nano .env.local                   # DEEPSEEK_API_KEY=..., VITE_DOCS_AI_URL=...
chmod 600 .env.local
mkdir -p data
```

---

## 5. Build & run

```bash
docker compose up -d --build      # first build ~6-12 min on this tier
docker compose logs -f afterframe # wait for: afterframe: serving /app/dist on ...
```

Then open `https://video.example.com` — Caddy issues the certificate on first request.

Sanity checks:

```bash
curl -sI http://127.0.0.1:5199/ | head -3          # 200 from the app
docker compose exec afterframe ls /data            # persistent state
docker stats --no-stream                           # memory headroom
```

---

## 6. Operations

```bash
docker compose restart afterframe          # after editing .env / .env.local
docker compose pull && docker compose up -d # deploy a new image

# Backup: everything lives under ./data (projects, uploads, keystore, agent runs)
tar czf ~/afterframe-$(date +%F).tgz data .env.local
```

Update path:

```bash
cd ~/afterframe && git pull
docker compose up -d --build
```

---

## 7. Without Docker (systemd, if you prefer)

```bash
sudo apt-get install -y ffmpeg
```
`/etc/systemd/system/afterframe.service`:

```ini
[Unit]
Description=Afterframe
After=network.target

[Service]
Type=simple
User=deploy
WorkingDirectory=/home/deploy/afterframe
Environment=NODE_ENV=production
Environment=HOME=/home/deploy/afterframe/data
ExecStart=/usr/bin/node server-dist/serve-prod.mjs
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now afterframe
sudo apt-get install -y caddy    # then adapt Caddyfile: reverse_proxy 127.0.0.1:5199
```

---

## 8. Notes / gotchas

* **Rendering is client-side. This is a hard rule, not a tuning knob.**
  Afterframe is free for users, so the droplet must never spend CPU encoding a
  user's video — one 4K export can pin a $6 droplet for an hour and a handful of
  concurrent users would cost more than the whole product earns. Exports run in
  the visitor's browser through WebCodecs (`src/export/browserExport.ts`,
  `src/export/browserEncoderProbe.ts`), and `src/export/exportRoutePlanner.ts`
  already prefers that route whenever the browser supports it.
  `AFTERFRAME_SERVER_EXPORT=off` (set for you in `docker-compose.yml`) makes
  `server/plugins/server-render-gate.ts` refuse the server render routes with a
  `501 server-render-disabled` instead of quietly doing the work:

  | Route | Hosted behaviour |
  | --- | --- |
  | `POST /export`, `POST /export/job/*` | `501` — browser encodes instead |
  | `POST /render-clip` | `501` |
  | `POST /api/export-qa` | `501` (it runs ffmpeg over the whole file) |
  | `POST /render-still` | `501` unless `AFTERFRAME_SERVER_STILLS=on` |
  | `/export/stage`, `/export/capabilities`, `/api/export-destinations` | still served — the browser path needs them |

  Consequences to accept: **ProRes mezzanine export and the agent's frame-grab
  tools are unavailable on a hosted deployment** (both need a server renderer),
  and dashboard project posters stay empty unless you opt stills back in. If you
  ever want a paid render box, set `AFTERFRAME_SERVER_EXPORT=on` — every route
  comes back and behaves like the desktop build.
* **Port affinity.** `listenWithAffinity` remembers the port the app bound; if 5199 is
  taken it may pick a neighbour. Check the startup log line, not the script.
* **Uploads.** Caddy allows 4 GB request bodies; the app streams them to disk, but
  `./data` must have room for raw media. With server rendering off, finished
  exports arrive from the browser through `/export/stage` and are deleted after
  the retention window.
* **Local AI models** (ASR/voice packs) download into `$HOME` → `/data`. Budget a few GB
  if you enable them on this tier.
* **Cloudflare** (optional): point the record at the droplet with the orange cloud on
  for WAF/caching, or keep it grey (DNS-only) so uploads bypass the 100 MB free-tier
  body limit. See `CLOUDFLARE-SETUP.md`.
