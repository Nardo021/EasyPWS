export interface ColesApiClientOptions {
  baseUrl?: string;
  subscriptionKey?: string;
  storeId?: string;
  userAgent?: string;
}

export class ColesApiClient {
  private readonly baseUrl: string;
  private readonly subscriptionKey: string;
  private readonly storeId: string;
  private readonly userAgent: string;

  constructor(options: ColesApiClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? "https://www.coles.com.au";
    this.subscriptionKey =
      options.subscriptionKey ??
      process.env["COLES_SUBSCRIPTION_KEY"] ??
      "eae83861d1cd4de6bb9cd8a2cd6f041e";
    this.storeId = options.storeId ?? process.env["COLES_STORE_ID"] ?? "647";
    this.userAgent =
      options.userAgent ??
      "Mozilla/5.0 (compatible; EasyPWS/0.1; +https://github.com/Nardo021/EasyPWS)";
  }

  get defaultStoreId(): string {
    return this.storeId;
  }

  async fetchProductJson(retailerProductId: string): Promise<unknown> {
    const url = new URL(`/api/bff/products/${encodeURIComponent(retailerProductId)}`, this.baseUrl);
    url.searchParams.set("storeId", this.storeId);

    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": this.userAgent,
        "Ocp-Apim-Subscription-Key": this.subscriptionKey,
      },
    });

    if (!response.ok) {
      throw new Error(`Coles BFF ${response.status} for product ${retailerProductId}`);
    }
    return response.json();
  }

  async searchJson(query: string, page = 1): Promise<unknown> {
    // Coles search via BFF-style endpoint used by the website.
    const url = new URL("/api/bff/products/search", this.baseUrl);
    url.searchParams.set("storeId", this.storeId);
    url.searchParams.set("searchTerm", query);
    url.searchParams.set("page", String(page));

    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": this.userAgent,
        "Ocp-Apim-Subscription-Key": this.subscriptionKey,
      },
    });

    if (!response.ok) {
      throw new Error(`Coles search ${response.status} for query ${query}`);
    }
    return response.json();
  }

  async ping(): Promise<{ latencyMs: number }> {
    const started = Date.now();
    const url = new URL("/api/bff/products/8737163", this.baseUrl);
    url.searchParams.set("storeId", this.storeId);
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": this.userAgent,
        "Ocp-Apim-Subscription-Key": this.subscriptionKey,
      },
    });
    if (!response.ok) {
      throw new Error(`Coles health check failed: ${response.status}`);
    }
    await response.json();
    return { latencyMs: Date.now() - started };
  }
}
