/**
 * Shared domain helpers (IDs, money, URL helpers).
 * Business services live in apps/api; keep this package thin.
 */

export function assertNever(value: never, message = "Unexpected value"): never {
  throw new Error(`${message}: ${String(value)}`);
}

/** Simple ULID-like placeholder; replace with proper ULID library in implementation. */
export function createId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 10);
  const time = Date.now().toString(36);
  return `${prefix}_${time}${random}`;
}

export function roundMoney(amount: number): number {
  return Math.round(amount * 100) / 100;
}

export function discountPercentage(
  regularPrice: number | undefined,
  currentPrice: number,
): number | undefined {
  if (
    regularPrice === undefined ||
    regularPrice <= 0 ||
    !Number.isFinite(currentPrice) ||
    currentPrice >= regularPrice
  ) {
    return undefined;
  }
  return roundMoney(((regularPrice - currentPrice) / regularPrice) * 100);
}

export function isHalfPrice(
  regularPrice: number | undefined,
  currentPrice: number,
  tolerance = 0.02,
): boolean {
  if (regularPrice === undefined || regularPrice <= 0) {
    return false;
  }
  const ratio = currentPrice / regularPrice;
  return Math.abs(ratio - 0.5) <= tolerance;
}
