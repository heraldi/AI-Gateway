import { db } from '../db/index.js';
import { v4 as uuid } from 'uuid';

interface LogEntry {
  id: string;
  provider_id?: string;
  model?: string;
  endpoint?: string;
  input_tokens?: number;
  output_tokens?: number;
  status?: number;
  latency?: number;
  error?: string;
  stream?: number;
  gateway_key_id?: string;
  req_body?: object;
  res_body?: object;
}

const INSERT = db.prepare(`
  INSERT INTO request_logs
    (id, gateway_key_id, provider_id, model, endpoint, input_tokens, output_tokens, total_tokens,
     status, latency, error, stream, created_at, request_preview, response_preview)
  VALUES
    (@id, @gateway_key_id, @provider_id, @model, @endpoint, @input_tokens, @output_tokens, @total_tokens,
     @status, @latency, @error, @stream, @created_at, @request_preview, @response_preview)
`);

const UPDATE_KEY_USAGE = db.prepare(`
  UPDATE gateway_keys
  SET requests_count = requests_count + 1,
      tokens_count = tokens_count + @tokens,
      last_used_at = @now
  WHERE id = @id
`);

export function logRequest(entry: LogEntry): void {
  try {
    const total = (entry.input_tokens ?? 0) + (entry.output_tokens ?? 0);
    INSERT.run({
      id: entry.id ?? uuid(),
      gateway_key_id: entry.gateway_key_id ?? null,
      provider_id: entry.provider_id ?? null,
      model: entry.model ?? null,
      endpoint: entry.endpoint ?? null,
      input_tokens: entry.input_tokens ?? null,
      output_tokens: entry.output_tokens ?? null,
      total_tokens: total || null,
      status: entry.status ?? null,
      latency: entry.latency ?? null,
      error: entry.error ?? null,
      stream: entry.stream ?? 0,
      created_at: Date.now(),
      request_preview: entry.req_body ? JSON.stringify(entry.req_body).slice(0, 1000) : null,
      response_preview: entry.res_body ? JSON.stringify(entry.res_body).slice(0, 500) : null,
    });

    if (entry.gateway_key_id && total > 0) {
      UPDATE_KEY_USAGE.run({ id: entry.gateway_key_id, tokens: total, now: Date.now() });
    }
  } catch {
    // never crash on logging failure
  }
}
