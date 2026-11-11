import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    conditions: ["easypws-source", "import", "module", "browser", "default"],
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
