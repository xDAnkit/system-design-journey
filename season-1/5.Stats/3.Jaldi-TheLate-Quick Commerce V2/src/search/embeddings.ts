// One vector per unique text, shared by every product with that text. Seeded variants of one base item
// share a vector, so 2 lakh products need ~150 vectors and a model switch re-embeds only those.
import mongoose, { Schema } from "mongoose";
import { ai } from "../ai/index.js";
import type { TagSet } from "../ai/tagging/tag.types.js";
import { sha1 } from "../shared/text.js";

interface EmbeddingDoc {
  _id: string;
  model: string;
  dims: number;
  /** float32, little endian */
  vector: Buffer;
  createdAt: Date;
}

const embeddingSchema = new Schema<EmbeddingDoc>(
  {
    _id: { type: String, required: true },
    model: { type: String, required: true },
    dims: { type: Number, required: true },
    vector: { type: Buffer, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false },
);

export const EmbeddingModel = mongoose.model<EmbeddingDoc>("Embedding", embeddingSchema, "embeddings");

export const toBuffer = (v: number[]): Buffer => Buffer.from(new Float32Array(v).buffer);

/** Buffer, or the bson Binary that .lean() returns, back to numbers. Copied first: Float32Array needs 4-byte alignment. */
export const fromStored = (value: unknown): number[] => {
  const bytes = value instanceof Uint8Array ? value : (value as { buffer?: Uint8Array })?.buffer;
  if (!(bytes instanceof Uint8Array)) return [];
  return Array.from(new Float32Array(Uint8Array.from(bytes).buffer));
};

/** Text that becomes a product's vector: name + every tag. The bake-off showed all 12 scripts beat English only (80.8% vs 47.6%). */
export const productEmbedText = (name: string, tags: TagSet): string =>
  [name, tags.en.join(", "), tags.hinglish.join(", "), Object.values(tags.native).flat().join(", ")].filter(Boolean).join(" | ");

export const embeddingKey = (text: string): string => `${ai.embedModelId()}:${sha1(text)}`;

/** Vectors for texts: stored ones are reused, missing ones are embedded and saved. */
export async function getOrCreateEmbeddings(texts: string[]): Promise<Map<string, { key: string; vector: number[] }>> {
  const unique = [...new Set(texts)];
  const keyOf = new Map(unique.map((t) => [t, embeddingKey(t)]));
  const found = await EmbeddingModel.find({ _id: { $in: [...keyOf.values()] } }).lean();
  const byKey = new Map(found.map((d) => [d._id, fromStored(d.vector)]));

  const missing = unique.filter((t) => !byKey.has(keyOf.get(t)!));
  if (missing.length) {
    const vectors = await ai.embed(missing, "document");
    const model = ai.embedModelId();
    const docs = missing.map((t, i) => ({ _id: keyOf.get(t)!, model, dims: vectors[i].length, vector: toBuffer(vectors[i]), createdAt: new Date() }));
    // ordered:false + ignore duplicates: two workers may embed the same text at the same time
    await EmbeddingModel.insertMany(docs, { ordered: false }).catch((err: { code?: number; writeErrors?: Array<{ code?: number }> }) => {
      const onlyDuplicates = err.code === 11000 || (err.writeErrors ?? []).every((e) => e.code === 11000);
      if (!onlyDuplicates) throw err;
    });
    missing.forEach((t, i) => byKey.set(keyOf.get(t)!, vectors[i]));
  }

  return new Map(unique.map((t) => [t, { key: keyOf.get(t)!, vector: byKey.get(keyOf.get(t)!)! }]));
}

/** Stored vectors by key (index worker, reindex). Keys of another embedding model are simply not used. */
export async function vectorsByKeys(keys: string[]): Promise<Map<string, number[]>> {
  const unique = [...new Set(keys.filter(Boolean))];
  if (!unique.length) return new Map();
  const docs = await EmbeddingModel.find({ _id: { $in: unique } }).lean();
  return new Map(docs.map((d) => [d._id, fromStored(d.vector)]));
}
