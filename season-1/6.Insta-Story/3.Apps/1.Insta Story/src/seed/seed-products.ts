import "../bootstrap/mongo-host-dns.js";
import assert from "node:assert";
import os from "node:os";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import { connectDatabase, disconnectDatabase } from "../bootstrap/database.js";
import { logger } from "../bootstrap/logger.js";
import type { ProductDocument } from "../features/products/products.types.js";

const DEFAULT_BATCH_SIZE = 5000;
// ponytail: machine-aware default via stdlib — batch size stays fixed (bottleneck is the
// DB/network, not client CPU), but concurrency scales with cores since generating the fake
// docs per batch is CPU-bound. Both stay overridable via flags for a specific deployment.
const defaultConcurrency = (): number => Math.min(os.availableParallelism(), 8);

const parseIntFlag = (name: string): number | undefined => {
  const flag = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  if (!flag) return undefined;

  const value = Number(flag.split("=")[1]);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid --${name} value: ${flag}`);
  }

  return Math.floor(value);
};

// --collection=<name> seeds another collection. It keeps only the _id index (the category
// index is rebuilt for "products" only). Default stays "products".
const COLLECTION = process.argv.find((a) => a.startsWith("--collection="))?.split("=")[1] || "products";
const IS_DEFAULT_COLLECTION = COLLECTION === "products";

const BATCH_SIZE = parseIntFlag("batch-size") ?? DEFAULT_BATCH_SIZE;
const CONCURRENCY = parseIntFlag("concurrency") ?? defaultConcurrency();
const PROGRESS_EVERY_N_BATCHES = 20;

const COUNT_OPTIONS: Record<string, number> = {
  "1": 1_000_000,
  "2": 4_000_000,
  "3": 6_000_000,
  "4": 10_000_000,
};

/**
 * Splits `total` documents into an array of batch sizes, each at most `batchSize`,
 * summing exactly to `total` (last batch carries the remainder).
 */
export const planBatches = (total: number, batchSize: number): number[] => {
  if (total <= 0 || batchSize <= 0) return [];

  const batches: number[] = [];
  let remaining = total;

  while (remaining > 0) {
    const size = Math.min(batchSize, remaining);
    batches.push(size);
    remaining -= size;
  }

  return batches;
};

// ponytail: hand-rolled fake data from plain arrays + Math.random() instead of a
// fake-data library (e.g. faker) — per-record overhead of a library adds up fast
// at 10M-record scale, plain array lookups are effectively free by comparison.
const ADJECTIVES = [
  "Premium", "Compact", "Wireless", "Smart", "Portable", "Classic", "Ultra",
  "Eco", "Rugged", "Sleek", "Advanced", "Everyday", "Pro", "Lightweight", "Deluxe",
];
const NOUNS = [
  "Blender", "Headphones", "Backpack", "Sneakers", "Watch", "Speaker", "Charger",
  "Monitor", "Keyboard", "Jacket", "Bottle", "Lamp", "Chair", "Camera", "Router",
];
const CATEGORIES = [
  "Electronics", "Fashion", "Home & Kitchen", "Sports", "Books", "Beauty",
  "Toys", "Grocery", "Automotive", "Furniture",
];
const IMAGE_IDS = [101, 102, 103, 104, 105, 106, 107, 108, 109, 110];

interface SeedProduct {
  name: string;
  description: string;
  price: number;
  stock: number;
  category: string;
  imageUrl: string;
  createdAt: Date;
  updatedAt: Date;
}

const generateProduct = (index: number): SeedProduct => {
  const adjective = ADJECTIVES[index % ADJECTIVES.length];
  const noun = NOUNS[(index * 7) % NOUNS.length];
  const category = CATEGORIES[(index * 13) % CATEGORIES.length];
  const imageId = IMAGE_IDS[index % IMAGE_IDS.length];
  const now = new Date();

  return {
    name: `${adjective} ${noun} #${index}`,
    description: `${adjective} ${noun} in the ${category} category - built for everyday use.`,
    price: Math.round((Math.random() * 49_000 + 100) * 100) / 100,
    stock: Math.floor(Math.random() * 1000),
    category,
    imageUrl: `https://picsum.photos/seed/${imageId}-${index}/400/400`,
    createdAt: now,
    updatedAt: now,
  };
};

