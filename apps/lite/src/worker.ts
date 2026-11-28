import { WorkerEntrypoint } from "cloudflare:workers";
import type { Env } from "./catalogue.js";
import app from "./index.js";
import { runPriceQuery } from "./query.js";

/** Private RPC entrypoint. The public fetch and scheduled handlers stay on the default export. */
export class PriceQuery extends WorkerEntrypoint<Env> {
  async query(input: unknown): Promise<unknown> {
    return runPriceQuery(this.env, input);
  }
}

export default app;
