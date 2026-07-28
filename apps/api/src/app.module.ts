import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller.js";
import { MetaController } from "./meta.controller.js";

/**
 * NestJS API scaffold.
 * Future modules: Auth, Products, Watchlists, Prices, Rules, Notifications, Admin, HA.
 */
@Module({
  controllers: [HealthController, MetaController],
})
export class AppModule {}
