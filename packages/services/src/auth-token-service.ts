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
}
