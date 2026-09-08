import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { Db } from "./db/index.js";

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

const PARAMS = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEYLEN = 64;

/** `scrypt$N$r$p$<salt hex>$<hash hex>` — self-describing, so params can change. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEYLEN, PARAMS);
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltHex, hashHex] = parts as [string, string, string, string, string, string];
  let key: Buffer;
  try {
    key = await scrypt(password, Buffer.from(saltHex, "hex"), hashHex.length / 2, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: PARAMS.maxmem,
    });
  } catch {
    return false;
  }
  const expected = Buffer.from(hashHex, "hex");
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** Constant-time comparison for the webhook shared secret. */
export function secretsMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Still burn a comparison so length is not leaked by timing alone.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export const SESSION_COOKIE = "journal_session";

export function createSession(db: Db, ttlDays: number): { id: string; expiresAt: number } {
  const id = randomBytes(32).toString("hex");
  const now = Date.now();
  const expiresAt = now + ttlDays * 86_400_000;
  db.prepare(`INSERT INTO sessions (id, created_at, expires_at) VALUES (?, ?, ?)`).run(
    id,
    now,
    expiresAt,
  );
  return { id, expiresAt };
}

export function isSessionValid(db: Db, id: string): boolean {
  const row = db.prepare(`SELECT expires_at FROM sessions WHERE id = ?`).get(id) as unknown as
    | { expires_at: number }
    | undefined;
  if (!row) return false;
  if (row.expires_at <= Date.now()) {
    db.prepare(`DELETE FROM sessions WHERE id = ?`).run(id);
    return false;
  }
  return true;
}

export function destroySession(db: Db, id: string): void {
  db.prepare(`DELETE FROM sessions WHERE id = ?`).run(id);
}

export function purgeExpiredSessions(db: Db): void {
  db.prepare(`DELETE FROM sessions WHERE expires_at <= ?`).run(Date.now());
}
