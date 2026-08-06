export interface Watchlist {
  id: string;
  userId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export type WatchlistItemStatus = "active" | "paused" | "removed";

export interface WatchlistItem {
  id: string;
  watchlistId: string;
  listingId: string;
  status: WatchlistItemStatus;
  targetPrice?: number;
  createdAt: string;
  updatedAt: string;
}
