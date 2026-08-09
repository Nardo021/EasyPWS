import type { NextConfig } from "next";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const nextConfig: NextConfig = {
  output: "export",
  transpilePackages: ["@easypws/contracts"],
  outputFileTracingRoot: join(dirname(fileURLToPath(import.meta.url)), "../.."),
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
