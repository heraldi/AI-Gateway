import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || join(__dirname, '../../data/gateway.db');

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db: Database.Database = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS providers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    base_url TEXT,
    api_key TEXT,
    cookies TEXT,
    extra_headers TEXT,
    enabled INTEGER DEFAULT 1,
    priority INTEGER DEFAULT 0,
    notes TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS model_routes (
    id TEXT PRIMARY KEY,
    pattern TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    model_override TEXT,
    enabled INTEGER DEFAULT 1,
    FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS model_aliases (
    id TEXT PRIMARY KEY,
    alias TEXT UNIQUE NOT NULL,
    provider_id TEXT NOT NULL,
    upstream_model TEXT NOT NULL,
    fork INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS provider_accounts (
    id TEXT PRIMARY KEY,
    provider_id TEXT NOT NULL,
    name TEXT NOT NULL,
    auth_type TEXT DEFAULT 'key',
    api_key TEXT,
    cookies TEXT,
    extra_headers TEXT,
    enabled INTEGER DEFAULT 1,
    priority INTEGER DEFAULT 0,
    requests_count INTEGER DEFAULT 0,
    error_count INTEGER DEFAULT 0,
    last_used_at INTEGER,
    last_error_at INTEGER,
    cooldown_until INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE,
    UNIQUE(provider_id, name)
  );

  CREATE TABLE IF NOT EXISTS gateway_keys (
    id TEXT PRIMARY KEY,
    key_hash TEXT UNIQUE NOT NULL,
    key_preview TEXT NOT NULL,
    name TEXT,
    enabled INTEGER DEFAULT 1,
    requests_count INTEGER DEFAULT 0,
    tokens_count INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS request_logs (
    id TEXT PRIMARY KEY,
    gateway_key_id TEXT,
    provider_id TEXT,
    model TEXT,
    endpoint TEXT,
    input_tokens INTEGER,
    output_tokens INTEGER,
    total_tokens INTEGER,
    status INTEGER,
    latency INTEGER,
    error TEXT,
    stream INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    request_preview TEXT,
    response_preview TEXT
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_request_logs_created ON request_logs(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_request_logs_model ON request_logs(model);
  CREATE INDEX IF NOT EXISTS idx_request_logs_provider ON request_logs(provider_id);
  CREATE INDEX IF NOT EXISTS idx_model_routes_pattern ON model_routes(pattern);
  CREATE INDEX IF NOT EXISTS idx_model_aliases_alias ON model_aliases(alias);
  CREATE INDEX IF NOT EXISTS idx_model_aliases_provider_model ON model_aliases(provider_id, upstream_model);
  CREATE INDEX IF NOT EXISTS idx_provider_accounts_provider ON provider_accounts(provider_id, enabled, priority);
`);

db.exec(`
  INSERT OR IGNORE INTO provider_accounts
    (id, provider_id, name, auth_type, api_key, cookies, extra_headers, enabled, priority, created_at, updated_at)
  SELECT
    lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(6))),
    id,
    'Default',
    CASE
      WHEN cookies LIKE '%"oauth_provider"%' THEN 'oauth'
      WHEN cookies IS NOT NULL THEN 'cookies'
      ELSE 'key'
    END,
    api_key,
    cookies,
    extra_headers,
    enabled,
    priority,
    created_at,
    updated_at
  FROM providers
  WHERE (api_key IS NOT NULL OR cookies IS NOT NULL OR extra_headers IS NOT NULL)
    AND NOT EXISTS (SELECT 1 FROM provider_accounts pa WHERE pa.provider_id = providers.id);

  CREATE TRIGGER IF NOT EXISTS trg_provider_default_account_insert
  AFTER INSERT ON providers
  WHEN NEW.api_key IS NOT NULL OR NEW.cookies IS NOT NULL OR NEW.extra_headers IS NOT NULL
  BEGIN
    INSERT OR IGNORE INTO provider_accounts
      (id, provider_id, name, auth_type, api_key, cookies, extra_headers, enabled, priority, created_at, updated_at)
    VALUES (
      lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(6))),
      NEW.id,
      'Default',
      CASE
        WHEN NEW.cookies LIKE '%"oauth_provider"%' THEN 'oauth'
        WHEN NEW.cookies IS NOT NULL THEN 'cookies'
        ELSE 'key'
      END,
      NEW.api_key,
      NEW.cookies,
      NEW.extra_headers,
      NEW.enabled,
      NEW.priority,
      NEW.created_at,
      NEW.updated_at
    );
  END;

  CREATE TRIGGER IF NOT EXISTS trg_provider_default_account_update
  AFTER UPDATE OF api_key, cookies, extra_headers, enabled, priority ON providers
  WHEN NEW.api_key IS NOT NULL OR NEW.cookies IS NOT NULL OR NEW.extra_headers IS NOT NULL
  BEGIN
    INSERT INTO provider_accounts
      (id, provider_id, name, auth_type, api_key, cookies, extra_headers, enabled, priority, created_at, updated_at)
    VALUES (
      lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(6))),
      NEW.id,
      'Default',
      CASE
        WHEN NEW.cookies LIKE '%"oauth_provider"%' THEN 'oauth'
        WHEN NEW.cookies IS NOT NULL THEN 'cookies'
        ELSE 'key'
      END,
      NEW.api_key,
      NEW.cookies,
      NEW.extra_headers,
      NEW.enabled,
      NEW.priority,
      COALESCE((SELECT created_at FROM provider_accounts WHERE provider_id = NEW.id AND name = 'Default'), NEW.created_at),
      NEW.updated_at
    )
    ON CONFLICT(provider_id, name) DO UPDATE SET
      auth_type = excluded.auth_type,
      api_key = excluded.api_key,
      cookies = excluded.cookies,
      extra_headers = excluded.extra_headers,
      enabled = excluded.enabled,
      priority = excluded.priority,
      updated_at = excluded.updated_at;
  END;
