import { createHash, createHmac, randomBytes } from "node:crypto";
import type { Db } from "./db/index.js";
import { randomUUID } from "./ids.js";
import { secretsMatch } from "./auth.js";

// Storage and token helpers for the OAuth server in routes/oauth.ts. The MCP
// endpoint is its only resource, and reading the journal its only scope.

export const OAUTH_SCOPE = "journal:read";
const CODE_TTL_MS = 60_000;
const ACCESS_TTL_MS = 60 * 60_000;
const REFRESH_TTL_MS = 90 * 86_400_000;

export interface OAuthClient {
  id: string;
  name: string;
  redirectUris: string[];
  hasSecret: boolean;
  createdAt: number;
  lastUsedAt: number | null;
}

interface ClientRow {
  id: string;
  name: string;
  redirect_uris: string;
  secret_hash: string | null;
  created_at: number;
  last_used_at: number | null;
}

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function newSecret(): string {
  return randomBytes(32).toString("base64url");
}

function toClient(row: ClientRow): OAuthClient {
  return {
    id: row.id,
    name: row.name,
    redirectUris: JSON.parse(row.redirect_uris) as string[],
    hasSecret: row.secret_hash !== null,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}

/** Registers a client; a confidential one gets its secret back exactly once. */
export function registerClient(
  db: Db,
  input: { name: string; redirectUris: string[]; confidential: boolean },
): { client: OAuthClient; secret: string | null } {
  const id = randomUUID();
  const secret = input.confidential ? newSecret() : null;
  db.prepare(
    `INSERT INTO oauth_clients (id, name, redirect_uris, secret_hash, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, input.name, JSON.stringify(input.redirectUris), secret ? sha256(secret) : null, Date.now());
  return { client: getClient(db, id)!, secret };
}

export function getClient(db: Db, id: string): OAuthClient | null {
  const row = db.prepare(`SELECT * FROM oauth_clients WHERE id = ?`).get(id) as unknown as
    | ClientRow
    | undefined;
  return row ? toClient(row) : null;
}

/** Public clients pass with no secret; confidential ones must present theirs. */
export function clientSecretValid(db: Db, id: string, secret: string | undefined): boolean {
  const row = db.prepare(`SELECT secret_hash FROM oauth_clients WHERE id = ?`).get(id) as unknown as
    | { secret_hash: string | null }
    | undefined;
  if (!row) return false;
  if (row.secret_hash === null) return true;
  return secret !== undefined && secretsMatch(sha256(secret), row.secret_hash);
}

/** Clients that hold a live grant — what Settings lists as connected. */
export function listConnectedClients(db: Db): OAuthClient[] {
  const rows = db
    .prepare(
      `SELECT c.* FROM oauth_clients c
        WHERE EXISTS (SELECT 1 FROM oauth_tokens t
                       WHERE t.client_id = c.id AND t.refresh_expires_at > ?)
        ORDER BY c.created_at`,
    )
    .all(Date.now()) as unknown as ClientRow[];
  return rows.map(toClient);
}

/** Deleting the client takes its codes and tokens with it. */
export function deleteClient(db: Db, id: string): boolean {
  return db.prepare(`DELETE FROM oauth_clients WHERE id = ?`).run(id).changes > 0;
}

export function createAuthCode(
  db: Db,
  input: { clientId: string; redirectUri: string; codeChallenge: string },
): string {
  const code = newSecret();
  db.prepare(
    `INSERT INTO oauth_codes (hash, client_id, redirect_uri, code_challenge, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(sha256(code), input.clientId, input.redirectUri, input.codeChallenge, Date.now() + CODE_TTL_MS);
  return code;
}

/**
 * Trades a code for tokens. The code is deleted before anything is checked, so
 * a second attempt with it fails whether or not the first one succeeded.
 */
export function redeemAuthCode(
  db: Db,
  input: { code: string; clientId: string; redirectUri: string; codeVerifier: string },
): TokenSet | null {
  const hash = sha256(input.code);
  const row = db.prepare(`SELECT * FROM oauth_codes WHERE hash = ?`).get(hash) as unknown as
    | { client_id: string; redirect_uri: string; code_challenge: string; expires_at: number }
    | undefined;
  if (!row) return null;
  db.prepare(`DELETE FROM oauth_codes WHERE hash = ?`).run(hash);

  const challenge = createHash("sha256").update(input.codeVerifier).digest("base64url");
  if (
    row.expires_at <= Date.now() ||
    row.client_id !== input.clientId ||
    row.redirect_uri !== input.redirectUri ||
    !secretsMatch(challenge, row.code_challenge)
  ) {
    return null;
  }
  return issueTokens(db, input.clientId);
}

/** Rotates a refresh token: the old pair is gone once the new one exists. */
export function refreshTokens(db: Db, refreshToken: string, clientId: string): TokenSet | null {
  const row = db
    .prepare(`SELECT id, refresh_expires_at FROM oauth_tokens WHERE refresh_hash = ? AND client_id = ?`)
    .get(sha256(refreshToken), clientId) as unknown as
    | { id: string; refresh_expires_at: number }
    | undefined;
  if (!row) return null;
  db.prepare(`DELETE FROM oauth_tokens WHERE id = ?`).run(row.id);
  if (row.refresh_expires_at <= Date.now()) return null;
  return issueTokens(db, clientId);
}

function issueTokens(db: Db, clientId: string): TokenSet {
  const accessToken = newSecret();
  const refreshToken = newSecret();
  const now = Date.now();
  db.prepare(
    `INSERT INTO oauth_tokens
       (id, client_id, access_hash, access_expires_at, refresh_hash, refresh_expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    clientId,
    sha256(accessToken),
    now + ACCESS_TTL_MS,
    sha256(refreshToken),
    now + REFRESH_TTL_MS,
    now,
  );
  return { accessToken, refreshToken, expiresIn: ACCESS_TTL_MS / 1000 };
}

/** The client an access token belongs to, or null when it is unknown or expired. */
export function verifyAccessToken(db: Db, token: string): string | null {
  const row = db
    .prepare(`SELECT client_id FROM oauth_tokens WHERE access_hash = ? AND access_expires_at > ?`)
    .get(sha256(token), Date.now()) as unknown as { client_id: string } | undefined;
  if (!row) return null;
  db.prepare(`UPDATE oauth_clients SET last_used_at = ? WHERE id = ?`).run(Date.now(), row.client_id);
  return row.client_id;
}

export function purgeExpiredGrants(db: Db): void {
  const now = Date.now();
  db.prepare(`DELETE FROM oauth_codes WHERE expires_at <= ?`).run(now);
  db.prepare(`DELETE FROM oauth_tokens WHERE refresh_expires_at <= ?`).run(now);
}

/** Ties the consent form to the session that rendered it. */
export function consentToken(sessionSecret: string, sessionId: string): string {
  return createHmac("sha256", sessionSecret).update(`oauth-consent:${sessionId}`).digest("hex");
}
