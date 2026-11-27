import mongoose, { Schema, type Document } from "mongoose";
import { cacheGet, cacheSet, cacheDel } from "./redisGateway.js";

interface SessionDocument extends Document<string> {
  _id: string; // jti - shared by that login's access + refresh token
  userId: mongoose.Types.ObjectId;
  expiresAt: Date;
}

const sessionSchema = new Schema<SessionDocument>({
  _id: { type: String, required: true },
  userId: { type: Schema.Types.ObjectId, required: true, index: true },
  // expireAfterSeconds:0 on an absolute date = "expire once this date is in the past", not a relative TTL
  expiresAt: { type: Date, required: true, expires: 0 },
});

const Session = mongoose.model<SessionDocument>("Session", sessionSchema);

const redisKey = (jti: string): string => `session:${jti}`;

const ttlSeconds = (expiresAt: Date): number => Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 1000));

export const createSession = async (userId: string, jti: string, expiresAt: Date): Promise<void> => {
  await Session.create({ _id: jti, userId, expiresAt });
  await cacheSet(redisKey(jti), userId, ttlSeconds(expiresAt));
};

export const isSessionValid = async (jti: string): Promise<boolean> => {
  const cached = await cacheGet(redisKey(jti));
  if (cached !== null) return true;

  // TTL index cleanup is a lazy background sweep (up to ~60s late) - the expiresAt
  // filter here is what actually keeps an expired-but-not-yet-purged doc from validating
  const doc = await Session.findOne({ _id: jti, expiresAt: { $gt: new Date() } }).lean();
  if (!doc) return false;

  await cacheSet(redisKey(jti), String(doc.userId), ttlSeconds(doc.expiresAt));
  return true;
};

export const revokeSession = async (jti: string): Promise<void> => {
  await Session.deleteOne({ _id: jti });
  await cacheDel(redisKey(jti));
};

export const revokeAllSessions = async (userId: string): Promise<void> => {
  const sessions = await Session.find({ userId }).select("_id").lean();
  await Session.deleteMany({ userId });
  if (sessions.length === 0) return;

  await cacheDel(sessions.map((s) => redisKey(String(s._id))));
};
