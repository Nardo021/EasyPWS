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
        web: "Next.js + TypeScript",
        api: "NestJS",
        worker: "BullMQ",
        scheduler: "BullMQ + due-listing poller",
        database: "PostgreSQL + Drizzle",
        cacheQueue: "Redis",
      },
      deployment: "Docker Compose on Debian LXC (Proxmox)",
      ha: "Native custom integration under integrations/home-assistant",
      firstRelease: ["coles", "url-import", "watchlist", "rules", "charts", "ha"],
    };
  }
}
