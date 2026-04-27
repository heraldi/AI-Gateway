/**
 * Bud web adapter.
 *
 * Bud is a web app backed by Clerk auth and an internal Orchids/Bud backend,
 * not an OpenAI-compatible /v1 API. The public app bundle exposes the model
 * choices, but the prompt submission flow is project/session based and can
 * change independently of the website URL.
 */
import type {
  ProviderAdapter, ProviderConfig, NormalizedRequest,
  NormalizedResponse, ModelInfo
} from '../types.js';
import { randomUUID } from 'node:crypto';

const BASE_URL = 'https://bud.app';
const BACKEND_URL = 'https://orchids-server-bud.braveriver-4d4284a6.westus.azurecontainerapps.io';
const CLERK_FRONTEND_URL = 'https://clerk.bud.app';
const API_VERSION_HEADER = 'X-Orchids-API-Version';

const BUD_MODELS: ModelInfo[] = [
  { id: 'auto', name: 'Auto (Bud)', owned_by: 'bud' },
  { id: 'claude-sonnet-4-6', name: 'Sonnet 4.6 (Bud)', owned_by: 'anthropic' },
  { id: 'claude-opus-4.6', name: 'Opus 4.6 (Bud)', owned_by: 'anthropic' },
  { id: 'gpt-5.5', name: 'GPT-5.5 (Bud)', owned_by: 'openai' },
  { id: 'gpt-5.4', name: 'GPT-5.4 (Bud)', owned_by: 'openai' },
  { id: 'gpt-5.3-codex', name: 'GPT-5.3 Codex (Bud)', owned_by: 'openai' },
];

function cookieHeader(config: ProviderConfig): string {
  return Object.entries(config.cookies ?? {})
    .map(([key, value]) => `${key}=${value}`)
    .join('; ');
}

function clerkSessionToken(config: ProviderConfig): string | undefined {
  const cookies = config.cookies ?? {};
  return cookies.__clerk_bearer
    ?? cookies.__session
    ?? cookies['__Secure-next-auth.session-token']
    ?? cookies.session
    ?? config.apiKey;
}

function jwtExpiresAt(token: string): number | null {
  const [, payload] = token.split('.');
  if (!payload) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')) as { exp?: unknown };
    return typeof decoded.exp === 'number' ? decoded.exp * 1000 : null;
  } catch {
    return null;
  }
}

function validStoredBearer(config: ProviderConfig): string | undefined {
  const token = clerkSessionToken(config);
  if (!token) return undefined;
  const expiresAt = jwtExpiresAt(token);
  if (expiresAt && expiresAt - Date.now() < 60_000) return undefined;
  return token;
}

