import { Controller, Get, NotFoundException, Param, UseGuards } from "@nestjs/common";
import { ProductService, WatchlistService } from "@easypws/services";
import { AuthGuard } from "./auth/auth.guard.js";
import { db } from "./db.js";

@Controller("prices")
@UseGuards(AuthGuard)
export class PricesController {
  private readonly watchlists = new WatchlistService(db());
  private readonly products = new ProductService(db());

  @Get("listings/:listingId/history")
  async history(@Param("listingId") listingId: string) {
    const summary = await this.products.getListingSummary(listingId);
    if (!summary) {
      throw new NotFoundException("listing not found");
    }
    const points = await this.watchlists.priceHistory(listingId);
    return { listingId, summary, points };
  }
}
