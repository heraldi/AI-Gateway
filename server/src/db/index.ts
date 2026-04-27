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
    DROP TABLE IF EXISTS gateway_keys;
    DROP TABLE IF EXISTS providers;
    DROP TABLE IF EXISTS settings;
  `);
  console.log('Database reset.');
}
