import readline from "node:readline/promises";

/** --name=value */
export const flag = (name: string): string | undefined => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

/** --name */
export const hasFlag = (name: string): boolean => process.argv.includes(`--${name}`);

export const intFlag = (name: string, fallback: number): number => {
  const raw = flag(name);
  if (raw === undefined) return fallback;
  const n = Number(raw.replace(/_/g, ""));
  if (!Number.isInteger(n) || n <= 0) throw new Error(`--${name} must be a positive whole number, got "${raw}"`);
  return n;
};

/** --yes skips the question. Without a terminal and without --yes the answer is no. */
export async function confirm(question: string): Promise<boolean> {
  if (hasFlag("yes")) return true;
  if (!process.stdin.isTTY) {
    console.log("Not a terminal: add --yes to run it.");
    return false;
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`${question} [y/N] `);
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

/**
 * Scripts that write data only touch this project's own database ("blinkit", "blinkit-test"...).
 * Any other database needs an explicit --allow-db=<name>, so a wrong MONGO_URI can't write into another project.
 */
export const assertSafeDatabase = (dbName: string): void => {
  if (dbName.startsWith("blinkit") || flag("allow-db") === dbName) return;
  throw new Error(`MONGO_URI points at database "${dbName}". This script only writes to a "blinkit..." database. Fix MONGO_URI, or pass --allow-db=${dbName} if you really mean it.`);
};
