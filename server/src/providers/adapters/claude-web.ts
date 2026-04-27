/**
 * Claude.ai web adapter - uses browser cookies extracted via Chrome extension.
 * Reverse-engineered from claude.ai network traffic.
 */
import type {
  ProviderAdapter, ProviderConfig, NormalizedRequest,
  NormalizedResponse, StreamChunk, ModelInfo, ChatMessage
} from '../types.js';

const BASE_URL = 'https://claude.ai';

function buildHeaders(config: ProviderConfig): Record<string, string> {
  const cookies = config.cookies ?? {};
  const cookieStr = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');

  return {
    'Content-Type': 'application/json',
    'Cookie': cookieStr,
    'Origin': BASE_URL,
    'Referer': `${BASE_URL}/`,
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    'anthropic-client-platform': 'web_claude_ai',
    ...config.extraHeaders,
  };
}

function messagestoHuman(messages: ChatMessage[]): string {
  return messages
    .filter(m => m.role !== 'system')
    .map(m => {
      const content = Array.isArray(m.content)
        ? m.content.map(p => ('text' in p ? p.text : '[image]')).join('')
        : m.content;
      return content;
    })
    .join('\n\n');
}

async function getOrCreateConversation(config: ProviderConfig): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/organizations`, {
    headers: buildHeaders(config),
  });

  if (!res.ok) throw new Error(`Failed to get org: ${res.status}`);
  const orgs = await res.json() as { uuid: string }[];
  const orgId = orgs[0]?.uuid;
  if (!orgId) throw new Error('No organization found');

  const convRes = await fetch(`${BASE_URL}/api/organizations/${orgId}/chat_conversations`, {
    method: 'POST',
    headers: buildHeaders(config),
    body: JSON.stringify({ name: '', uuid: crypto.randomUUID() }),
  });

  if (!convRes.ok) throw new Error(`Failed to create conversation: ${convRes.status}`);
  const conv = await convRes.json() as { uuid: string };
  return `${orgId}/${conv.uuid}`;
}

export const ClaudeWebAdapter: ProviderAdapter = {
  type: 'claude-web',

  async listModels(_config): Promise<ModelInfo[]> {
    return [
      { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet (Web)', owned_by: 'anthropic' },
      { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku (Web)', owned_by: 'anthropic' },
      { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus (Web)', owned_by: 'anthropic' },
    ];
  },

  async complete(config, req): Promise<NormalizedResponse> {
    let fullContent = '';
    let inputTokens = 0;
    let outputTokens = 0;

    await this.stream(config, req, (chunk) => {
      if (!chunk.done) fullContent += chunk.delta;
      if (chunk.input_tokens) inputTokens = chunk.input_tokens;
      if (chunk.output_tokens) outputTokens = chunk.output_tokens;
    });

    return {
      id: `web-${Date.now()}`,
      model: req.model,
      content: fullContent,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      finish_reason: 'end_turn',
    };
  },

  async stream(config, req, onChunk): Promise<void> {
    const [orgId, convId] = (await getOrCreateConversation(config)).split('/');

    const systemMsg = req.messages.find(m => m.role === 'system');
    const system = systemMsg
      ? (Array.isArray(systemMsg.content) ? systemMsg.content.map(p => ('text' in p ? p.text : '')).join('') : systemMsg.content)
      : undefined;

    const humanContent = messagestoHuman(req.messages);

    const body = {
      prompt: humanContent,
      model: req.model,
      timezone: 'UTC',
      attachments: [],
      files: [],
      ...(system ? { personalized_context: system } : {}),
    };

    const res = await fetch(
      `${BASE_URL}/api/organizations/${orgId}/chat_conversations/${convId}/completion`,
      {
        method: 'POST',
        headers: buildHeaders(config),
        body: JSON.stringify(body),
      }
    );

    if (!res.ok || !res.body) {
      throw new Error(`Claude Web error ${res.status}: ${await res.text()}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const evt = JSON.parse(line.slice(6)) as {
            type: string;
            completion?: string;
            stop?: boolean;
          };
          if (evt.type === 'completion' && evt.completion) {
            onChunk({ delta: evt.completion, done: false });
          } else if (evt.stop) {
            onChunk({ delta: '', done: true });
          }
        } catch {
          // ignore
        }
      }
    }
  },
};
