export const MAX_LIMIT = 100;
export const DEFAULT_LIMIT = 20;

export const parseLimit = (raw: unknown): number => {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.trunc(n), MAX_LIMIT);
};

// cursor = last _id of previous page; ObjectId is monotonically increasing so it's a stable sort key
export const buildCursorFilter = (cursor: unknown): Record<string, unknown> => {
  if (typeof cursor !== "string" || !cursor) return {};
  return { _id: { $gt: cursor } };
};

export const buildNextCursor = <T extends { _id: unknown }>(items: T[], limit: number): string | null => {
  if (items.length < limit) return null;
  return String(items[items.length - 1]._id);
};

export const parsePage = (raw: unknown): number => {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.trunc(n);
};