const parseCountFlag = (): number | undefined => {
  const flag = process.argv.find((arg) => arg.startsWith("--count="));
  if (!flag) return undefined;

  const value = Number(flag.split("=")[1]);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid --count value: ${flag}`);
  }

  return Math.floor(value);
};

const promptForCount = async (): Promise<number> => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    console.log("\nHow many products do you want to seed?");
    console.log("  1) 1 Million        (10,00,000)");
    console.log("  2) 4 Million        (40,00,000)");
    console.log("  3) 6 Million        (60,00,000)");
    console.log("  4) 10 Million / 1 Crore (1,00,00,000) [default]");
    console.log("  5) Custom (number enter karo)");

    const choice = (await rl.question("Enter choice [1-5] (default 4): ")).trim();

    if (choice === "" || choice === "4") return COUNT_OPTIONS["4"];
    if (choice in COUNT_OPTIONS) return COUNT_OPTIONS[choice];

    if (choice === "5") {
      const custom = (await rl.question("Enter exact number of products: ")).trim();
      const value = Number(custom);
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`Invalid custom count: ${custom}`);
      }
      return Math.floor(value);
    }

    logger.warn(`Unrecognized choice "${choice}", falling back to default (10,000,000)`);
    return COUNT_OPTIONS["4"];
  } finally {
    rl.close();
  }
};

const resolveCount = async (): Promise<number> => {
  const fromFlag = parseCountFlag();
  if (fromFlag !== undefined) return fromFlag;

  if (process.stdin.isTTY) return promptForCount();

  // Non-interactive (piped/CI) with no --count: never hang waiting for input.
  return COUNT_OPTIONS["4"];
};

const dropNonIdIndexes = async (): Promise<void> => {
  const collection = mongoose.connection.collection<ProductDocument>(COLLECTION);

  try {
    const indexes = await collection.indexes();
    const dropTargets = indexes.filter((idx) => idx.name !== "_id_").map((idx) => idx.name as string);

    for (const name of dropTargets) {
      await collection.dropIndex(name);
    }

    if (dropTargets.length > 0) {
      logger.info(`Dropped ${dropTargets.length} index(es) before bulk insert: ${dropTargets.join(", ")}`);
    }
  } catch (err) {
    // Fresh collection may have no indexes beyond _id yet - safe to ignore.
    logger.warn(`No extra indexes to drop (or drop failed harmlessly): ${(err as Error).message}`);
  }
};

const rebuildCategoryIndex = async (): Promise<void> => {
  const collection = mongoose.connection.collection<ProductDocument>(COLLECTION);
  await collection.createIndex({ category: 1 });
  logger.info("Rebuilt index on 'category'");
};

const insertBatch = async (batchSize: number, startIndex: number): Promise<number> => {
  const docs: SeedProduct[] = new Array(batchSize);
  for (let i = 0; i < batchSize; i++) {
    docs[i] = generateProduct(startIndex + i);
  }

  const collection = mongoose.connection.collection<ProductDocument>(COLLECTION);
  // Raw driver insertMany (not Product.insertMany) - skips Mongoose document
  // hydration/validation entirely, which is the dominant cost at 10M-doc scale.
  const result = await collection.insertMany(docs as unknown as ProductDocument[], { ordered: false });
  return result.insertedCount;
};

const runBatchesWithConcurrency = async (
  batches: number[],
  concurrency: number,
): Promise<{ inserted: number; startedAt: number }> => {
  const startedAt = Date.now();
  let inserted = 0;
  let cursor = 0; // running document offset, used to seed unique-ish product indexes
  let batchesDone = 0;

  for (let i = 0; i < batches.length; i += concurrency) {
    const group = batches.slice(i, i + concurrency);

    const results = await Promise.all(
      group.map((size) => {
        const startIndex = cursor;
        cursor += size;
        return insertBatch(size, startIndex);
      }),
    );

    inserted += results.reduce((sum, count) => sum + count, 0);
    batchesDone += group.length;

    if (batchesDone % PROGRESS_EVERY_N_BATCHES === 0 || i + concurrency >= batches.length) {
      const elapsedSec = (Date.now() - startedAt) / 1000;
      const rate = elapsedSec > 0 ? Math.round(inserted / elapsedSec) : inserted;
      logger.info(
        `Inserted ${inserted}/${cursor === 0 ? inserted : cursor} docs | elapsed ${elapsedSec.toFixed(1)}s | rate ${rate} docs/sec`,
      );
    }
  }

  return { inserted, startedAt };
};

const main = async (): Promise<void> => {
  try {
    const count = await resolveCount();
    logger.info(`Seeding ${count} products into "${COLLECTION}"...`);

    await connectDatabase();

    await dropNonIdIndexes();

    const batches = planBatches(count, BATCH_SIZE);
    logger.info(`Planned ${batches.length} batches (batch size ${BATCH_SIZE}, concurrency ${CONCURRENCY})`);

    const { inserted, startedAt } = await runBatchesWithConcurrency(batches, CONCURRENCY);

    if (IS_DEFAULT_COLLECTION) await rebuildCategoryIndex();

    await disconnectDatabase();

    const totalSec = (Date.now() - startedAt) / 1000;
    const avgRate = totalSec > 0 ? Math.round(inserted / totalSec) : inserted;
    logger.info(
      `Done. Inserted ${inserted} products in ${totalSec.toFixed(1)}s (avg ${avgRate} docs/sec)`,
    );

    process.exit(0);
  } catch (err) {
    logger.error(`Seed failed: ${(err as Error).stack ?? (err as Error).message}`);
    process.exit(1);
  }
};

// Self-check for planBatches - only runs when explicitly requested via --selfcheck,
// and only when this file is the one being executed directly (not imported).
const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);

if (process.argv.includes("--selfcheck") && isDirectRun) {
  try {
    const a = planBatches(23, 10);
    assert.deepStrictEqual(a, [10, 10, 3]);
    assert.strictEqual(a.reduce((s, n) => s + n, 0), 23);
    assert.ok(a.every((n) => n <= 10 && n > 0));

    const b = planBatches(10_000_000, 5000);
    assert.strictEqual(b.reduce((s, n) => s + n, 0), 10_000_000);
    assert.ok(b.every((n) => n <= 5000 && n > 0));

    const c = planBatches(0, 100);
    assert.deepStrictEqual(c, []);

    const d = planBatches(100, 100);
    assert.deepStrictEqual(d, [100]);

    console.log("planBatches self-check: PASS");
    process.exit(0);
  } catch (err) {
    console.error("planBatches self-check: FAIL", err);
    process.exit(1);
  }
} else if (isDirectRun) {
  void main();
}
