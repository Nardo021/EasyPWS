import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ProductService, WatchlistService } from "@easypws/services";
import { AuthGuard } from "./auth/auth.guard.js";
import { CurrentUser } from "./auth/current-user.decorator.js";
import type { AuthPrincipal } from "./auth/auth.types.js";
import { db } from "./db.js";

@Controller()
@UseGuards(AuthGuard)
export class ProductsController {
  private readonly products = new ProductService(db());
  private readonly watchlists = new WatchlistService(db());

  @Post("products/import")
  async importByUrl(
    @CurrentUser() user: AuthPrincipal,
    @Body()
    body: { url?: string; watchlistId?: string; targetPrice?: number },
  ) {
    if (!body.url) {
      throw new BadRequestException("url is required");
    }
    try {
      const imported = await this.products.importByUrl({
        url: body.url,
        userId: user.userId,
        watchlistId: body.watchlistId,
        targetPrice: body.targetPrice,
      });
      const watchlistItemId = await this.watchlists.addListing({
        userId: user.userId,
        listingId: imported.listingId,
        watchlistId: body.watchlistId,
        targetPrice: body.targetPrice,
      });
      return {
        ...imported,
        watchlistItemId,
        summary: await this.products.getListingSummary(imported.listingId),
      };
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : String(err));
    }
  }

  @Get("products/search")
  async search(
    @Query("q") q?: string,
    @Query("retailer") retailer?: "coles",
  ) {
    if (!q || q.trim().length < 2) {
      throw new BadRequestException("q must be at least 2 characters");
    }
    const results = await this.products.search(q.trim(), retailer ?? "coles");
    return { items: results };
  }
}
