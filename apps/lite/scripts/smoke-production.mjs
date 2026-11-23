import { createSign, generateKeyPairSync } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ACCESS_AUDIENCE, ACCESS_ISSUER, ACCESS_OWNER, verifyAccessJwt } from "../src/access.ts";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const persist = resolve(appDir, ".wrangler/production-smoke");
const devVars = resolve(appDir, ".dev.vars");
const base = "http://127.0.0.1:8789";
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = publicKey.export({ format: "jwk" });
jwk.kid = "local-test";
jwk.alg = "RS256";
const publicJwk = { kty: jwk.kty, n: jwk.n, e: jwk.e, kid: jwk.kid, alg: "RS256" };
const encodedJwk = Buffer.from(JSON.stringify(publicJwk)).toString("base64url");

function b64url(value) {
  return Buffer.from(value).toString("base64url");
}

function sign(key, payload, kid = "local-test") {
  const header = b64url(JSON.stringify({ alg: "RS256", kid, typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const data = `${header}.${body}`;
  const signature = createSign("RSA-SHA256").update(data).sign(key);
  return `${data}.${b64url(signature)}`;
}

const now = Math.floor(Date.now() / 1000);
const claims = {
  iss: ACCESS_ISSUER,
  aud: ACCESS_AUDIENCE,
  exp: now + 600,
  nbf: now - 10,
  email: ACCESS_OWNER,
  type: "app",
};
const keys = new Map([["local-test", publicJwk]]);
const ownerToken = sign(privateKey, claims);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function rejects(token) {
  try {
    await verifyAccessJwt(token, keys);
    return false;
  } catch {
    return true;
  }
}

assert((await verifyAccessJwt(ownerToken, keys)) === ACCESS_OWNER, "valid owner token was rejected");
assert(await rejects(sign(privateKey, { ...claims, email: "attacker@example.com" })), "forged email was accepted");
assert(await rejects(sign(privateKey, { ...claims, exp: now - 120 })), "expired token was accepted");
assert(await rejects(sign(privateKey, { ...claims, aud: "wrong" })), "wrong audience was accepted");
assert(await rejects(sign(privateKey, { ...claims, iss: "https://evil.example" })), "wrong issuer was accepted");
assert(await rejects(sign(other.privateKey, claims)), "token signed by another key was accepted");
assert(await rejects(`${b64url(JSON.stringify({ alg: "none", kid: "local-test" }))}.${b64url(JSON.stringify(claims))}.`), "none algorithm was accepted");

rmSync(persist, { recursive: true, force: true });
mkdirSync(persist, { recursive: true });
writeFileSync(
  devVars,
  `EASYPWS_RUNTIME=production\nEASYPWS_OMKAR_MODE=fixture\nEASYPWS_ACCESS_TEST_JWK=${encodedJwk}\n`,
  "utf8",
);

const migrated = spawnSync(
  "pnpm",
  ["exec", "wrangler", "d1", "migrations", "apply", "DB", "--local", "--persist-to", persist],
  { cwd: appDir, shell: true, stdio: "inherit" },
);
if (migrated.status !== 0) {
  process.exit(migrated.status ?? 1);
}

function start() {
  return spawn(
    "pnpm",
    ["exec", "wrangler", "dev", "--test-scheduled", "--port", "8789", "--ip", "127.0.0.1", "--persist-to", persist],
    { cwd: appDir, shell: true, stdio: "ignore" },
  );
}

function stop(child) {
  if (child.pid && process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { shell: true, stdio: "ignore" });
  } else if (child.pid) {
    child.kill("SIGTERM");
  }
}

async function waitReady() {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/`);
      if (response.status === 401) {
        return;
      }
    } catch {
      // Worker is still booting.
    }
    await new Promise((resolveSleep) => setTimeout(resolveSleep, 500));
  }
  throw new Error("production guard worker did not become ready");
}

async function read(path, headers) {
  const response = await fetch(`${base}${path}`, { headers });
  const text = await response.text();
  return { status: response.status, text };
}

const child = start();
try {
  await waitReady();
  const home = await read("/");
  assert(home.status === 401, "homepage was public without Access");
  assert(!home.text.includes("4.95") && !home.text.includes("Full Cream"), "public homepage returned fixture data");

  const forged = await read("/api/v1/auth/me", { "Cf-Access-Authenticated-User-Email": ACCESS_OWNER });
  assert(forged.status === 401, "email header authorized the request");
  assert(!forged.text.includes("private"), "forged header created a private session");

  const invalid = await read("/api/v1/products/search?q=milk", {
    "Cf-Access-Authenticated-User-Email": "attacker@example.com",
    "Cf-Access-Jwt-Assertion": "not.a.jwt",
  });
  assert(invalid.status === 401, "invalid token was accepted");
  assert(!invalid.text.includes("4.95") && !invalid.text.includes("Full Cream"), "invalid token returned a fixture price");

  const wrongKey = await read("/api/v1/auth/me", {
    "Cf-Access-Jwt-Assertion": sign(other.privateKey, claims),
    "Cf-Access-Authenticated-User-Email": ACCESS_OWNER,
  });
  assert(wrongKey.status === 401, "wrong signature was accepted");

  const me = await read("/api/v1/auth/me", {
    "Cf-Access-Jwt-Assertion": ownerToken,
    "Cf-Access-Authenticated-User-Email": "attacker@example.com",
  });
  const session = JSON.parse(me.text);
  assert(me.status === 200 && session.mode === "private", "valid owner token was rejected");
  assert(session.email === ACCESS_OWNER, "session used the forged email header");

  const health = await read("/api/v1/health", { "Cf-Access-Jwt-Assertion": ownerToken });
  const healthBody = JSON.parse(health.text);
  assert(health.status === 200 && healthBody.runtime === "production", "runtime was not production");
  assert(healthBody.mode === "unavailable", "fixture mode was used in production");
  assert(healthBody.externalRequests === 0, "production guard made an external request");

  const search = await read("/api/v1/products/search?q=milk", { "Cf-Access-Jwt-Assertion": ownerToken });
  assert(search.status === 503, "missing key did not fail closed");
  assert(!search.text.includes("4.95") && !search.text.includes("Full Cream"), "missing key returned fixture prices");

  console.log("lite production guard ok");
  console.log(`mode ${healthBody.mode}`);
  console.log(`externalRequests ${healthBody.externalRequests}`);
} finally {
  stop(child);
  writeFileSync(devVars, "EASYPWS_OMKAR_MODE=fixture\n", "utf8");
}
