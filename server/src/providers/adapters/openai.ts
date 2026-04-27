import type {
  ProviderAdapter, ProviderConfig, NormalizedRequest,
  NormalizedResponse, StreamChunk, ModelInfo
} from '../types.js';
import { classifyModelCapability } from '../capabilities.js';

const DEFAULT_BASE = 'https://api.openai.com';

function normalizeBase(url: string): string {
  return url.replace(/\/$/, '');
}

export function openAIEndpoint(baseUrl: string | undefined, path: string): string {
  const base = normalizeBase(baseUrl ?? DEFAULT_BASE);
  if (/\/chat\/completions$/i.test(base)) {
    return path === 'chat/completions'
      ? base
      : base.replace(/\/chat\/completions$/i, `/${path}`);
  }
  if (/\/models$/i.test(base)) {
    return path === 'models'
      ? base
      : base.replace(/\/models$/i, `/${path}`);
  }
  if (/\/v\d+(?:\/[^/]*)?$/i.test(base) || /\/compatible-mode\/v\d+$/i.test(base)) {
    return `${base}/${path}`;
  }
  return `${base}/v1/${path}`;
}

function endpoint(base: string, path: string): string {
  return openAIEndpoint(base, path);
}

export function buildOpenAIHeaders(config: ProviderConfig): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${config.apiKey ?? ''}`,
    ...config.extraHeaders,
  };
}

export function supportsOpenAIJsonEndpoint(config: ProviderConfig): boolean {
  return ['openai', 'openai-compatible', 'ollama', 'gitlab'].includes(config.type);
}

export async function postOpenAIJson(config: ProviderConfig, path: string, body: unknown): Promise<{
  status: number;
  ok: boolean;
  data: unknown;
  text: string;
}> {
  const res = await fetch(openAIEndpoint(config.baseUrl, path), {
    method: 'POST',
    headers: buildOpenAIHeaders(config),
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, ok: res.ok, data, text };
}

export async function postOpenAIBinary(config: ProviderConfig, path: string, body: unknown): Promise<{
  status: number;
  ok: boolean;
  contentType: string;
  data: Buffer;
  text: string;
}> {
  const res = await fetch(openAIEndpoint(config.baseUrl, path), {
    method: 'POST',
    headers: buildOpenAIHeaders(config),
    body: JSON.stringify(body),
  });
  const contentType = res.headers.get('content-type') ?? 'application/octet-stream';
  const data = Buffer.from(await res.arrayBuffer());
  return { status: res.status, ok: res.ok, contentType, data, text: data.toString('utf8') };
}

function looksLikeHtml(text: string): boolean {
  const trimmed = text.trimStart().toLowerCase();
  return trimmed.startsWith('<!doctype html') || trimmed.startsWith('<html');
}

function webPageError(status: number, base: string): Error {
  const lowerBase = base.toLowerCase();
  const hint = lowerBase.includes('devin')
    ? ' Devin is not an OpenAI-compatible chat API; use Devin API endpoints under https://api.devin.ai or build a provider-specific Devin adapter.'
    : lowerBase.includes('qwen') || lowerBase.includes('dashscope')
    ? ' For Qwen, use a DashScope OpenAI-compatible base URL such as https://dashscope-intl.aliyuncs.com/compatible-mode/v1 or https://dashscope.aliyuncs.com/compatible-mode/v1.'
    : '';
  return new Error(
    `HTTP ${status}: ${base} is returning a web page, not an OpenAI-compatible API. Use the provider's API base URL, not the website URL.${hint}`
  );
}

export const OpenAIAdapter: ProviderAdapter = {
  type: 'openai',

  async listModels(config) {
    const base = normalizeBase(config.baseUrl ?? DEFAULT_BASE);
    const url = endpoint(base, 'models');
    const res = await fetch(url, { headers: buildOpenAIHeaders(config) });
    const contentType = res.headers.get('content-type') ?? '';
    const text = await res.text().catch(() => res.statusText);
    if (!res.ok) {
      if (contentType.includes('text/html') || looksLikeHtml(text)) throw webPageError(res.status, base);
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    if (contentType.includes('text/html') || looksLikeHtml(text)) throw webPageError(res.status, base);

    let data: { data?: { id: string; owned_by?: string; created?: number }[] };
    try {
      data = JSON.parse(text) as { data?: { id: string; owned_by?: string; created?: number }[] };
    } catch {
      throw new Error(`HTTP ${res.status}: ${url} did not return valid JSON. Check that the provider base URL points to an OpenAI-compatible API endpoint.`);
    }
    return (data.data ?? []).map(m => ({
      id: m.id,
      name: m.id,
      capability: classifyModelCapability(m.id, m.owned_by),
      owned_by: m.owned_by,
      created: m.created,
    }));
  },

  async complete(config, req) {
    const base = normalizeBase(config.baseUrl ?? DEFAULT_BASE);
    const body: Record<string, unknown> = {
      model: req.model,
      messages: req.messages,
    };
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.max_tokens !== undefined) body.max_tokens = req.max_tokens;
    if (req.top_p !== undefined) body.top_p = req.top_p;
    if (req.stop) body.stop = req.stop;

    const res = await fetch(endpoint(base, 'chat/completions'), {
      method: 'POST',
      headers: buildOpenAIHeaders(config),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenAI API error ${res.status}: ${err}`);
    }

    const data = await res.json() as {
      id: string; model: string;
      choices: { message: { content: string }; finish_reason: string }[];
      usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    };

    return {
      id: data.id,
      model: data.model,
      content: data.choices[0]?.message?.content ?? '',
      input_tokens: data.usage.prompt_tokens,
      output_tokens: data.usage.completion_tokens,
      finish_reason: data.choices[0]?.finish_reason ?? 'stop',
    };
  },

  async stream(config, req, onChunk) {
    const base = normalizeBase(config.baseUrl ?? DEFAULT_BASE);
    const body: Record<string, unknown> = {
      model: req.model,
      messages: req.messages,
      stream: true,
      stream_options: { include_usage: true },
    };
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.max_tokens !== undefined) body.max_tokens = req.max_tokens;
    if (req.top_p !== undefined) body.top_p = req.top_p;
    if (req.stop) body.stop = req.stop;

    const res = await fetch(endpoint(base, 'chat/completions'), {
      method: 'POST',
      headers: buildOpenAIHeaders(config),
      body: JSON.stringify(body),
    });

    if (!res.ok || !res.body) {
      const err = await res.text();
      throw new Error(`OpenAI API error ${res.status}: ${err}`);
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
        if (raw === '[DONE]') {
          onChunk({ delta: '', done: true, input_tokens: inputTokens, output_tokens: outputTokens });
          return;
        }

        try {
          const evt = JSON.parse(raw) as {
            choices?: { delta?: { content?: string }; finish_reason?: string }[];
            usage?: { prompt_tokens?: number; completion_tokens?: number };
          };

          const delta = evt.choices?.[0]?.delta?.content;
          if (delta) onChunk({ delta, done: false });

          if (evt.usage) {
            inputTokens = evt.usage.prompt_tokens ?? 0;
            outputTokens = evt.usage.completion_tokens ?? 0;
          }

          if (evt.choices?.[0]?.finish_reason) {
            onChunk({ delta: '', done: true, input_tokens: inputTokens, output_tokens: outputTokens, finish_reason: evt.choices[0].finish_reason ?? undefined });
          }
        } catch {
          // ignore
        }
      }
    }
  },
};

export const OpenAICompatibleAdapter: ProviderAdapter = {
  ...OpenAIAdapter,
  type: 'openai-compatible',
};
