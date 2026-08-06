import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { enqueuePriceCheck, WatchlistService } from "@easypws/services";
import { AuthGuard } from "./auth/auth.guard.js";
import { CurrentUser } from "./auth/current-user.decorator.js";
import type { AuthPrincipal } from "./auth/auth.types.js";
import { db } from "./db.js";

const REFRESH_COOLDOWN_MS = Number(process.env["MANUAL_REFRESH_COOLDOWN_MS"] ?? 60_000);
const lastManualRefresh = new Map<string, number>();

@Controller("watchlists")
@UseGuards(AuthGuard)
export class WatchlistsController {
  private readonly watchlists = new WatchlistService(db());

  @Get("items")
  async list(@CurrentUser() user: AuthPrincipal) {
    return { items: await this.watchlists.listItems(user.userId) };
  }

  @Patch("items/:id/status")
  async status(
    @CurrentUser() user: AuthPrincipal,
    @Param("id") id: string,
    @Body() body: { status?: "active" | "paused" },
  ) {
    if (body.status !== "active" && body.status !== "paused") {
      throw new BadRequestException("status must be active or paused");
    }
    await this.watchlists.setStatus(user.userId, id, body.status);
    return { ok: true };
  }

  @Patch("items/:id/target-price")
  async targetPrice(
    @CurrentUser() user: AuthPrincipal,
    @Param("id") id: string,
    @Body() body: { targetPrice?: number },
  ) {
    if (typeof body.targetPrice !== "number") {
      throw new BadRequestException("targetPrice is required");
    }
    await this.watchlists.setTargetPrice(user.userId, id, body.targetPrice);
    return { ok: true };
  }

  @Post("items/:id/refresh")
  async refresh(@CurrentUser() user: AuthPrincipal, @Param("id") id: string) {
    const items = await this.watchlists.listItems(user.userId);
    const item = items.find((i) => i.watchlistItemId === id);
    if (!item) {
      throw new BadRequestException("item not found");
    }
    const key = `${user.userId}:${item.listingId}`;
    const last = lastManualRefresh.get(key) ?? 0;
    const elapsed = Date.now() - last;
    if (elapsed < REFRESH_COOLDOWN_MS) {
      throw new BadRequestException(
        `Manual refresh rate-limited. Retry in ${Math.ceil((REFRESH_COOLDOWN_MS - elapsed) / 1000)}s`,
      );
    }
    lastManualRefresh.set(key, Date.now());
    await enqueuePriceCheck(item.listingId, { priority: 1 });
    return { ok: true, listingId: item.listingId };
  }

  @Delete("items/:id")
  async remove(@CurrentUser() user: AuthPrincipal, @Param("id") id: string) {
    await this.watchlists.removeItem(user.userId, id);
    return { ok: true };
  }

  @Post("rules")
  async createRule(
    @CurrentUser() user: AuthPrincipal,
    @Body()
    body: {
      watchlistItemId?: string;
      type?: string;
      operator?: string;
      value?: number;
      cooldownHours?: number;
      enabled?: boolean;
    },
  ) {
    if (!body.watchlistItemId || !body.type || !body.operator) {
      throw new BadRequestException("watchlistItemId, type, operator required");
    }
    const id = await this.watchlists.createRule({
      userId: user.userId,
      watchlistItemId: body.watchlistItemId,
      type: body.type as never,
      operator: body.operator as never,
      value: body.value,
      cooldownHours: body.cooldownHours,
      enabled: body.enabled,
    });
    return { id };
  }
}
