# EasyPWS — Debian LXC (Proxmox) native deploy

One Node process serves Web UI + `/api/v1` + in-process worker/scheduler. Data lives in a SQLite file. No Docker, Postgres, or Redis.

## Requirements

- Debian/Ubuntu LXC
- **Node.js ≥ 22.5** (uses built-in `node:sqlite`)
- `pnpm` (via Corepack or npm)
- `git`, `ca-certificates`

```bash
# Example on Debian
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs git
corepack enable
```

## Install

```bash
git clone <your-repo-url> /opt/easypws
cd /opt/easypws
cp .env.example .env
# edit .env — set BOOTSTRAP_ROTATE_SECRET, COLES_STORE_ID, etc.

pnpm install
pnpm build

cp infrastructure/systemd/easypws.service /etc/systemd/system/easypws.service
# Adjust WorkingDirectory / EnvironmentFile if not /opt/easypws
systemctl daemon-reload
systemctl enable --now easypws
```

## Bootstrap tokens

```bash
journalctl -u easypws -n 200 --no-pager | grep -E 'BOOTSTRAP_TOKEN|HA_API_TOKEN'
```

- Paste `BOOTSTRAP_TOKEN` into the Web UI at `http://<ct-ip>:3000`
- Use `HA_API_TOKEN` in the Home Assistant integration (`http://<ct-ip>:3000`)

Lost tokens? Set `BOOTSTRAP_ROTATE_SECRET` and:

```bash
curl -X POST http://127.0.0.1:3000/api/v1/tokens/recover \
  -H 'Content-Type: application/json' \
  -d '{"secret":"<BOOTSTRAP_ROTATE_SECRET>"}'
```

## Update

```bash
cd /opt/easypws
git pull
pnpm install
pnpm build
systemctl restart easypws
```

## Backup

Copy the SQLite file (default `./data/easypws.sqlite` or `DATABASE_PATH`):

```bash
systemctl stop easypws
cp "$DATA_DIR/easypws.sqlite" /backup/easypws-$(date +%F).sqlite
systemctl start easypws
```

## Layout

```
Proxmox
├── Home Assistant VM     # consumers only
├── EasyPWS LXC           # this single process
│   └── node apps/api/dist/main.js
│       ├── Web static (apps/web/out)
│       ├── API /api/v1
│       ├── in-process queue + scheduler
│       └── SQLite file
├── Authentik / Cloudflared (optional edge)
└── Monitoring (Uptime Kuma → GET /api/v1/health)
```

## Domains (suggested)

Point Cloudflare Tunnel at the CT `:3000`. Same origin for Web and API:

- `https://easypws.leoze.top` → Web + `/api/v1`
