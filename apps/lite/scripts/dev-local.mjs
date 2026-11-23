import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(appDir, "../..");

function envValue(name) {
  const path = resolve(repoRoot, ".env");
  if (!existsSync(path)) {
    return "";
  }
  const line = readFileSync(path, "utf8")
    .split(/\r?\n/)
    .find((row) => row.startsWith(`${name}=`));
  if (!line) {
    return "";
  }
  return line.slice(name.length + 1).trim().replace(/^["']|["']$/g, "");
}

const key = envValue("RAPIDAPI_KEY") || envValue("OMKAR_API_KEY");
const requested = process.env.EASYPWS_OMKAR_MODE;
const mode = requested === "fixture" || !key ? "fixture" : "live";
const lines = [`EASYPWS_OMKAR_MODE=${mode}`];
if (mode === "live") {
  lines.push(`OMKAR_API_KEY=${key}`);
}
writeFileSync(resolve(appDir, ".dev.vars"), `${lines.join("\n")}\n`, "utf8");
console.log(`lite mode ${mode}; key ${key ? "present" : "absent"}`);
const migrated = spawnSync(
  "pnpm",
  ["exec", "wrangler", "d1", "migrations", "apply", "DB", "--local", "--persist-to", ".wrangler/state"],
  { cwd: appDir, shell: true, stdio: "inherit" },
);
if (migrated.status !== 0) {
  process.exit(migrated.status ?? 1);
}

const child = spawn(
  "pnpm",
  ["exec", "wrangler", "dev", "--port", "8787", "--ip", "127.0.0.1", "--persist-to", ".wrangler/state"],
  { cwd: appDir, stdio: "inherit", shell: true },
);
child.on("exit", (code) => process.exit(code ?? 0));
