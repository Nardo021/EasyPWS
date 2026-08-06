# Cloudflare / Authentik

Scaffold notes for public access:

1. Cloudflare Tunnel (`cloudflared`) to EasyPWS LXC
2. Cloudflare Access policy in front of Web/API
3. Authentik OIDC for browser sessions
4. Long-lived API tokens + scoped HA tokens for machine clients
5. Webhook signature verification for inbound/outbound hooks

Placeholder env vars: see `.env.example` (`OIDC_*`, `HA_API_TOKEN`, `PUBLIC_*_URL`).
