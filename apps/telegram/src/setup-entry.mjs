// Temporary deployment entrypoint only; permanent Wrangler main remains src/index.ts.
import worker from "./index.js";
import { handleSetup } from "./setup.mjs";
export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname === "/__setup") return handleSetup(request, env);
    return worker.fetch(request, env);
  }
};
