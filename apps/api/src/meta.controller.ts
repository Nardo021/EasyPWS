import { Controller, Get } from "@nestjs/common";
import { createAdapterRegistry } from "@easypws/adapters";

@Controller("meta")
export class MetaController {
  @Get("adapters")
  async listAdapters() {
    const registry = createAdapterRegistry();
    const adapters = [];
    for (const adapter of registry.list()) {
      const health = await adapter.healthCheck();
      adapters.push({
        retailer: adapter.retailer,
        health,
      });
    }
    return { adapters };
  }

  @Get("architecture")
  architecture() {
    return {
      stack: {
        web: "Next.js static export (same process)",
        api: "NestJS",
        worker: "In-process queue (concurrency 1)",
        scheduler: "In-process due-listing poller",
        database: "SQLite + Drizzle",
        cacheQueue: "In-process (no Redis)",
      },
      deployment: "Single Node process on Debian LXC (Proxmox) via systemd",
      ha: "Native custom integration under integrations/home-assistant",
      firstRelease: [
        "coles",
        "url-import",
        "watchlist",
        "rules",
        "charts",
        "ha",
      ],
    };
  }
}
