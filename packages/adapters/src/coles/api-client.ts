export interface ColesApiClientOptions {
  baseUrl?: string;
  subscriptionKey?: string;
  storeId?: string;
  userAgent?: string;
  maxRetries?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ColesApiClient {
  private readonly baseUrl: string;
  private readonly subscriptionKey: string;
  private readonly storeId: string;
  private readonly userAgent: string;
  private readonly maxRetries: number;

  constructor(options: ColesApiClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? "https://www.coles.com.au";
    this.subscriptionKey =
      options.subscriptionKey ??
      process.env["COLES_SUBSCRIPTION_KEY"] ??
      "eae83861d1cd4de6bb9cd8a2cd6f041e";
    this.storeId = options.storeId ?? process.env["COLES_STORE_ID"] ?? "647";
    this.userAgent =
      options.userAgent ??
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    this.maxRetries = options.maxRetries ?? 3;
  }

  get defaultStoreId(): string {
    return this.storeId;
  }

  async fetchProductJson(retailerProductId: string): Promise<unknown> {
    const url = new URL(`/api/bff/products/${encodeURIComponent(retailerProductId)}`, this.baseUrl);
    url.searchParams.set("storeId", this.storeId);
    return this.requestJson(url, `product ${retailerProductId}`);
  }

  async searchJson(query: string, page = 1): Promise<unknown> {
    const url = new URL("/api/bff/products/search", this.baseUrl);
    url.searchParams.set("storeId", this.storeId);
    url.searchParams.set("searchTerm", query);
    url.searchParams.set("page", String(page));
    return this.requestJson(url, `search ${query}`);
  }

  async ping(): Promise<{ latencyMs: number }> {
    const started = Date.now();
    await this.fetchProductJson("8737163");
    return { latencyMs: Date.now() - started };
  }

  private async requestJson(url: URL, label: string): Promise<unknown> {
    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        const response = await fetch(url, {
          headers: {
            Accept: "application/json",
            "User-Agent": this.userAgent,
            "Ocp-Apim-Subscription-Key": this.subscriptionKey,
            Origin: this.baseUrl,
            Referer: `${this.baseUrl}/`,
          },
        });

        if (response.status === 429 || response.status === 503) {
          const retryAfter = Number(response.headers.get("retry-after") ?? "");
          const delayMs = Number.isFinite(retryAfter)
            ? retryAfter * 1000
            : 500 * 2 ** attempt;
          lastError = new Error(`Coles ${response.status} for ${label}`);
          if (attempt < this.maxRetries) {
            await sleep(delayMs);
            continue;
          }
          throw lastError;
        }

        if (!response.ok) {
          throw new Error(`Coles HTTP ${response.status} for ${label}`);
        }

        const contentType = response.headers.get("content-type") ?? "";
        const text = await response.text();
        if (
          !contentType.includes("application/json") ||
          text.trimStart().startsWith("<") ||
          text.includes("Incapsula") ||
          text.includes("_Incapsula_Resource")
        ) {
          throw new Error(
            `Coles returned non-JSON / bot challenge for ${label}. Try again later or adjust egress.`,
          );
        }

        try {
          return JSON.parse(text) as unknown;
        } catch {
          throw new Error(`Coles returned invalid JSON for ${label}`);
        }
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const retryable =
          lastError.message.includes("429") ||
          lastError.message.includes("503") ||
          lastError.message.includes("fetch failed");
        if (!retryable || attempt >= this.maxRetries) {
          throw lastError;
        }
        await sleep(500 * 2 ** attempt);
      }
    }
    throw lastError ?? new Error(`Coles request failed for ${label}`);
  }
}
