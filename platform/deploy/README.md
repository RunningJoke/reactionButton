# Deploying the platform on a VPS (Hetzner)

One server runs the API, Postgres and Caddy (HTTPS) with Docker Compose
([compose.yaml](compose.yaml)). CI builds the image `ghcr.io/runningjoke/reactpod-platform`
and deploys over SSH ([.github/workflows/platform.yml](../../.github/workflows/platform.yml)).
The deploy job is skipped until the secrets below exist.

## One-time server setup

1. **Server**: Hetzner Cloud, e.g. CX22 (2 vCPU, 4 GB), location Falkenstein or Nuremberg (EU),
   image Ubuntu 24.04, your SSH key. Enable backups in the Hetzner console.
2. **DNS**: an `A` (and `AAAA`) record, e.g. `api.staging.<your-domain>` → server IP.
3. **Firewall** (Hetzner firewall or `ufw`): allow 22, 80, 443 (TCP) and 443 (UDP), nothing else.
4. **Docker**: `curl -fsSL https://get.docker.com | sh`.
5. **Deploy user** (no root logins from CI):
   ```sh
   adduser --disabled-password deploy && usermod -aG docker deploy
   mkdir -p /opt/reactpod && chown deploy: /opt/reactpod
   # on your machine: ssh-keygen -t ed25519 -f reactpod-deploy -N ""
   # put reactpod-deploy.pub into /home/deploy/.ssh/authorized_keys
   ```
6. **Configuration**: `/opt/reactpod/.env` from [.env.example](.env.example) with a long random
   `POSTGRES_PASSWORD` (`openssl rand -base64 32`) and your `API_DOMAIN`. `chmod 600 .env`.
7. **Registry access**: while the package is private, log in once as `deploy`:
   `echo <PAT with read:packages> | docker login ghcr.io -u <github-user> --password-stdin`
   (or make the package public under GitHub → Packages → reactpod-platform → settings).

## GitHub settings

Repository → Settings → Environments → **staging**:

| Name | Kind | Value |
|---|---|---|
| `STAGING_HOST` | secret | server IP or host name |
| `STAGING_USER` | secret | `deploy` |
| `STAGING_SSH_KEY` | secret | content of the private key `reactpod-deploy` |
| `STAGING_DOMAIN` | variable | `api.staging.<your-domain>` (checked after the deploy) |

## What a deploy does

1. Copies `compose.yaml` and `Caddyfile` to `/opt/reactpod/`.
2. `API_TAG=sha-<commit> docker compose pull`
3. `docker compose run --rm migrate` (Drizzle migrations from the image)
4. `docker compose up -d --remove-orphans`
5. CI checks `https://$STAGING_DOMAIN/v1/meta`.

## Operations

- Logs: `docker compose logs -f api` in `/opt/reactpod`.
- **Roll back**: `API_TAG=sha-<older commit> docker compose up -d` (image tags stay in ghcr).
  Migrations are forward-only; a release that changes tables must stay compatible with the
  previous image for one deploy.
- **Database backup** (besides Hetzner server backups), daily via cron as `deploy`:
  `docker compose exec -T db pg_dump -U reactpod reactpod | gzip > /opt/reactpod/backup/$(date +%F).sql.gz`
  and copy off the server (e.g. Hetzner Storage Box). Keep 14 days.
- Production later: the same files on a second server (or a managed EU Postgres via
  `DATABASE_URL`), its own environment `production`, deployed from `platform-v*` tags.
