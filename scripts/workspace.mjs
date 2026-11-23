import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const LIBRARY_PACKAGES = [
  "@easypws/adapters",
  "@easypws/contracts",
  "@easypws/core",
  "@easypws/database",
  "@easypws/notifications",
  "@easypws/observability",
  "@easypws/rules",
  "@easypws/services",
];

const APP_PACKAGES = ["@easypws/api", "@easypws/web", "@easypws/lite"];

const TEST_PACKAGES = [
  "@easypws/adapters",
  "@easypws/rules",
  "@easypws/database",
  "@easypws/services",
];

const LIBRARY_FILTER = "./packages/*";
const APP_FILTER = "./apps/*";

function quoteCmd(arg) {
  // cmd.exe does not glob `*`. Quoting it here is harmful: `cmd /s /c` strips
  // the first and last quote, so an inner quoted filter is passed to pnpm
  // with the quotes still attached and matches nothing.
  if (arg.length === 0 || /[\s"&|<>^]/.test(arg)) {
    return `"${arg.replaceAll('"', '""')}"`;
  }
  return arg;
}

function runPnpm(args, options = {}) {
  const capture = options.capture === true;
  const commandLine = ["pnpm", ...args].map(quoteCmd).join(" ");
  const result =
    process.platform === "win32"
      ? spawnSync(process.env["ComSpec"] ?? "cmd.exe", ["/d", "/s", "/c", commandLine], {
          cwd: repoRoot,
          encoding: "utf8",
          stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
          env: process.env,
          windowsHide: true,
        })
      : spawnSync("pnpm", args, {
          cwd: repoRoot,
          encoding: "utf8",
          stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
          env: process.env,
        });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  return result;
}

function exitWith(result) {
  if (result.status !== 0) {
    if (result.stdout) {
      process.stdout.write(result.stdout);
    }
    if (result.stderr) {
      process.stderr.write(result.stderr);
    }
    process.exit(result.status ?? 1);
  }
}

function selectedPackageNames(args) {
  const result = runPnpm([...args, "list", "--depth", "-1"], { capture: true });
  const text = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.status !== 0) {
    process.stderr.write(text);
    process.exit(result.status ?? 1);
  }
  return text;
}

function assertSelected(text, expected, filterLabel) {
  const missing = expected.filter((name) => !text.includes(`${name}@`));
  if (missing.length > 0) {
    console.error(`Filter ${filterLabel} did not select: ${missing.join(", ")}`);
    console.error(text);
    process.exit(1);
  }
}

function build() {
  const libraries = selectedPackageNames([
    "--fail-if-no-match",
    "--filter",
    LIBRARY_FILTER,
  ]);
  assertSelected(libraries, LIBRARY_PACKAGES, LIBRARY_FILTER);
  console.log(`Library filter selected ${LIBRARY_PACKAGES.length} packages.`);

  exitWith(
    runPnpm(["--fail-if-no-match", "-r", "--filter", LIBRARY_FILTER, "run", "build"]),
  );
  exitWith(runPnpm(["--fail-if-no-match", "--filter", "@easypws/web", "run", "build"]));
  exitWith(runPnpm(["--fail-if-no-match", "--filter", "@easypws/api", "run", "build"]));
}

function typecheck() {
  const selected = selectedPackageNames([
    "--fail-if-no-match",
    "--filter",
    LIBRARY_FILTER,
    "--filter",
    APP_FILTER,
  ]);
  assertSelected(selected, [...LIBRARY_PACKAGES, ...APP_PACKAGES], `${LIBRARY_FILTER} + ${APP_FILTER}`);
  console.log("Typecheck filter selected every library and app package.");
  exitWith(
    runPnpm([
      "--fail-if-no-match",
      "-r",
      "--filter",
      LIBRARY_FILTER,
      "--filter",
      APP_FILTER,
      "run",
      "typecheck",
    ]),
  );
}

function test() {
  for (const name of TEST_PACKAGES) {
    const selected = selectedPackageNames(["--fail-if-no-match", "--filter", name]);
    assertSelected(selected, [name], name);
    exitWith(runPnpm(["--fail-if-no-match", "--filter", name, "run", "test"]));
  }
}

function lint() {
  const target = relative(repoRoot, process.cwd());
  const lintTarget = target.length === 0 ? "." : target;
  const require = createRequire(resolve(repoRoot, "package.json"));
  const eslintPackageJson = require.resolve("eslint/package.json");
  const eslintPackage = JSON.parse(readFileSync(eslintPackageJson, "utf8"));
  const binField = eslintPackage.bin;
  const binRelative = typeof binField === "string" ? binField : binField.eslint;
  const eslintEntry = join(dirname(eslintPackageJson), binRelative);
  const result = spawnSync(process.execPath, [eslintEntry, lintTarget], {
    cwd: repoRoot,
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

const command = process.argv[2];
switch (command) {
  case "build":
    build();
    break;
  case "typecheck":
    typecheck();
    break;
  case "test":
    test();
    break;
  case "lint":
    lint();
    break;
  default: {
    console.error("Usage: node scripts/workspace.mjs <build|typecheck|test|lint>");
    process.exit(1);
  }
}
