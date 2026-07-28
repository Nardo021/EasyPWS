import { Module, OnModuleInit } from "@nestjs/common";
import { bootstrapSystem } from "@easypws/database";
import { createLogger } from "@easypws/observability";
import { HealthController } from "./health.controller.js";
import { MetaController } from "./meta.controller.js";
import { ProductsController } from "./products.controller.js";
import { WatchlistsController } from "./watchlists.controller.js";
import { PricesController } from "./prices.controller.js";
import { HaController } from "./ha.controller.js";
import { TokensController } from "./tokens.controller.js";
import { db } from "./db.js";

const log = createLogger("easypws-api");

@Module({
  controllers: [
    HealthController,
    MetaController,
    ProductsController,
    WatchlistsController,
    PricesController,
    HaController,
    TokensController,
  ],
})
export class AppModule implements OnModuleInit {
  async onModuleInit(): Promise<void> {
    if (!process.env["DATABASE_URL"]) {
      log.warn("DATABASE_URL missing — API routes that need DB will fail");
      return;
    }
    const result = await bootstrapSystem(db(), {
      issueTokens: process.env["BOOTSTRAP_ISSUE_TOKENS"] === "true",
    });
    log.info("Bootstrap complete", {
      userId: result.userId,
      watchlistId: result.watchlistId,
      issuedBootstrapToken: Boolean(result.bootstrapToken),
      issuedHaToken: Boolean(result.haToken),
    });
    if (result.bootstrapToken) {
      log.info("BOOTSTRAP_TOKEN (store securely, shown once)", {
        token: result.bootstrapToken,
      });
    }
    if (result.haToken) {
      log.info("HA_API_TOKEN (store securely, shown once)", {
        token: result.haToken,
      });
    }
  }
}
