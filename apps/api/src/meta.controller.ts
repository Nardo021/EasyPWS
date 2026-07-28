import { Controller, Get } from "@nestjs/common";
import { createAdapterRegistry } from "@easypws/adapters";

@Controller("meta")
export class MetaController {
  @Get("adapters")
  listAdapters() {
    const registry = createAdapterRegistry();
    return {
      adapters: registry.list().map((a) => ({
        retailer: a.retailer,
        implemented: false,
      })),
      note: "Scaffold only — adapters throw until data sources are wired",
    };
  }

  @Get("architecture")
  architecture() {
    return {
      stack: {
        web: "Next.js + TypeScript",
        api: "NestJS",
        worker: "BullMQ",
        scheduler: "BullMQ repeatable jobs",
        database: "PostgreSQL",
        cacheQueue: "Redis",
      },
      deployment: "Docker Compose on Debian LXC (Proxmox)",
      ha: "Native custom integration under integrations/home-assistant",
    };
  }
}
