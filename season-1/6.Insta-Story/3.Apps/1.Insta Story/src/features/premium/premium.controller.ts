import type { FastifyReply, FastifyRequest } from "fastify";
import { Profile } from "../profiles/profiles.model.js";
import { Subscription } from "./premium.model.js";
import { premiumKey } from "./premium.keys.js";
import { recordAudit } from "../audit/audit.service.js";
import { auditSnapshot } from "../../shared/client-meta.js";
import { httpError } from "../../shared/error.js";
import { cacheDel, cacheGet, cacheSet } from "../../shared/redisGateway.js";
import { requireUser } from "../../shared/user.js";

const CACHE_TTL = 300;

// What the profile card shows. No price, no payment, only what the plan unlocks.
export const BENEFITS = [
  "See who watched, with a searchable viewer list",
  "Rewatch count for every story",
  "Extend a story to 48 hours, once",
  "Anonymous view, your name stays hidden",
] as const;

interface PremiumState {
  username: string;
  active: boolean;
  tier: "meta_one" | null;
  startedAt: Date | string | null;
  cancelledAt: Date | string | null;
}

const stateOf = (doc: {
  username: string;
  tier: string;
  status: string;
  startedAt?: Date | null;
  cancelledAt?: Date | null;
}): PremiumState => ({
  username: doc.username,
  active: doc.status === "active",
  tier: doc.tier === "meta_one" ? "meta_one" : null,
  startedAt: doc.startedAt ?? null,
  cancelledAt: doc.cancelledAt ?? null,
});

const notPremium = (username: string): PremiumState => ({
  username,
  active: false,
  tier: null,
  startedAt: null,
  cancelledAt: null,
});

// Redis first, then Mongo. A "not premium" answer is cached too, so ordinary profiles do not
// hit Mongo on every page load.
export const readPremiumState = async (
  username: string,
): Promise<PremiumState> => {
  const cached = await cacheGet(premiumKey(username));
  if (cached) {
    try {
      return JSON.parse(cached) as PremiumState;
    } catch {
      // a broken value is treated as a miss
    }
  }
  const doc = await Subscription.findOne({ username }).lean();
  const state = doc ? stateOf(doc) : notPremium(username);
  await cacheSet(premiumKey(username), JSON.stringify(state), CACHE_TTL);
  return state;
};

export const isPremiumActive = async (username: string): Promise<boolean> =>
  (await readPremiumState(username)).active;

const cacheState = async (state: PremiumState): Promise<void> => {
  await cacheDel(premiumKey(state.username));
  await cacheSet(premiumKey(state.username), JSON.stringify(state), CACHE_TTL);
};

// Only the owner can read or change their own plan.
const owner = (req: FastifyRequest): string => {
  const me = requireUser(req);
  const username = (req.params as { username: string }).username.toLowerCase();
  if (me !== username)
    throw httpError(403, "You can change only your own Meta One plan");
  return username;
};

// GET /premium/:username -> current state plus what the plan unlocks
export const get = async (
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> => {
  const username = owner(req);
  const state = await readPremiumState(username);
  await reply.send({ ...state, benefits: BENEFITS });
};

// POST /premium/:username -> become Meta One (or turn it back on)
export const activate = async (
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> => {
  const username = owner(req);
  if (!(await Profile.exists({ username })))
    throw httpError(404, "Profile not found");

  const now = new Date();
  const doc = await Subscription.findOneAndUpdate(
    { username },
    {
      $set: {
        status: "active",
        startedAt: now,
        cancelledAt: null,
        audit: auditSnapshot(req, username),
      },
      $setOnInsert: { tier: "meta_one" },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();
  if (!doc) throw httpError(500, "Could not activate Meta One");

  const state = stateOf(doc);
  await cacheState(state);
  await recordAudit(req, {
    action: "premium.activate",
    entity: "subscriptions",
    entityId: username,
    userId: username,
    status: 200,
  });
  await reply.send({ ...state, benefits: BENEFITS });
};

// DELETE /premium/:username -> cancel, keeps the row and the start date
export const cancel = async (
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> => {
  const username = owner(req);
  const doc = await Subscription.findOneAndUpdate(
    { username },
    {
      $set: {
        status: "cancelled",
        cancelledAt: new Date(),
        audit: auditSnapshot(req, username),
      },
    },
    { new: true },
  ).lean();
  if (!doc) throw httpError(404, "No Meta One plan to cancel");

  const state = stateOf(doc);
  await cacheState(state);
  await recordAudit(req, {
    action: "premium.cancel",
    entity: "subscriptions",
    entityId: username,
    userId: username,
    status: 200,
  });
  await reply.send({ ...state, benefits: BENEFITS });
};
