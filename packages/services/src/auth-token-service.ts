import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { ApiTokenScope } from "@easypws/contracts";
import { createId } from "@easypws/core";
import {
  apiTokens,
  type Database,
  users,
} from "@easypws/database";

export interface AuthPrincipal {
  userId: string;
  email: string;
  tokenId: string;
  scopes: ApiTokenScope[];
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export class AuthTokenService {
  constructor(private readonly db: Database) {}

  async createToken(params: {
    userId: string;
    name: string;
    scopes: ApiTokenScope[];
  }): Promise<{ token: string; id: string }> {
    const token = `epws_${randomBytes(24).toString("base64url")}`;
    const id = createId("tok");
    await this.db.insert(apiTokens).values({
      id,
      userId: params.userId,
      name: params.name,
      scopes: params.scopes,
      tokenPrefix: token.slice(0, 12),
      tokenHash: hashToken(token),
    });
    return { token, id };
  }

  async authenticate(bearerToken: string): Promise<AuthPrincipal | null> {
    if (!bearerToken) {
      return null;
    }
    const tokenHash = hashToken(bearerToken);
    const rows = await this.db
      .select({
        tokenId: apiTokens.id,
        userId: apiTokens.userId,
        scopes: apiTokens.scopes,
        revokedAt: apiTokens.revokedAt,
        expiresAt: apiTokens.expiresAt,
        email: users.email,
        storedHash: apiTokens.tokenHash,
      })
      .from(apiTokens)
      .innerJoin(users, eq(users.id, apiTokens.userId))
      .where(and(eq(apiTokens.tokenHash, tokenHash), isNull(apiTokens.revokedAt)))
      .limit(1);

    const row = rows[0];
    if (!row) {
      return null;
    }
    const a = Buffer.from(row.storedHash);
    const b = Buffer.from(tokenHash);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return null;
    }
    if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
      return null;
    }

    await this.db
      .update(apiTokens)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiTokens.id, row.tokenId));

    return {
      userId: row.userId,
      email: row.email,
      tokenId: row.tokenId,
      scopes: (row.scopes ?? []) as ApiTokenScope[],
    };
  }

  hasScope(principal: AuthPrincipal, scope: ApiTokenScope): boolean {
    return principal.scopes.includes(scope) || principal.scopes.includes("admin");
  }

  async listTokens(userId: string) {
    const rows = await this.db
      .select({
        id: apiTokens.id,
        name: apiTokens.name,
        scopes: apiTokens.scopes,
        tokenPrefix: apiTokens.tokenPrefix,
        createdAt: apiTokens.createdAt,
        lastUsedAt: apiTokens.lastUsedAt,
        revokedAt: apiTokens.revokedAt,
      })
      .from(apiTokens)
      .where(eq(apiTokens.userId, userId));
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      scopes: r.scopes,
      tokenPrefix: r.tokenPrefix,
      createdAt: r.createdAt.toISOString(),
      lastUsedAt: r.lastUsedAt?.toISOString(),
      revoked: Boolean(r.revokedAt),
    }));
  }

  async revokeToken(userId: string, tokenId: string): Promise<void> {
    await this.db
      .update(apiTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiTokens.userId, userId), eq(apiTokens.id, tokenId)));
  }

  async findUserIdByEmail(email: string): Promise<string | null> {
    const row = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
    return row[0]?.id ?? null;
  }

  /** Rotate bootstrap admin + HA tokens (revokes previous non-revoked tokens with those names). */
  async rotateBootstrapTokens(userId: string): Promise<{
    bootstrapToken: string;
    haToken: string;
  }> {
    const existing = await this.db
      .select()
      .from(apiTokens)
      .where(and(eq(apiTokens.userId, userId), isNull(apiTokens.revokedAt)));
    for (const row of existing) {
      if (row.name === "Bootstrap admin" || row.name === "Home Assistant") {
        await this.db
          .update(apiTokens)
          .set({ revokedAt: new Date() })
          .where(eq(apiTokens.id, row.id));
      }
    }
    const bootstrap = await this.createToken({
      userId,
      name: "Bootstrap admin",
      scopes: ["read", "write", "admin"],
    });
    const ha = await this.createToken({
      userId,
      name: "Home Assistant",
      scopes: ["read", "write", "ha_integration"],
    });
    // Prefer epws_ha_ prefix for HA token readability
    return { bootstrapToken: bootstrap.token, haToken: ha.token };
  }
}
