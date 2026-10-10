export interface Page<T> {
  items: T[];
  total: number;
  offset: number;
  count: number;
  hasMore: boolean;
}

export function buildPage<T>(items: T[], total: number, offset: number, count: number): Page<T> {
  return {
    items,
    total,
    offset,
    count: items.length,
    hasMore: offset + items.length < total,
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
