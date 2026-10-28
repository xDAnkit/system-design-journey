import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { httpError } from "../shared/error.js";
import { CITIES, STORES, resolveLocation, searchPincodes } from "./locations.service.js";

const resolveQuery = z.union([
  z.object({ pincode: z.string().regex(/^\d{6}$/) }),
  z.object({ lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180) }),
]);

const locationsRoutes: FastifyPluginAsync = async (app) => {
  /** Cities with their areas, for the location picker */
  app.get("/cities", async () =>
    CITIES.map((c) => ({ name: c.name, state: c.state, stores: c.stores.length, areas: c.pincodes.map((p) => ({ pin: p.pin, area: p.area })) })),
  );

  /** Area or pincode search: ?q=kora */
  app.get("/search", async (req) => {
    const q = String((req.query as { q?: unknown }).q ?? "").slice(0, 40);
    return searchPincodes(q).map((p) => ({ ...p, serviceable: Boolean(resolveLocation({ pincode: p.pin })?.serviceable) }));
  });

  /** ?pincode=560034 or ?lat=12.93&lng=77.62 -> area, city, dark store (null = no delivery there yet) */
  app.get("/resolve", async (req) => {
    const parsed = resolveQuery.safeParse(req.query);
    if (!parsed.success) throw httpError(400, "send ?pincode=6 digits, or ?lat=&lng=");
    const loc = resolveLocation(parsed.data);
    if (!loc) throw httpError(404, "We don't cover this place yet");
    return loc;
  });

  /** Every dark store, for the admin pages */
  app.get("/stores", async () => [...STORES.values()].map(({ serves, ...s }) => ({ ...s, pincodes: serves.length })));
};

export default locationsRoutes;
