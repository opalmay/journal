-- OAuth for the MCP endpoint. Clients register themselves (claude.ai does);
-- codes and tokens are stored only as sha256 hashes, like a password would be.
CREATE TABLE oauth_clients (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  redirect_uris TEXT NOT NULL,                  -- JSON array, matched exactly
  secret_hash   TEXT,                           -- NULL for public (PKCE-only) clients
  created_at    INTEGER NOT NULL,
  last_used_at  INTEGER
);

-- Single-use, a minute long: only bridges the consent page and the token call.
CREATE TABLE oauth_codes (
  hash           TEXT PRIMARY KEY,
  client_id      TEXT NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
  redirect_uri   TEXT NOT NULL,
  code_challenge TEXT NOT NULL,                 -- S256 only
  expires_at     INTEGER NOT NULL
);

-- One row per grant; a refresh replaces the row, so a used refresh token dies.
CREATE TABLE oauth_tokens (
  id                 TEXT PRIMARY KEY,
  client_id          TEXT NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
  access_hash        TEXT NOT NULL UNIQUE,
  access_expires_at  INTEGER NOT NULL,
  refresh_hash       TEXT NOT NULL UNIQUE,
  refresh_expires_at INTEGER NOT NULL,
  created_at         INTEGER NOT NULL
);
CREATE INDEX oauth_tokens_client_idx ON oauth_tokens (client_id);