function buildHeaders(config: ProviderConfig): Record<string, string> {
  const token = validStoredBearer(config);
  return {
    'Content-Type': 'application/json',
    'Accept': 'text/event-stream',
    [API_VERSION_HEADER]: '5',
    ...(cookieHeader(config) ? { Cookie: cookieHeader(config) } : {}),
    'Origin': BASE_URL,
    'Referer': `${BASE_URL}/`,
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function ensureBudSession(config: ProviderConfig): void {
  if (!cookieHeader(config) && !clerkSessionToken(config)) {
    throw new Error('Bud Web requires cookies from a logged-in bud.app session.');
  }
}

function activeClerkSessionId(config: ProviderConfig, client?: unknown): string | undefined {
  const fromCookie = config.cookies?.clerk_active_context?.replace(/:$/, '');
  if (fromCookie?.startsWith('sess_')) return fromCookie;

  if (client && typeof client === 'object') {
    const c = client as { last_active_session_id?: unknown; response?: unknown; sessions?: unknown };
    if (typeof c.last_active_session_id === 'string') return c.last_active_session_id;
    if (c.response && typeof c.response === 'object') {
      const r = c.response as { last_active_session_id?: unknown; sessions?: unknown };
      if (typeof r.last_active_session_id === 'string') return r.last_active_session_id;
      if (Array.isArray(r.sessions)) {
        const session = r.sessions.find(s => !!s && typeof s === 'object' && typeof (s as { id?: unknown }).id === 'string') as { id?: string } | undefined;
        if (session?.id) return session.id;
      }
    }
    if (Array.isArray(c.sessions)) {
      const session = c.sessions.find(s => !!s && typeof s === 'object' && typeof (s as { id?: unknown }).id === 'string') as { id?: string } | undefined;
      if (session?.id) return session.id;
    }
  }
  return undefined;
}

async function mintClerkBearer(config: ProviderConfig): Promise<string | undefined> {
  const cookies = config.cookies ?? {};
  if (!cookies.__client && !Object.keys(cookies).some(key => key.startsWith('__client_'))) return undefined;

  const commonHeaders = {
    'Accept': 'application/json',
    'Cookie': cookieHeader(config),
    'Origin': BASE_URL,
    'Referer': `${BASE_URL}/`,
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  };

  const clientRes = await fetch(`${CLERK_FRONTEND_URL}/v1/client?_clerk_js_version=5`, {
    headers: commonHeaders,
  });
  const client = await clientRes.json().catch(() => null) as unknown;
  const sessionId = activeClerkSessionId(config, client);
  if (!sessionId) return undefined;

  const tokenRes = await fetch(`${CLERK_FRONTEND_URL}/v1/client/sessions/${encodeURIComponent(sessionId)}/tokens?_clerk_js_version=5`, {
    method: 'POST',
    headers: {
      ...commonHeaders,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: '',
  });
  if (!tokenRes.ok) return undefined;

  const tokenJson = await tokenRes.json().catch(() => null) as { jwt?: unknown; response?: { jwt?: unknown } } | null;
  const jwt = typeof tokenJson?.jwt === 'string'
    ? tokenJson.jwt
    : typeof tokenJson?.response?.jwt === 'string'
      ? tokenJson.response.jwt
      : undefined;
  return jwt;
}

async function buildAuthHeaders(config: ProviderConfig): Promise<Record<string, string>> {
  const minted = await mintClerkBearer(config).catch(() => undefined);
  const token = minted ?? validStoredBearer(config);
  return {
    'Content-Type': 'application/json',
    'Accept': 'text/event-stream',
    [API_VERSION_HEADER]: '5',
    ...(cookieHeader(config) ? { Cookie: cookieHeader(config) } : {}),
    'Origin': BASE_URL,
    'Referer': `${BASE_URL}/`,
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function setting(config: ProviderConfig, key: string): string | undefined {
  const headers = config.extraHeaders ?? {};
  const cookies = config.cookies ?? {};
  return headers[key]
    ?? headers[key.toLowerCase()]
    ?? headers[`X-Bud-${key}`]
    ?? headers[`x-bud-${key.toLowerCase()}`]
    ?? cookies[key]
    ?? cookies[key.toLowerCase()]
    ?? cookies[`bud_${key.toLowerCase()}`];
}

function requireSetting(config: ProviderConfig, key: string): string {
  const value = setting(config, key);
  if (!value) {
    throw new Error(
      `Bud Web requires ${key}. Add it to provider extra_headers as "X-Bud-${key}" or to the injected cookie JSON as "bud_${key.toLowerCase()}".`
    );
  }
  return value;
}

function contentToText(content: NormalizedRequest['messages'][number]['content']): string {
  if (typeof content === 'string') return content;
  return content
    .filter(part => part.type === 'text' && typeof part.text === 'string')
    .map(part => part.text)
    .join('\n');
}

function promptFromRequest(req: NormalizedRequest): string {
  const user = [...req.messages].reverse().find(m => m.role === 'user');
  const prompt = user ? contentToText(user.content).trim() : '';
  if (!prompt) throw new Error('Bud Web requires at least one user text message.');
  return prompt;
}

function estimateTokens(text: string): number {
  const normalized = text.trim();
  if (!normalized) return 0;
  return Math.max(1, Math.ceil(normalized.length / 4));
}

function requestText(req: NormalizedRequest): string {
  const messages = req.messages
    .map(message => `${message.role}: ${contentToText(message.content)}`)
    .join('\n');
  return req.system ? `system: ${req.system}\n${messages}` : messages;
}

function splitSse(buffer: string): { blocks: string[]; remainder: string } {
  const blocks = buffer.replace(/\r\n/g, '\n').split('\n\n');
  return { blocks: blocks.slice(0, -1), remainder: blocks.at(-1) ?? '' };
}

function sseData(block: string): string | null {
  const lines = block
    .split('\n')
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice(5).trimStart());
  return lines.length > 0 ? lines.join('\n') : null;
}

function isInternalBudOutput(text: string): boolean {
  return /^__ORCHIDS_[A-Z_]+__(?:=|:)/.test(text.trim());
}

function extractText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const event = payload as { type?: unknown; data?: unknown };
  const data = event.data;
  if (event.type === 'orchids.output' && typeof data === 'string') {
    return isInternalBudOutput(data) ? '' : data;
  }
  if (!data || typeof data !== 'object') return '';

  const d = data as Record<string, unknown>;
  if (typeof d.delta === 'string') return isInternalBudOutput(d.delta) ? '' : d.delta;
  if (typeof d.text === 'string') return isInternalBudOutput(d.text) ? '' : d.text;
  if (typeof d.content === 'string' && (
    event.type === 'response.output_text.delta' ||
    event.type === 'output_text_delta' ||
    event.type === 'message_delta'
  )) return isInternalBudOutput(d.content) ? '' : d.content;

  return '';
}

function messageContent(message: { content?: unknown; parts?: unknown }): string | null {
  if (typeof message.content === 'string' && message.content.trim()) return message.content;
  if (Array.isArray(message.parts)) {
    const text = message.parts
      .filter(part => !!part && typeof part === 'object' && (part as { type?: unknown }).type === 'text')
      .map(part => (part as { content?: unknown }).content)
      .filter((content): content is string => typeof content === 'string')
      .join('');
    return text.trim() ? text : null;
  }
  return null;
}

async function fetchAssistantMessage(
  config: ProviderConfig,
  projectId: string,
  chatSessionId: string,
  assistantClientMessageId: string
): Promise<string | null> {
  const token = await mintClerkBearer(config).catch(() => undefined) ?? validStoredBearer(config);
  const res = await fetch(
    `${BACKEND_URL}/messages/${encodeURIComponent(projectId)}/paginated?limit=10&chatSessionId=${encodeURIComponent(chatSessionId)}`,
    {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    }
  );
  if (!res.ok) return null;
  const json = await res.json().catch(() => null) as { messages?: unknown[] } | null;
  const messages = Array.isArray(json?.messages) ? json.messages : [];
  const assistantMessages = messages.filter(msg => {
    return !!msg && typeof msg === 'object' && (msg as { role?: unknown }).role === 'assistant';
  }) as { content?: unknown; parts?: unknown; metadata?: unknown }[];

  const exact = assistantMessages.find(msg => {
    return !!msg.metadata &&
      typeof msg.metadata === 'object' &&
      (msg.metadata as { clientMessageId?: unknown }).clientMessageId === assistantClientMessageId;
  });
  if (exact) return messageContent(exact);

  return null;
}

async function waitForAssistantMessage(
  config: ProviderConfig,
  projectId: string,
  chatSessionId: string,
  assistantClientMessageId: string
): Promise<string | null> {
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const content = await fetchAssistantMessage(config, projectId, chatSessionId, assistantClientMessageId);
    if (content) return content;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return null;
}

export const BudWebAdapter: ProviderAdapter = {
  type: 'bud-web',

  async listModels(): Promise<ModelInfo[]> {
    return BUD_MODELS;
  },

  async complete(config, req): Promise<NormalizedResponse> {
    let content = '';
    let inputTokens = 0;
    let outputTokens = 0;
    await this.stream(config, req, chunk => {
      if (!chunk.done) content += chunk.delta;
      if (chunk.input_tokens !== undefined) inputTokens = chunk.input_tokens;
      if (chunk.output_tokens !== undefined) outputTokens = chunk.output_tokens;
    });
    return {
      id: `bud-web-${Date.now()}`,
      model: req.model,
      content,
      input_tokens: inputTokens || estimateTokens(requestText(req)),
      output_tokens: outputTokens || estimateTokens(content),
      finish_reason: 'stop',
    };
  },

  async stream(config, req, onChunk): Promise<void> {
    ensureBudSession(config);
    const projectId = requireSetting(config, 'ProjectId');
    const userId = requireSetting(config, 'UserId');
    const chatSessionId = setting(config, 'ChatSessionId');
    const assistantClientMessageId = randomUUID();
    const prompt = promptFromRequest(req);
    const runtimeHint = req.model.startsWith('gpt-') ? 'codex' : 'claude';
    const inputTokens = estimateTokens(requestText(req));

    const body = {
      projectId,
      userId,
      template: setting(config, 'Template') ?? 'nextjs',
      prompt,
      assistantClientMessageId,
      model: req.model,
      mode: 'agent',
      ...(chatSessionId ? { chatSessionId } : {}),
      orchidsRuntimeHint: setting(config, 'RuntimeHint') ?? runtimeHint,
    };

    const res = await fetch(`${BACKEND_URL}/sandbox/orchids/stream-run`, {
      method: 'POST',
      headers: await buildAuthHeaders(config),
      body: JSON.stringify(body),
    });

    const isJson = (res.headers.get('content-type') ?? '').toLowerCase().includes('application/json');
    if (!res.ok) {
      const err = isJson ? await res.json().catch(() => null) : await res.text().catch(() => '');
      if (res.status === 401) {
        throw new Error(
          'Bud authentication expired. Re-extract Bud cookies once with the updated extension so the gateway stores Clerk frontend cookies for server-side refresh.'
        );
      }
      throw new Error(`Bud stream-run failed ${res.status}: ${typeof err === 'string' ? err : JSON.stringify(err)}`);
    }

    let collected = '';
    if (isJson) {
      const json = await res.json().catch(() => null);
      const delta = extractText(json);
      if (delta) {
        collected += delta;
        onChunk({ delta, done: false, model: req.model });
      }
    } else {
      const reader = res.body?.getReader();
      if (!reader) throw new Error('Bud stream-run returned no response body.');

      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parsed = splitSse(buffer);
        buffer = parsed.remainder;
        for (const block of parsed.blocks) {
          const data = sseData(block);
          if (!data) continue;
          const payload = JSON.parse(data) as unknown;
          const delta = extractText(payload);
          if (delta) {
            collected += delta;
            onChunk({ delta, done: false, model: req.model });
          }
        }
      }
    }

    if (chatSessionId) {
      const finalContent = await waitForAssistantMessage(config, projectId, chatSessionId, assistantClientMessageId);
      if (finalContent && finalContent !== collected) {
        const replacement = collected && finalContent.startsWith(collected)
          ? finalContent.slice(collected.length)
          : finalContent;
        collected += replacement;
        onChunk({ delta: replacement, done: false, model: req.model });
      }
    }

    onChunk({
      delta: '',
      done: true,
      model: req.model,
      input_tokens: inputTokens,
      output_tokens: estimateTokens(collected),
      finish_reason: 'stop',
    });
  },
};
