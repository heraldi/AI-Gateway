/**
 * Anthropic-compatible API endpoints.
 * Clients using Anthropic SDK can point baseURL here.
 */
import { Router, type Request, type Response } from 'express';
import { v4 as uuid } from 'uuid';
import { resolveProvider, fetchAllModels } from '../providers/registry.js';
import type { NormalizedRequest } from '../providers/types.js';
import { logRequest } from '../middleware/logger.js';
import { compressNormalizedRequest, formatTokenSaverLog } from '../providers/token-saver.js';

export const anthropicRouter = Router();

// GET /v1/models
anthropicRouter.get('/models', async (_req, res) => {
  const { models } = await fetchAllModels();
  const seen = new Set<string>();
  const unique = models.filter(m => seen.has(m.id) ? false : (seen.add(m.id), true));

  res.json({
    data: unique.map(m => ({
      type: 'model',
      id: m.id,
      display_name: m.name,
      created_at: m.created
        ? new Date(m.created * 1000).toISOString()
        : new Date().toISOString(),
    })),
  });
});

// POST /v1/messages
anthropicRouter.post('/messages', async (req: Request, res: Response) => {
  const start = Date.now();
  const body = req.body as {
    model: string;
    messages: { role: 'user' | 'assistant'; content: string | object[] }[];
    system?: string;
    stream?: boolean;
    max_tokens?: number;
    temperature?: number;
    top_p?: number;
    stop_sequences?: string[];
  };

  const { model, messages, system, stream = false } = body;

  if (!model || !messages?.length) {
    res.status(400).json({ type: 'error', error: { type: 'invalid_request_error', message: 'model and messages are required' } });
    return;
  }

  const resolved = resolveProvider(model);
  if (!resolved) {
    res.status(404).json({ type: 'error', error: { type: 'not_found_error', message: `No provider found for model: ${model}` } });
    return;
  }

  const { adapter, config, resolvedModel } = resolved;

  // Normalize messages: inject system as first message if provided
  const normalizedMessages: NormalizedRequest['messages'] = system
    ? [{ role: 'system', content: system }, ...messages.map(m => ({ role: m.role, content: m.content as NormalizedRequest['messages'][number]['content'] }))]
    : messages.map(m => ({ role: m.role, content: m.content as NormalizedRequest['messages'][number]['content'] }));

  const normalizedReq: NormalizedRequest = {
    model: resolvedModel,
    messages: normalizedMessages,
    stream,
    max_tokens: body.max_tokens,
    temperature: body.temperature,
    top_p: body.top_p,
    stop: body.stop_sequences,
  };
  const tokenSaverStats = compressNormalizedRequest(normalizedReq);
  const tokenSaverLog = formatTokenSaverLog(tokenSaverStats);
  if (tokenSaverLog) console.log(tokenSaverLog);

  const requestId = `msg_${uuid().replace(/-/g, '').slice(0, 24)}`;
  const gatewayKeyId = (req as Request & { gatewayKeyId?: string }).gatewayKeyId;

  if (stream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const sendEvent = (type: string, data: object) => {
      res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    sendEvent('message_start', {
      type: 'message_start',
      message: { id: requestId, type: 'message', role: 'assistant', content: [], model: resolvedModel, stop_reason: null, usage: { input_tokens: 0, output_tokens: 0 } },
    });
    sendEvent('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
    sendEvent('ping', { type: 'ping' });

    let inputTokens = 0;
    let outputTokens = 0;
    let fullContent = '';
    let errored = false;

    try {
      await adapter.stream(config, normalizedReq, (chunk) => {
        if (chunk.input_tokens) inputTokens = chunk.input_tokens;
        if (chunk.output_tokens) outputTokens = chunk.output_tokens;

        if (chunk.done) {
          sendEvent('content_block_stop', { type: 'content_block_stop', index: 0 });
          sendEvent('message_delta', {
            type: 'message_delta',
            delta: { stop_reason: 'end_turn', stop_sequence: null },
            usage: { output_tokens: outputTokens },
          });
          sendEvent('message_stop', { type: 'message_stop' });
          res.end();
        } else {
          fullContent += chunk.delta;
          sendEvent('content_block_delta', {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: chunk.delta },
          });
        }
      });
    } catch (err) {
      errored = true;
      const msg = err instanceof Error ? err.message : String(err);
      sendEvent('error', { type: 'error', error: { type: 'api_error', message: msg } });
      res.end();
      logRequest({ id: requestId, provider_id: config.id, model: resolvedModel, endpoint: 'messages', input_tokens: 0, output_tokens: 0, status: 500, latency: Date.now() - start, error: msg, stream: 1, gateway_key_id: gatewayKeyId, req_body: body });
    }

    if (!errored) {
      logRequest({ id: requestId, provider_id: config.id, model: resolvedModel, endpoint: 'messages', input_tokens: inputTokens, output_tokens: outputTokens, status: 200, latency: Date.now() - start, stream: 1, gateway_key_id: gatewayKeyId, req_body: body, res_body: { content: fullContent.slice(0, 500) } });
    }
  } else {
    try {
      const result = await adapter.complete(config, normalizedReq);
      const response = {
        id: requestId,
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: result.content }],
        model: result.model,
        stop_reason: result.finish_reason === 'stop' ? 'end_turn' : result.finish_reason,
        stop_sequence: null,
        usage: { input_tokens: result.input_tokens, output_tokens: result.output_tokens },
      };
      res.json(response);
      logRequest({ id: requestId, provider_id: config.id, model: resolvedModel, endpoint: 'messages', input_tokens: result.input_tokens, output_tokens: result.output_tokens, status: 200, latency: Date.now() - start, stream: 0, gateway_key_id: gatewayKeyId, req_body: body, res_body: { content: result.content.slice(0, 500) } });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ type: 'error', error: { type: 'api_error', message: msg } });
      logRequest({ id: requestId, provider_id: config.id, model: resolvedModel, endpoint: 'messages', input_tokens: 0, output_tokens: 0, status: 500, latency: Date.now() - start, error: msg, stream: 0, gateway_key_id: gatewayKeyId, req_body: body });
    }
  }
});
