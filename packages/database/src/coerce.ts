export function num(value: string | number | null | undefined): number | undefined {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export function numOrUndefined(
  value: string | number | null | undefined,
): number | undefined {
  return num(value);
}

export function toIso(value: Date | null | undefined): string | undefined {
  return value ? value.toISOString() : undefined;
}