`);

export type Provider = {
  id: string;
  name: string;
  type: string;
  base_url: string | null;
  api_key: string | null;
  cookies: string | null;
  extra_headers: string | null;
  enabled: number;
  priority: number;
  notes: string | null;
  created_at: number;
  updated_at: number;
};

export type ProviderAccount = {
  id: string;
  provider_id: string;
  name: string;
  auth_type: string | null;
  api_key: string | null;
  cookies: string | null;
  extra_headers: string | null;
  enabled: number;
  priority: number;
  requests_count: number;
  error_count: number;
  last_used_at: number | null;
  last_error_at: number | null;
  cooldown_until: number | null;
  created_at: number;
  updated_at: number;
};

export type ModelRoute = {
  id: string;
  pattern: string;
  provider_id: string;
  model_override: string | null;
  enabled: number;
};

export type ModelAlias = {
  id: string;
  alias: string;
  provider_id: string;
  upstream_model: string;
  fork: number;
  created_at: number;
  updated_at: number;
};

export type GatewayKey = {
  id: string;
  key_hash: string;
  key_preview: string;
  name: string | null;
  enabled: number;
  requests_count: number;
  tokens_count: number;
  created_at: number;
  last_used_at: number | null;
};

export type RequestLog = {
  id: string;
  gateway_key_id: string | null;
  provider_id: string | null;
  model: string | null;
  endpoint: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  status: number | null;
  latency: number | null;
  error: string | null;
  stream: number;
  created_at: number;
  request_preview: string | null;
  response_preview: string | null;
};

export function getSetting(key: string, defaultValue = ''): string {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? defaultValue;
}

export function setSetting(key: string, value: string): void {
  db.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)').run(key, value, Date.now());
}

export function resetDb(): void {
  db.exec(`
    DROP TABLE IF EXISTS request_logs;
    DROP TABLE IF EXISTS model_routes;
    DROP TABLE IF EXISTS model_aliases;
    DROP TABLE IF EXISTS provider_accounts;
    DROP TABLE IF EXISTS gateway_keys;
    DROP TABLE IF EXISTS providers;
    DROP TABLE IF EXISTS settings;
  `);
  console.log('Database reset.');
}
