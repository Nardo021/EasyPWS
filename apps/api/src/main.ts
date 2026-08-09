import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { AppModule } from "./app.module.js";
import { createLogger } from "@easypws/observability";

const log = createLogger("easypws-api");

function resolveWebOutDir(): string | null {
  const candidates = [
    join(process.cwd(), "apps/web/out"),
    join(process.cwd(), "../web/out"),
  ];
  for (const dir of candidates) {
    if (existsSync(join(dir, "index.html"))) {
      return dir;
    }
  }
  return null;
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: false,
  });
  app.enableCors({
    origin: true,
    credentials: true,
  });
  app.setGlobalPrefix("api/v1");

  const webOut = resolveWebOutDir();
  if (webOut) {
    app.useStaticAssets(webOut);
    log.info("Serving web static assets", { webOut });
  } else {
    log.warn("Web export not found (apps/web/out) — API only");
  }

  app.enableShutdownHooks();
  const port = Number(process.env["PORT"] ?? 3000);
  await app.listen(port);
  log.info("EasyPWS listening", { port, singleProcess: true });
}

bootstrap().catch((err: unknown) => {
  log.error("API failed to start", { err: String(err) });
  process.exit(1);
});
