import { KafkaJS } from "@confluentinc/kafka-javascript";
import { env } from "./env.js";
import { logger } from "./logger.js";
import { httpError } from "../shared/error.js";

// "test." prefix in .env.test, so test events never reach the dev workers
const P = env.kafkaTopicPrefix;

export const TOPICS = {
  /** New / changed / deleted product from the API (key = productId) */
  productsIngest: `${P}products.ingest`,
  /** Make tags + vector for a product */
  productsEnrich: `${P}products.enrich`,
  /** Products that failed enrich 3 times, for a manual look */
  productsEnrichDlq: `${P}products.enrich.dlq`,
  /** Write a product into Typesense (also price / stock changes, no AI) */
  productsIndex: `${P}products.index`,
  /** Every search, click, ADD and "no store here" event (key = sessionId) */
  searchEvents: `${P}search.events`,
} as const;

export const GROUPS = {
  ingest: `${P}qc-ingest`,
  enrich: `${P}qc-enrich`,
  index: `${P}qc-index`,
  analytics: `${P}qc-analytics`,
} as const;

const kafka = new KafkaJS.Kafka({
  kafkaJS: { brokers: env.kafkaBrokers, clientId: env.kafkaClientId, logLevel: KafkaJS.logLevel.NOTHING },
});

const producer = kafka.producer();
let producerReady = false;

// The broker has auto-create off, so every topic is created here, before anyone sends or subscribes.
// 3 partitions: the same key stays in order, and up to 3 workers per group share the load.
export const ensureTopics = async (): Promise<void> => {
  const admin = kafka.admin();
  try {
    await admin.connect();
    await admin.createTopics({
      topics: Object.values(TOPICS).map((topic) => ({ topic, numPartitions: topic === TOPICS.productsEnrichDlq ? 1 : 3 })),
    });
  } finally {
    await admin.disconnect().catch(() => {});
  }
};

// Kafka down must not block the app (search still works). Boot waits 3s, connect keeps retrying.
export const connectKafka = async (): Promise<void> => {
  const attempt = producer
    .connect()
    .then(async () => {
      await ensureTopics().catch((err: unknown) => logger.warn(`Kafka topic setup failed: ${err instanceof Error ? err.message : String(err)}`));
      producerReady = true;
      logger.info("Kafka producer ready");
    })
    .catch((err: unknown) => logger.error(`Kafka connection error: ${err instanceof Error ? err.message : String(err)}`));
  await Promise.race([attempt, new Promise<void>((resolve) => setTimeout(resolve, 3000))]);
};

// Throws if Kafka is not connected, so the API answers 503 instead of a 202 that was never queued.
export const sendEvent = async (topic: string, key: string, value: unknown): Promise<void> => {
  if (!producerReady) throw httpError(503, "Kafka is not available");
  await producer.send({ topic, messages: [{ key, value: JSON.stringify(value) }] });
};

// Many events in one call. Same 503 rule as sendEvent.
export const sendEvents = async (topic: string, events: Array<{ key: string; value: unknown }>): Promise<void> => {
  if (!producerReady) throw httpError(503, "Kafka is not available");
  if (events.length === 0) return;
  await producer.send({ topic, messages: events.map((e) => ({ key: e.key, value: JSON.stringify(e.value) })) });
};

export const isKafkaReady = (): boolean => producerReady;

export interface ConsumerOptions {
  /** Most messages one handler call gets. Slow handlers (LLM) want small batches. */
  maxBatch?: number;
}

const newConsumer = (groupId: string, maxBatch: number) =>
  kafka.consumer({
    kafkaJS: { groupId, fromBeginning: true, autoCommit: true },
    "js.consumer.max.batch.size": maxBatch,
    "fetch.max.bytes": 64 * 1024 * 1024,
    "max.partition.fetch.bytes": 16 * 1024 * 1024,
    // an LLM batch can take a while, do not kick the worker out of the group for it
    "max.poll.interval.ms": 600_000,
  });

const consumers: Array<ReturnType<typeof newConsumer>> = [];
const RETRY_MS = 5000;

// Runs one consumer group on one topic. Retries until Kafka is reachable, so workers can start before Kafka.
// A handler that throws gets the same batch again, so handlers must be safe to repeat.
export const startConsumer = async <T>(
  groupId: string,
  topic: string,
  label: string,
  handleBatch: (events: T[]) => Promise<void>,
  { maxBatch = 5000 }: ConsumerOptions = {},
): Promise<void> => {
  for (;;) {
    const consumer = newConsumer(groupId, maxBatch);
    try {
      await consumer.connect();
      await consumer.subscribe({ topics: [topic] });
      await consumer.run({
        eachBatch: async ({ batch }) => {
          const events: T[] = [];
          for (const m of batch.messages) {
            try {
              events.push(JSON.parse(m.value?.toString() ?? "") as T);
            } catch {
              logger.warn(`${label}: skipped a message that is not JSON`);
            }
          }
          if (events.length === 0) return;
          try {
            await handleBatch(events);
          } catch (err) {
            logger.error(`${label} failed on a batch of ${events.length}: ${err instanceof Error ? err.message : String(err)}`);
            throw err;
          }
        },
      });
      consumers.push(consumer);
      logger.info(`${label} running (group ${groupId}, topic ${topic})`);
      return;
    } catch (err) {
      logger.warn(`${label} not started, retry in ${RETRY_MS / 1000}s: ${err instanceof Error ? err.message : String(err)}`);
      await consumer.disconnect().catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
    }
  }
};

export const disconnectKafka = async (): Promise<void> => {
  await Promise.all(consumers.map((c) => c.disconnect().catch(() => {})));
  if (!producerReady) return;
  await producer.disconnect().catch((err: unknown) => logger.warn(`Kafka disconnect failed: ${String(err)}`));
  logger.info("Kafka producer disconnected");
};
