const API_BASE =
  process.env["NEXT_PUBLIC_API_URL"]?.replace(/\/$/, "") ?? "http://localhost:3001";

export function getStoredToken(): string {
  if (typeof window === "undefined") {
    return "";
  }
  return window.localStorage.getItem("easypws_token") ?? "";
}

export function setStoredToken(token: string): void {
  window.localStorage.setItem("easypws_token", token);
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const response = await fetch(`${API_BASE}/api/v1${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export interface WatchlistItem {
  watchlistItemId: string;
  listingId: string;
  productName: string;
  retailer: string;
  productUrl: string;
  currentPrice?: number;
  regularPrice?: number;
  discountPercentage?: number;
  historicalLow?: number;
  inStock: boolean;
  promotionType: string;
  monitoringStatus: string;
  targetPrice?: number;
  lastCheckedAt?: string;
  imageUrl?: string;
}

export interface PricePoint {
  observedAt: string;
  price: number;
  regularPrice?: number;
  promotionType: string;
}

export const easypwsApi = {
  listWatchlist: () => api<{ items: WatchlistItem[] }>("/watchlists/items"),
  importProduct: (url: string, targetPrice?: number) =>
    api("/products/import", {
      method: "POST",
      body: JSON.stringify({ url, targetPrice }),
    }),
  search: (q: string) =>
    api<{ items: Array<{ retailerProductId: string; name: string; productUrl: string; currentPrice?: number }> }>(
      `/products/search?q=${encodeURIComponent(q)}`,
    ),
  setStatus: (id: string, status: "active" | "paused") =>
    api(`/watchlists/items/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),
  remove: (id: string) =>
    api(`/watchlists/items/${id}`, { method: "DELETE" }),
  refresh: (id: string) =>
    api(`/watchlists/items/${id}/refresh`, { method: "POST" }),
  setTarget: (id: string, targetPrice: number) =>
    api(`/watchlists/items/${id}/target-price`, {
      method: "PATCH",
      body: JSON.stringify({ targetPrice }),
    }),
  history: (listingId: string) =>
    api<{ points: PricePoint[]; summary: WatchlistItem }>(
      `/prices/listings/${listingId}/history`,
    ),
};
