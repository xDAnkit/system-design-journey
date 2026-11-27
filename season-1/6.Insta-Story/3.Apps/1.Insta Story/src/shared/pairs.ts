import type { Model } from "mongoose";

const DUPLICATE_KEY = 11000;

// For likes and follows: one row per pair, unique index on the pair.
// A batch can hold "add" and "remove" for the same pair. Only the last one decides the end state, and counters move
// only by rows that really changed, so collapsing to the last event per pair gives the same counts.
export interface PairResult<E> {
  adds: E[]; // pairs whose last event is "add" (already there or not)
  added: E[]; // pairs really inserted now
  removed: E[]; // pairs that existed and were deleted now
}

export const applyPairs = async <E>(
  model: Model<any>, // eslint-disable-line @typescript-eslint/no-explicit-any
  events: E[],
  isAdd: (e: E) => boolean,
  doc: (e: E) => Record<string, unknown>, // the two pair fields
): Promise<PairResult<E>> => {
  const keyOf = (d: Record<string, unknown>): string => Object.values(d).map(String).join(":");
  const last = new Map<string, E>();
  for (const e of events) {
    const k = keyOf(doc(e));
    last.delete(k);
    last.set(k, e);
  }
  const adds = [...last.values()].filter(isAdd);
  const dels = [...last.values()].filter((e) => !isAdd(e));

  // one insertMany, unordered: a duplicate fails alone, the rest still go in
  let added = adds;
  if (adds.length > 0) {
    const now = new Date();
    try {
      await model.collection.insertMany(adds.map((e) => ({ ...doc(e), createdAt: now })), { ordered: false });
    } catch (err) {
      const raw = (err as { writeErrors?: unknown }).writeErrors;
      const writeErrors = (Array.isArray(raw) ? raw : raw ? [raw] : []) as Array<{ index: number; code: number }>;
      if (writeErrors.length === 0 || writeErrors.some((w) => w.code !== DUPLICATE_KEY)) throw err;
      const dup = new Set(writeErrors.map((w) => w.index));
      added = adds.filter((_, i) => !dup.has(i));
    }
  }

  // find which pairs really exist, delete those in one call
  let removed: E[] = [];
  if (dels.length > 0) {
    const fields = Object.keys(doc(dels[0]));
    const projection = Object.fromEntries(fields.map((f) => [f, 1]));
    const rows = await model.collection.find({ $or: dels.map(doc) }, { projection }).toArray();
    if (rows.length > 0) {
      await model.collection.deleteMany({ _id: { $in: rows.map((r) => r._id) } });
      const gone = new Set(rows.map((r) => fields.map((f) => String(r[f])).join(":")));
      removed = dels.filter((e) => gone.has(keyOf(doc(e))));
    }
  }
  return { adds, added, removed };
};
