import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { AuthTokenService, type AuthPrincipal } from "@easypws/services";
import { db } from "../db.js";

export const PRINCIPAL_KEY = "easypwsPrincipal";

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly tokens = new AuthTokenService(db());

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      [PRINCIPAL_KEY]?: AuthPrincipal;
    }>();
    const header = req.headers["authorization"] ?? "";
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match?.[1]) {
      throw new UnauthorizedException("Bearer token required");
    }
    const principal = await this.tokens.authenticate(match[1]);
    if (!principal) {
      throw new UnauthorizedException("Invalid token");
    }
    req[PRINCIPAL_KEY] = principal;
    return true;
  }
}
