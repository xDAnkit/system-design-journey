// Dark stores and pincodes, kept in memory: 24 stores and ~120 pincodes don't need a database.
// ponytail: static demo data. Move to a Mongo collection with a 2dsphere index when stores are managed from the admin.
import data from "./locations.data.json";

export interface Pincode {
  pin: string;
  area: string;
  city: string;
  lat: number;
  lng: number;
}

export interface Store {
  id: string;
  name: string;
  city: string;
  pin: string;
  lat: number;
  lng: number;
  serves: string[];
}

export interface City {
  name: string;
  state: string;
  weight: number;
  langMix: Record<string, number>;
  pincodes: Pincode[];
  stores: Store[];
}

export interface ResolvedLocation {
  pincode: string;
  area: string;
  city: string;
  lat: number;
  lng: number;
  store: Pick<Store, "id" | "name" | "city"> | null;
  serviceable: boolean;
}

export const CITIES: City[] = data.cities.map((c) => {
  const pincodes = c.pincodes.map(([pin, area, lat, lng]) => ({ pin: String(pin), area: String(area), city: c.name, lat: Number(lat), lng: Number(lng) }));
  const byPin = new Map(pincodes.map((p) => [p.pin, p]));
  const stores = c.stores.map((s) => {
    const home = byPin.get(s.pin);
    if (!home) throw new Error(`store ${s.id}: pincode ${s.pin} is not in ${c.name}`);
    return { ...s, city: c.name, lat: home.lat, lng: home.lng };
  });
  const langMix = Object.fromEntries(Object.entries(c.langMix).filter((e): e is [string, number] => typeof e[1] === "number"));
  return { name: c.name, state: c.state, weight: c.weight, langMix, pincodes, stores };
});

export const PINCODES = new Map(CITIES.flatMap((c) => c.pincodes.map((p) => [p.pin, p])));
export const STORES = new Map(CITIES.flatMap((c) => c.stores.map((s) => [s.id, s])));
export const STORE_IDS = [...STORES.keys()];
const STORE_BY_PIN = new Map(CITIES.flatMap((c) => c.stores.flatMap((s) => s.serves.map((pin) => [pin, s]))));

/** Distance in km between two points (haversine) */
export const distanceKm = (aLat: number, aLng: number, bLat: number, bLng: number): number => {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLng = (bLng - aLng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
};

const nearestPincode = (lat: number, lng: number): Pincode | null => {
  let best: Pincode | null = null;
  let bestKm = Infinity;
  for (const p of PINCODES.values()) {
    const km = distanceKm(lat, lng, p.lat, p.lng);
    if (km < bestKm) [best, bestKm] = [p, km];
  }
  // more than 30 km from every known pincode = a city we don't cover at all
  return bestKm <= 30 ? best : null;
};

/** Pincode or GPS -> area, city and the dark store that delivers there (null = no store yet). */
export const resolveLocation = (input: { pincode?: string; lat?: number; lng?: number }): ResolvedLocation | null => {
  const p = input.pincode ? PINCODES.get(input.pincode) : input.lat !== undefined && input.lng !== undefined ? nearestPincode(input.lat, input.lng) : null;
  if (!p) return null;
  const store = STORE_BY_PIN.get(p.pin) ?? null;
  return {
    pincode: p.pin,
    area: p.area,
    city: p.city,
    lat: p.lat,
    lng: p.lng,
    store: store ? { id: store.id, name: store.name, city: store.city } : null,
    serviceable: Boolean(store),
  };
};

/** Area or pincode search for the location picker ("kora" -> Koramangala, "5600" -> Bengaluru pincodes) */
export const searchPincodes = (q: string, limit = 10): Pincode[] => {
  const term = q.trim().toLowerCase();
  if (!term) return [];
  return [...PINCODES.values()].filter((p) => p.pin.startsWith(term) || p.area.toLowerCase().includes(term) || p.city.toLowerCase().startsWith(term)).slice(0, limit);
};
