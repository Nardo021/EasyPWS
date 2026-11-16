import type { Env } from "./catalogue.js";

export const ACCESS_ISSUER = "https://leo728.cloudflareaccess.com";
export const ACCESS_AUDIENCE = "e4b280e1e4796c7a896a29737dd5817f26ba6128f9dccac0c9744dffa72ad3f9";
export const ACCESS_OWNER = "yanze.shi@outlook.com";

const CERTS_URL = `${ACCESS_ISSUER}/cdn-cgi/access/certs`;
const CLOCK_SKEW_SECONDS = 60;

export class AccessError extends Error {
  constructor() {
    super("需要 Cloudflare Access 登录");
  }
}

class AccessKeyMiss extends AccessError {}

interface AccessJwk {
  kty?: string;
  n?: string;
  e?: string;
  alg?: string;
  kid?: string;
}

interface AccessClaims {
  iss?: unknown;
  aud?: unknown;
  exp?: unknown;
  nbf?: unknown;
  email?: unknown;
  type?: unknown;
}

let cachedKeys: { at: number; keys: Map<string, AccessJwk> } | null = null;

function decodeBase64Url(input: string): Uint8Array<ArrayBuffer> {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (input.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function decodeJson<T>(input: string): T {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(input))) as T;
}

function audienceMatches(audience: unknown): boolean {
  if (typeof audience === "string") {
    return audience === ACCESS_AUDIENCE;
  }
  return Array.isArray(audience) && audience.some((item) => item === ACCESS_AUDIENCE);
}

function ownerEmail(value: unknown): string {
  if (typeof value !== "string") {
    throw new AccessError();
  }
  const email = value.trim().toLowerCase();
  if (email !== ACCESS_OWNER) {
    throw new AccessError();
  }
  return email;
}

export async function verifyAccessJwt(token: string, keys: ReadonlyMap<string, AccessJwk>): Promise<string> {
  const parts = token.split(".");
  if (parts.length !== 3 || token.length > 8000) {
    throw new AccessError();
  }
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  if (!encodedHeader || !encodedPayload || !encodedSignature) {
    throw new AccessError();
  }
  let header: { alg?: unknown; kid?: unknown };
  let payload: AccessClaims;
  try {
    header = decodeJson(encodedHeader);
    payload = decodeJson(encodedPayload);
  } catch {
    throw new AccessError();
  }
  if (header.alg !== "RS256" || typeof header.kid !== "string") {
    throw new AccessError();
  }
  const jwk = keys.get(header.kid);
  if (!jwk || jwk.kty !== "RSA" || typeof jwk.n !== "string" || typeof jwk.e !== "string") {
    throw new AccessKeyMiss();
  }
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      "jwk",
      { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256" },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
  } catch {
    throw new AccessError();
  }
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    decodeBase64Url(encodedSignature),
    new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`),
  );
  if (!valid) {
    throw new AccessError();
  }
  const now = Math.floor(Date.now() / 1000);
  if (payload.iss !== ACCESS_ISSUER || !audienceMatches(payload.aud) || payload.type !== "app") {
    throw new AccessError();
  }
  if (typeof payload.exp !== "number" || payload.exp + CLOCK_SKEW_SECONDS < now) {
    throw new AccessError();
  }
  if (typeof payload.nbf === "number" && payload.nbf - CLOCK_SKEW_SECONDS > now) {
    throw new AccessError();
  }
  return ownerEmail(payload.email);
}

async function cloudflareKeys(): Promise<Map<string, AccessJwk>> {
  if (cachedKeys && Date.now() - cachedKeys.at < 60 * 60 * 1000) {
    return cachedKeys.keys;
  }
  const response = await fetch(CERTS_URL);
  if (!response.ok) {
    throw new AccessError();
  }
  const body = (await response.json()) as { keys?: AccessJwk[] };
  const keys = new Map<string, AccessJwk>();
  for (const key of body.keys ?? []) {
    if (typeof key.kid === "string" && key.kty === "RSA" && (key.alg === undefined || key.alg === "RS256")) {
      keys.set(key.kid, key);
    }
  }
  if (keys.size === 0) {
    throw new AccessError();
  }
  cachedKeys = { at: Date.now(), keys };
  return keys;
}

function loopbackTestKeys(request: Request, env: Env): Map<string, AccessJwk> | null {
  const host = new URL(request.url).hostname;
  const encoded = env.EASYPWS_ACCESS_TEST_JWK?.trim() ?? "";
  if ((host !== "127.0.0.1" && host !== "localhost") || encoded.length === 0) {
    return null;
  }
  try {
    const jwk = JSON.parse(new TextDecoder().decode(decodeBase64Url(encoded))) as AccessJwk;
    if (typeof jwk.kid !== "string" || jwk.kty !== "RSA") {
      return null;
    }
    return new Map([[jwk.kid, jwk]]);
  } catch {
    return null;
  }
}

async function emailFromContext(ctx: ExecutionContext): Promise<string | null> {
  if (!ctx.access) {
    return null;
  }
  if (ctx.access.aud !== ACCESS_AUDIENCE) {
    throw new AccessError();
  }
  try {
    const identity = await ctx.access.getIdentity();
    const email = identity?.email?.trim() ?? "";
    if (email.length === 0) {
      return null;
    }
    return ownerEmail(email);
  } catch (error) {
    if (error instanceof AccessError) {
      throw error;
    }
    return null;
  }
}

function accessToken(request: Request): string {
  const header = request.headers.get("Cf-Access-Jwt-Assertion")?.trim() ?? "";
  if (header.length > 0) {
    return header;
  }
  const cookie = request.headers.get("cookie")?.match(/(?:^|;\s*)CF_Authorization=([^;]+)/)?.[1] ?? "";
  if (cookie.length === 0) {
    return "";
  }
  try {
    return decodeURIComponent(cookie).trim();
  } catch {
    return cookie.trim();
  }
}

/** Production identity comes from ctx.access or a validated Access JWT, never from the email header. */
export async function requireOwner(request: Request, env: Env, ctx: ExecutionContext): Promise<string> {
  const contextual = await emailFromContext(ctx);
  if (contextual) {
    return contextual;
  }
  const token = accessToken(request);
  if (token.length === 0) {
    throw new AccessError();
  }
  const testKeys = loopbackTestKeys(request, env);
  const keys = testKeys ?? (await cloudflareKeys());
  try {
    return await verifyAccessJwt(token, keys);
  } catch (error) {
    if (error instanceof AccessKeyMiss && !testKeys) {
      cachedKeys = null;
      return verifyAccessJwt(token, await cloudflareKeys());
    }
    if (error instanceof AccessError) {
      throw error;
    }
    throw new AccessError();
  }
}
