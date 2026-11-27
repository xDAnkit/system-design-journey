import { redisClient } from "../bootstrap/redis.js";
import * as core from "./cuckoo-core.js";

export const cuckooAdd = (key: string, item: string): Promise<number> => core.add(redisClient, key, item);
export const cuckooExists = (key: string, items: string[]): Promise<boolean[]> => core.exists(redisClient, key, items);
export const cuckooAddMany = (pairs: Array<[string, string]>): Promise<number[]> => core.addMany(redisClient, pairs);
export const cuckooDelMany = (pairs: Array<[string, string]>): Promise<number[]> => core.delMany(redisClient, pairs);
export const cuckooDel =(key: string, item: string): Promise<boolean> => core.del(redisClient, key, item);
