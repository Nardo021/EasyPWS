/**
 * Coles HTTP/JSON client placeholder.
 * Prefer official/internal JSON endpoints before HTML or Playwright.
 */
export class ColesApiClient {
  constructor(private readonly baseUrl = "https://www.coles.com.au") {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async fetchProductJson(_retailerProductId: string): Promise<unknown> {
    throw new Error("ColesApiClient.fetchProductJson not implemented");
  }
}
