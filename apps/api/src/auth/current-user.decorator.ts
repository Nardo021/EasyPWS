import { createParamDecorator, ExecutionContext, UnauthorizedException } from "@nestjs/common";
import type { AuthPrincipal } from "@easypws/services";
import { PRINCIPAL_KEY } from "./auth.guard.js";

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthPrincipal => {
    const req = ctx.switchToHttp().getRequest<Record<string, unknown>>();
    const principal = req[PRINCIPAL_KEY] as AuthPrincipal | undefined;
    if (!principal) {
      throw new UnauthorizedException();
    }
    return principal;
  },
);
