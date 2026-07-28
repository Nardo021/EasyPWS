import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { createLogger } from "@easypws/observability";

const log = createLogger("easypws-api");

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix("api/v1");
  const port = Number(process.env["API_PORT"] ?? 3001);
  await app.listen(port);
  log.info("API listening", { port });
}

bootstrap().catch((err: unknown) => {
  log.error("API failed to start", { err: String(err) });
  process.exit(1);
});
