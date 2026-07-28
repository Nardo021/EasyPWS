import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import type { ApiTokenScope } from "@easypws/contracts";
import { AuthTokenService } from "@easypws/services";
import { AuthGuard } from "./auth/auth.guard.js";
import { CurrentUser } from "./auth/current-user.decorator.js";
import type { AuthPrincipal } from "./auth/auth.types.js";
import { db } from "./db.js";

@Controller("tokens")
export class TokensController {
  private readonly tokens = new AuthTokenService(db());

  @Get()
  @UseGuards(AuthGuard)
  async list(@CurrentUser() user: AuthPrincipal) {
    return { items: await this.tokens.listTokens(user.userId) };
  }

  @Post()
  @UseGuards(AuthGuard)
  async create(
    @CurrentUser() user: AuthPrincipal,
    @Body() body: { name?: string; scopes?: ApiTokenScope[] },
  ) {
    if (!this.tokens.hasScope(user, "admin")) {
      throw new ForbiddenException("admin scope required");
    }
    return this.tokens.createToken({
      userId: user.userId,
      name: body.name ?? "api-token",
      scopes: body.scopes ?? ["read", "write"],
    });
  }

  @Post("rotate-bootstrap")
  @UseGuards(AuthGuard)
  async rotate(@CurrentUser() user: AuthPrincipal) {
    if (!this.tokens.hasScope(user, "admin")) {
      throw new ForbiddenException("admin scope required");
    }
    return this.tokens.rotateBootstrapTokens(user.userId);
  }

  /**
   * Recovery path when bootstrap token logs were lost.
   * Requires BOOTSTRAP_ROTATE_SECRET env; returns new tokens once.
   */
  @Post("recover")
  async recover(@Body() body: { secret?: string; email?: string }) {
    const expected = process.env["BOOTSTRAP_ROTATE_SECRET"];
    if (!expected || !body.secret || body.secret !== expected) {
      throw new ForbiddenException("invalid recover secret");
    }
    const email = body.email ?? process.env["BOOTSTRAP_EMAIL"] ?? "admin@easypws.local";
    const userId = await this.tokens.findUserIdByEmail(email);
    if (!userId) {
      throw new ForbiddenException("bootstrap user not found");
    }
    return this.tokens.rotateBootstrapTokens(userId);
  }

  @Post(":id/revoke")
  @UseGuards(AuthGuard)
  async revoke(@CurrentUser() user: AuthPrincipal, @Param("id") id: string) {
    if (!this.tokens.hasScope(user, "admin")) {
      throw new ForbiddenException("admin scope required");
    }
    await this.tokens.revokeToken(user.userId, id);
    return { ok: true };
  }
}
