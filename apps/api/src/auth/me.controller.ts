import { Controller, Get, UseGuards } from "@nestjs/common";
import { AuthGuard } from "./auth.guard.js";
import { CurrentUser } from "./current-user.decorator.js";
import type { AuthPrincipal } from "./auth.types.js";

@Controller("auth")
@UseGuards(AuthGuard)
export class MeController {
  @Get("me")
  me(@CurrentUser() user: AuthPrincipal) {
    return {
      userId: user.userId,
      email: user.email,
      scopes: user.scopes,
      tokenId: user.tokenId,
    };
  }
}
