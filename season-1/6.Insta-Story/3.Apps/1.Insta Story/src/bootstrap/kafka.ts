import { KafkaJS } from "@confluentinc/kafka-javascript";
import { env } from "./env.js";
import { logger } from "./logger.js";
import { httpError } from "../shared/error.js";

export const TOPIC_LIKES = "likes";
export const TOPIC_VIEWS = "views";
export const TOPIC_FOLLOWS = "follows";
export const TOPIC_STORY_VIEWS = "story-views";
export const TOPIC_STORY_LIKES = "story-likes";

const kafka = new KafkaJS.Kafka({
  kafkaJS: {
    brokers: env.kafkaBrokers,
    clientId: env.kafkaClientId,
    logLevel: KafkaJS.logLevel.NOTHING,
  },
});

const producer = kafka.producer();
let producerReady = false;

// Create the topics up front (3 partitions). A consumer cannot subscribe to a topic that does not exist yet.
const ensureTopics = async (): Promise<void> => {
  const admin = kafka.admin();
  try {
    await admin.connect();
    await admin.createTopics({
      topics: [
        TOPIC_LIKES,
        TOPIC_VIEWS,
        TOPIC_FOLLOWS,
        TOPIC_STORY_VIEWS,
        TOPIC_STORY_LIKES,
      ].map((topic) => ({ topic, numPartitions: 3 })),
    });
  } catch (err) {
    logger.warn(
      `Kafka topic setup failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    await admin.disconnect().catch(() => {});
  }
};

// Producer lives here. Consumers are started per feature with startConsumer().
export const connectKafka = async (): Promise<void> => {
  // Kafka down must not block the app (products still work). Boot waits 3s, connect keeps retrying.
  const attempt = producer
    .connect()
    .then(async () => {
      producerReady = true;
      logger.info("Kafka producer ready");
      await ensureTopics();
    })
    .catch((err: unknown) =>
      logger.error(
        `Kafka connection error: ${err instanceof Error ? err.message : String(err)}`,
      ),
    );
  await Promise.race([
    attempt,
    new Promise<void>((resolve) => setTimeout(resolve, 3000)),
  ]);
};

// Fire an event. Throws if Kafka is not connected, so the API can answer 503 instead of lying with 202.
export const sendEvent = async (
  topic: string,
  key: string,
  value: unknown,
): Promise<void> => {
  if (!producerReady) throw httpError(503, "Kafka is not available");
  await producer.send({
    topic,
    messages: [{ key, value: JSON.stringify(value) }],
  });
};

// Many events in one call, for scripts. Same 503 rule as sendEvent.
export const sendEvents = async (
  topic: string,
  events: Array<{ key: string; value: unknown }>,
): Promise<void> => {
  if (!producerReady) throw httpError(503, "Kafka is not available");
  await producer.send({
    topic,
    messages: events.map((e) => ({
      key: e.key,
      value: JSON.stringify(e.value),
    })),
  });
};

export const isKafkaReady = (): boolean => producerReady;

// Up to 50k events reach a handler at once. 50k small events are about 5 MB, so the fetch caps are raised too.
const CONSUMER_BATCH = 50_000;
export const newConsumer = (groupId: string) =>
  kafka.consumer({
    kafkaJS: { groupId, fromBeginning: false, autoCommit: true },
    "js.consumer.max.batch.size": CONSUMER_BATCH,
    "fetch.max.bytes": 64 * 1024 * 1024,
    "max.partition.fetch.bytes": 16 * 1024 * 1024,
  });

const consumers: Array<ReturnType<typeof newConsumer>> = [];
const RETRY_MS = 5000;

// Runs one consumer group on one topic. Retries until Kafka is reachable, so the server can start before Kafka does.
// Messages that are not JSON are skipped.
export const startConsumer = async <T>(
  groupId: string,
  topic: string,
  label: string,
  handleBatch: (events: T[]) => Promise<void>,
): Promise<void> => {
  for (;;) {
    const consumer = newConsumer(groupId);
    try {
      await consumer.connect();
      await consumer.subscribe({ topics: [topic] });
      await consumer.run({
        // a whole batch at once. A handler that throws gets the same batch again, so handlers must be safe to repeat.
        eachBatch: async ({ batch }) => {
          const events: T[] = [];
          for (const m of batch.messages) {
            try {
              events.push(JSON.parse(m.value?.toString() ?? "") as T);
            } catch {
              logger.warn(
                `${label} consumer: skipped a message that is not JSON`,
              );
            }
          }
          if (events.length === 0) return;
          try {
            await handleBatch(events);
          } catch (err) {
            logger.error(
              `${label} consumer failed on a batch of ${events.length}: ${err instanceof Error ? err.message : String(err)}`,
            );
            throw err;
          }
        },
      });
      consumers.push(consumer);
      logger.info(`${label} consumer running`);
      return;
    } catch (err) {
      logger.warn(
        `${label} consumer not started, retry in ${RETRY_MS / 1000}s: ${err instanceof Error ? err.message : String(err)}`,
      );
      await consumer.disconnect().catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
    }
  }
};

export const disconnectKafka = async (): Promise<void> => {
  await Promise.all(consumers.map((c) => c.disconnect().catch(() => {})));
  if (!producerReady) return;
  await producer
    .disconnect()
    .catch((err: unknown) =>
      logger.warn(`Kafka disconnect failed: ${String(err)}`),
    );
  logger.info("Kafka producer disconnected");
};
