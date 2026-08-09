# Cloudflare / Authentik

Scaffold notes for public access:

1. Cloudflare Tunnel (`cloudflared`) to EasyPWS LXC port `3000` (single process)
2. Cloudflare Access policy in front of the site
3. Authentik OIDC for browser sessions (later)
4. Long-lived API tokens + scoped HA tokens for machine clients
5. Webhook signature verification for inbound/outbound hooks

Placeholder env vars: see `.env.example` (`OIDC_*`, `PUBLIC_*_URL`).
