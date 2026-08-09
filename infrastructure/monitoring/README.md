# Monitoring

- **Uptime Kuma**: probe `GET /api/v1/health` on the EasyPWS process (port 3000)
- Optional: Prometheus metrics + Grafana dashboards (not scaffolded yet)
- Structured JSON logs from `@easypws/observability` (journald via systemd)
