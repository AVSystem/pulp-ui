// Reads a page number or a page size taken from the address of a screen. The
// address is editable, so the value can be text, `NaN`, a repeated parameter
// (an array), zero, negative or infinite. Anything that is not a whole number
// of at least one falls back to the default, so a mistyped address never
// reaches the server as `offset=NaN`. A repeated parameter counts by its first
// value. A fraction is cut to its whole part.
export function positiveInt(value: unknown, fallback: number): number {
  const first = Array.isArray(value) ? value[0] : value;
  const whole = Math.trunc(Number(first));

  return Number.isFinite(whole) && whole >= 1 ? whole : fallback;
}
