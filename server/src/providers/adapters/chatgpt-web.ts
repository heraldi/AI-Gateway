/**
 * ChatGPT web adapter - uses browser cookies extracted via Chrome extension.
 * Uses chat.openai.com unofficial API.
 */
import type {
  ProviderAdapter, ProviderConfig, NormalizedRequest,
  NormalizedResponse, StreamChunk, ModelInfo, ChatMessage
} from '../types.js';

const BASE_URL = 'https://chatgpt.com';

function buildHeaders(config: ProviderConfig): Record<string, string> {
  const cookies = config.cookies ?? {};
  const cookieStr = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  const authToken = cookies['__Secure-next-auth.session-token'] ?? cookies['accessToken'] ?? '';

  return {
    'Content-Type': 'application/json',
    'Cookie': cookieStr,
    'Authorization': authToken ? `Bearer ${authToken}` : '',
    'Origin': BASE_URL,
    'Referer': `${BASE_URL}/`,
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    ...config.extraHeaders,
  };
}

async function getAccessToken(config: ProviderConfig): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/auth/session`, { headers: buildHeaders(config) });
  if (!res.ok) throw new Error('Failed to get ChatGPT session');
  const data = await res.json() as { accessToken?: string };
  return data.accessToken ?? '';
}

function buildMessages(messages: ChatMessage[]): object[] {
  return messages
    .filter(m => m.role !== 'system')
    .map(m => ({
      id: crypto.randomUUID(),
      author: { role: m.role === 'assistant' ? 'assistant' : 'user' },
      content: {
        content_type: 'text',
        parts: [Array.isArray(m.content) ? m.content.map(p => ('text' in p ? p.text : '')).join('') : m.content],
      },
    }));
}

const WEB_MODEL_MAP: Record<string, string> = {
  'gpt-4o': 'gpt-4o',
  'gpt-4o-mini': 'gpt-4o-mini',
  'gpt-4': 'gpt-4',
  'o1': 'o1',
  'o1-mini': 'o1-mini',
};

export const ChatGPTWebAdapter: ProviderAdapter = {
  type: 'chatgpt-web',

  async listModels(_config): Promise<ModelInfo[]> {
    return [
      { id: 'gpt-4o', name: 'GPT-4o (Web)', owned_by: 'openai' },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini (Web)', owned_by: 'openai' },
      { id: 'gpt-4', name: 'GPT-4 (Web)', owned_by: 'openai' },
      { id: 'o1', name: 'o1 (Web)', owned_by: 'openai' },
    ];
  },

  async complete(config, req): Promise<NormalizedResponse> {
    let fullContent = '';
    await this.stream(config, req, (chunk) => {
      if (!chunk.done) fullContent += chunk.delta;
    });
    return {
      id: `chatgpt-web-${Date.now()}`,
      model: req.model,
      content: fullContent,
      input_tokens: 0,
      output_tokens: 0,
      finish_reason: 'stop',
    };
  },

  async stream(config, req, onChunk): Promise<void> {
    const accessToken = await getAccessToken(config);
    const systemMsg = req.messages.find(m => m.role === 'system');
    const systemContent = systemMsg
      ? (Array.isArray(systemMsg.content) ? systemMsg.content.map(p => ('text' in p ? p.text : '')).join('') : systemMsg.content)
      : undefined;

    const webModel = WEB_MODEL_MAP[req.model] ?? req.model;

    const body: Record<string, unknown> = {
      action: 'next',
      messages: buildMessages(req.messages),
      model: webModel,
      parent_message_id: crypto.randomUUID(),
      timezone_offset_min: 0,
      history_and_training_disabled: false,
      conversation_mode: { kind: 'primary_assistant' },
    };
    if (systemContent) body.system_prompt = systemContent;

    const headers = buildHeaders(config);
    if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;

    const res = await fetch(`${BASE_URL}/backend-api/conversation`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!res.ok || !res.body) {
      throw new Error(`ChatGPT Web error ${res.status}: ${await res.text()}`);
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
        const raw = line.slice(6).trim();
        if (raw === '[DONE]') {
          onChunk({ delta: '', done: true });
          return;
        }
        try {
          const evt = JSON.parse(raw) as {
            message?: {
              content?: { parts?: string[] };
              status?: string;
              end_turn?: boolean;
            };
          };
          const parts = evt.message?.content?.parts;
          if (parts?.length) {
            onChunk({ delta: parts.join(''), done: false });
          }
          if (evt.message?.end_turn) {
            onChunk({ delta: '', done: true });
          }
        } catch {
          // ignore
        }
      }
    }
  },
};
