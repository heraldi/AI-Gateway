import type {
  ProviderAdapter, ProviderConfig, NormalizedRequest,
  NormalizedResponse, StreamChunk, ModelInfo, ChatMessage
} from '../types.js';

const DEFAULT_BASE = 'https://api.anthropic.com';
const API_VERSION = '2023-06-01';

function normalizeBase(url: string): string {
  return url.replace(/\/v\d+\/?$/, '').replace(/\/$/, '');
}

function buildHeaders(config: ProviderConfig): Record<string, string> {
  const extraHeaders = { ...(config.extraHeaders ?? {}) };
  const authScheme = extraHeaders['X-Gateway-Auth-Scheme'] ?? extraHeaders['x-gateway-auth-scheme'];
  delete extraHeaders['X-Gateway-Auth-Scheme'];
  delete extraHeaders['x-gateway-auth-scheme'];

  return {
    'Content-Type': 'application/json',
    'anthropic-version': API_VERSION,
    ...(authScheme === 'bearer'
      ? { Authorization: `Bearer ${config.apiKey ?? ''}` }
      : { 'x-api-key': config.apiKey ?? '' }),
    ...extraHeaders,
  };
}

function toAnthropicMessages(messages: ChatMessage[]): { system?: string; messages: object[] } {
  let system: string | undefined;
  const out: object[] = [];

  for (const m of messages) {
    if (m.role === 'system') {
      system = Array.isArray(m.content) ? m.content.map(p => ('text' in p ? p.text : '')).join('') : m.content;
      continue;
    }
    const role = m.role === 'tool' ? 'user' : m.role;
    out.push({
      role,
      content: Array.isArray(m.content)
        ? m.content.map(p => {
            if (p.type === 'image_url') return { type: 'image', source: { type: 'url', url: p.image_url?.url } };
            if (p.type === 'tool_result') return p;
            return { type: 'text', text: p.text ?? '' };
          })
        : m.content,
    });
  }
  return { system, messages: out };
}

export const AnthropicAdapter: ProviderAdapter = {
  type: 'anthropic',

  async listModels(config) {
    const base = normalizeBase(config.baseUrl ?? DEFAULT_BASE);
    const res = await fetch(`${base}/v1/models`, { headers: buildHeaders(config) });
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    const data = await res.json() as { data: { id: string; display_name?: string; created_at?: string }[] };
    return (data.data ?? []).map(m => ({
      id: m.id,
      name: m.display_name ?? m.id,
      owned_by: 'anthropic',
      created: m.created_at ? new Date(m.created_at).getTime() / 1000 : undefined,
    }));
  },

  async complete(config, req) {
    const base = normalizeBase(config.baseUrl ?? DEFAULT_BASE);
    const { system, messages } = toAnthropicMessages(req.messages);
    const body: Record<string, unknown> = {
      model: req.model,
      messages,
      max_tokens: req.max_tokens ?? 4096,
    };
    if (system) body.system = system;
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.top_p !== undefined) body.top_p = req.top_p;
    if (req.stop) body.stop_sequences = Array.isArray(req.stop) ? req.stop : [req.stop];

    const res = await fetch(`${base}/v1/messages`, {
      method: 'POST',
      headers: buildHeaders(config),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Anthropic API error ${res.status}: ${err}`);
    }

    const data = await res.json() as {
      id: string; model: string; stop_reason: string;
      usage: { input_tokens: number; output_tokens: number };
      content: { type: string; text: string }[];
    };

    return {
      id: data.id,
      model: data.model,
      content: data.content.filter(c => c.type === 'text').map(c => c.text).join(''),
      input_tokens: data.usage.input_tokens,
      output_tokens: data.usage.output_tokens,
      finish_reason: data.stop_reason ?? 'end_turn',
    };
  },

  async stream(config, req, onChunk) {
    const base = normalizeBase(config.baseUrl ?? DEFAULT_BASE);
    const { system, messages } = toAnthropicMessages(req.messages);
    const body: Record<string, unknown> = {
      model: req.model,
      messages,
      max_tokens: req.max_tokens ?? 4096,
      stream: true,
    };
    if (system) body.system = system;
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.top_p !== undefined) body.top_p = req.top_p;
    if (req.stop) body.stop_sequences = Array.isArray(req.stop) ? req.stop : [req.stop];

    const res = await fetch(`${base}/v1/messages`, {
      method: 'POST',
      headers: buildHeaders(config),
      body: JSON.stringify(body),
    });

    if (!res.ok || !res.body) {
      const err = await res.text();
      throw new Error(`Anthropic API error ${res.status}: ${err}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let inputTokens = 0;
    let outputTokens = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (!raw) continue;

        try {
          const evt = JSON.parse(raw) as {
            type: string;
            delta?: { type: string; text?: string };
            message?: { usage?: { input_tokens: number; output_tokens: number } };
            usage?: { input_tokens?: number; output_tokens?: number };
            index?: number;
          };

          if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
            onChunk({ delta: evt.delta.text ?? '', done: false });
          } else if (evt.type === 'message_start' && evt.message?.usage) {
            inputTokens = evt.message.usage.input_tokens;
          } else if (evt.type === 'message_delta' && evt.usage) {
            outputTokens = evt.usage.output_tokens ?? 0;
          } else if (evt.type === 'message_stop') {
            onChunk({ delta: '', done: true, input_tokens: inputTokens, output_tokens: outputTokens });
          }
        } catch {
          // ignore parse errors in stream
        }
      }
    }
  },
};

function hardcodedModels(): ModelInfo[] {
  return [
    { id: 'claude-opus-4-7', name: 'Claude Opus 4.7', owned_by: 'anthropic' },
    { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', owned_by: 'anthropic' },
    { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', owned_by: 'anthropic' },
    { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', owned_by: 'anthropic' },
    { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', owned_by: 'anthropic' },
    { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus', owned_by: 'anthropic' },
  ];
}
