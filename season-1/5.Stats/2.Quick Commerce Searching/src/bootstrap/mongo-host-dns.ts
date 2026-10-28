import dns from "node:dns";

// Replica set members advertise host.docker.internal so Docker nodes
// reach published host ports. That name exists inside containers, not
// on the Mac host process — mongoose then gets ENOTFOUND.
const nativeLookup = dns.lookup.bind(dns);
const nativePromisesLookup = dns.promises.lookup.bind(dns.promises);

const remap = (hostname: string): string =>
  hostname === "host.docker.internal" ? "127.0.0.1" : hostname;

dns.lookup = ((hostname: string, ...rest: unknown[]) => {
  return (nativeLookup as (...args: unknown[]) => unknown)(remap(String(hostname)), ...rest);
}) as typeof dns.lookup;

dns.promises.lookup = ((hostname: string, ...rest: unknown[]) => {
  return (nativePromisesLookup as (...args: unknown[]) => unknown)(remap(String(hostname)), ...rest);
}) as typeof dns.promises.lookup;
