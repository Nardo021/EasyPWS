import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import type { ApiTokenScope } from "@easypws/contracts";
import { AuthTokenService } from "@easypws/services";
import { AuthGuard } from "./auth/auth.guard.js";
import { CurrentUser } from "./auth/current-user.decorator.js";
import type { AuthPrincipal } from "./auth/auth.types.js";
import { db } from "./db.js";

@Controller("tokens")
@UseGuards(AuthGuard)
export class TokensController {
  private readonly tokens = new AuthTokenService(db());

  @Post()
  async create(
    @CurrentUser() user: AuthPrincipal,
    @Body() body: { name?: string; scopes?: ApiTokenScope[] },
  ) {
    if (!user.scopes.includes("admin")) {
      return { error: "admin scope required" };
    }
    return this.tokens.createToken({
      userId: user.userId,
      name: body.name ?? "api-token",
      scopes: body.scopes ?? ["read", "write"],
    });
  }
}
