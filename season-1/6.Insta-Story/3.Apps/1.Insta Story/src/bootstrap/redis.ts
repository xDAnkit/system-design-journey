import { createClient, type RedisClientType } from "redis";
import { env } from "./env.js";
import { logger } from "./logger.js";

let reconnectAttempt = 0;
let downSince: number | null = null;

const LOG_EVERY_NTH_ATTEMPT = 10; // pehle attempt ke baad, sirf har 10th pe log - spam avoid

export const redisClient: RedisClientType = createClient({
  url: env.redisUrl,
  disableOfflineQueue: true, // disconnect ke dauraan command turant reject ho, queue me atak ke hang na ho
  socket: {
    connectTimeout: 2000,
    reconnectStrategy: (retries) => {
      reconnectAttempt = retries + 1;
      downSince ??= Date.now();
      const delay = Math.min(retries * 200, 5000); // kabhi give up nahi, bas backoff capped

      if (reconnectAttempt === 1 || reconnectAttempt % LOG_EVERY_NTH_ATTEMPT === 0) {
        const downForSec = Math.round((Date.now() - downSince) / 1000);
        logger.warn(`Redis reconnecting — attempt #${reconnectAttempt}, down for ${downForSec}s, next retry in ${delay}ms`);
      }
      return delay;
    },
  },
});

// error listener hona zaroori hai (warna node isse unhandled crash treat karta hai) - but ise debug
// level pe rakha hai taaki har retry ka ECONNREFUSED normal logs me spam na kare, reconnectStrategy
// ka throttled warn line hi kaafi signal deti hai
redisClient.on("error", (err: Error) => logger.debug(`Redis error: ${err.message}`));
redisClient.on("ready", () => {
  if (downSince !== null) {
    const downForSec = Math.round((Date.now() - downSince) / 1000);
    logger.info(`Redis reconnected after ${downForSec}s and ${reconnectAttempt} attempts`);
  } else {
    logger.info("Redis ready");
  }
  reconnectAttempt = 0;
  downSince = null;
});

export const connectRedis = async (): Promise<void> => {
  // connect() ka reconnectStrategy kabhi give up nahi karta, isliye ise seedha await karna
  // Redis down hone par bootstrap ko hamesha ke liye hang kar deta hai. Boot ko sirf 3s tak
  // wait karwao — connect() background me retry karta rahega, ready hote hi khud use hone lagega.
  const connectAttempt = redisClient.connect().catch((err) => {
    logger.error(`Redis connection error: ${err}`);
  });
  await Promise.race([connectAttempt, new Promise<void>((resolve) => setTimeout(resolve, 3000))]);
};

const QUIT_TIMEOUT_MS = 2000;

// quit() waits for a live connection, so while Redis is down (reconnect loop) it never settles and
// blocks the whole graceful shutdown. Down = destroy() now. Up = polite quit(), destroy() if it stalls.
export const disconnectRedis = async (): Promise<void> => {
  if (!redisClient.isOpen) return;

  if (!redisClient.isReady) {
    redisClient.destroy();
    logger.info("Redis destroyed (was not connected)");
    return;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const quit = redisClient.quit().then(() => true);
  const stalled = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), QUIT_TIMEOUT_MS);
  });
  const clean = await Promise.race([quit, stalled]).catch(() => false);
  clearTimeout(timer);

  if (clean) {
    logger.info("Redis disconnected");
    return;
  }
  redisClient.destroy();
  logger.warn(`Redis quit did not finish in ${QUIT_TIMEOUT_MS}ms, destroyed`);
};
