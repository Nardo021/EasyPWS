import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  UseGuards,
} from "@nestjs/common";
import {
  enqueuePriceCheck,
  HaSummaryService,
  ProductService,
  WatchlistService,
} from "@easypws/services";
import { AuthGuard } from "./auth/auth.guard.js";
import { CurrentUser } from "./auth/current-user.decorator.js";
import type { AuthPrincipal } from "./auth/auth.types.js";
import { db } from "./db.js";

@Controller("ha")
@UseGuards(AuthGuard)
export class HaController {
  private readonly summary = new HaSummaryService(db());
  private readonly products = new ProductService(db());
  private readonly watchlists = new WatchlistService(db());

  @Get("summary")
  async getSummary(@CurrentUser() user: AuthPrincipal) {
    return this.summary.summarize(user.userId);
  }

  @Post("add_product")
  async addProduct(
    @CurrentUser() user: AuthPrincipal,
    @Body() body: { url?: string; target_price?: number },
  ) {
    if (!body.url) {
      throw new BadRequestException("url required");
    }
    const imported = await this.products.importByUrl({
      url: body.url,
      userId: user.userId,
      targetPrice: body.target_price,
    });
    const watchlistItemId = await this.watchlists.addListing({
      userId: user.userId,
      listingId: imported.listingId,
      targetPrice: body.target_price,
    });
    return { listingId: imported.listingId, watchlistItemId };
  }

  @Post("remove_product")
  async removeProduct(
    @CurrentUser() user: AuthPrincipal,
    @Body() body: { listing_id?: string; watchlist_item_id?: string },
  ) {
    const items = await this.watchlists.listItems(user.userId);
    const item = items.find(
      (i) =>
        i.watchlistItemId === body.watchlist_item_id ||
        i.listingId === body.listing_id,
    );
    if (!item) {
      throw new BadRequestException("product not found");
    }
    await this.watchlists.removeItem(user.userId, item.watchlistItemId);
    return { ok: true };
  }

  @Post("pause_product")
  async pause(
    @CurrentUser() user: AuthPrincipal,
    @Body() body: { listing_id?: string; watchlist_item_id?: string },
  ) {
    const item = await this.findItem(user.userId, body);
    await this.watchlists.setStatus(user.userId, item.watchlistItemId, "paused");
    return { ok: true };
  }

  @Post("resume_product")
  async resume(
    @CurrentUser() user: AuthPrincipal,
    @Body() body: { listing_id?: string; watchlist_item_id?: string },
  ) {
    const item = await this.findItem(user.userId, body);
    await this.watchlists.setStatus(user.userId, item.watchlistItemId, "active");
    return { ok: true };
  }

  @Post("refresh_product")
  async refresh(
    @CurrentUser() user: AuthPrincipal,
    @Body() body: { listing_id?: string; watchlist_item_id?: string },
  ) {
    const item = await this.findItem(user.userId, body);
    await enqueuePriceCheck(item.listingId, { priority: 1 });
    return { ok: true };
  }

  @Post("set_target_price")
  async setTarget(
    @CurrentUser() user: AuthPrincipal,
    @Body()
    body: { listing_id?: string; watchlist_item_id?: string; target_price?: number },
  ) {
    if (typeof body.target_price !== "number") {
      throw new BadRequestException("target_price required");
    }
    const item = await this.findItem(user.userId, body);
    await this.watchlists.setTargetPrice(user.userId, item.watchlistItemId, body.target_price);
    return { ok: true };
  }

  private async findItem(
    userId: string,
    body: { listing_id?: string; watchlist_item_id?: string },
  ) {
    const items = await this.watchlists.listItems(userId);
    const item = items.find(
      (i) =>
        i.watchlistItemId === body.watchlist_item_id ||
        i.listingId === body.listing_id,
    );
    if (!item) {
      throw new BadRequestException("product not found");
    }
    return item;
  }
}
