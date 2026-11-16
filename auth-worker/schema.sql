-- afterframe-auth (Cloudflare D1)
-- Users, sessions and single-use password-reset tokens. No plaintext secrets: passwords
-- are PBKDF2-SHA256, session and reset tokens are stored only as SHA-256 hashes.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  user_agent TEXT,
  -- Edge-reported origin of the request, for abuse tracing only.
  ip TEXT,
  country TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS password_resets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_resets_user ON password_resets(user_id);
CREATE INDEX IF NOT EXISTS idx_resets_expiry ON password_resets(expires_at);

-- Which device an account was created on / used from.
--
-- Only ever a HINT for the app's sign-in gate (sign in vs sign up, and which
-- address to prefill). It authenticates nobody, so it is safe to key on a coarse
-- browser description rather than on anything secret.
--   fingerprint = sha256 of the derived traits (stable across version bumps)
--   client_id   = sha256 of the random per-origin id in localStorage (exact)
CREATE TABLE IF NOT EXISTS auth_devices (
  fingerprint TEXT PRIMARY KEY,
  client_id TEXT,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  created_account INTEGER NOT NULL DEFAULT 0,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  user_agent TEXT,
  -- Last edge-reported IP/country seen for this device (abuse tracing only).
  ip TEXT,
  country TEXT
);

CREATE INDEX IF NOT EXISTS idx_devices_user ON auth_devices(user_id);
CREATE INDEX IF NOT EXISTS idx_devices_client ON auth_devices(client_id);
