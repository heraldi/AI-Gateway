/**
 * OpenAI-compatible API endpoints.
 * Clients that use OpenAI SDK can point baseURL here.
 */
import { Router, type Request, type Response } from 'express';
import { v4 as uuid } from 'uuid';
import { resolveProvider, fetchAllModels } from '../providers/registry.js';
import type { NormalizedRequest } from '../providers/types.js';
import { logRequest } from '../middleware/logger.js';
import { compressNormalizedRequest, formatTokenSaverLog } from '../providers/token-saver.js';

export const openaiRouter = Router();

// GET /v1/models
openaiRouter.get('/models', async (_req, res) => {
  const { models } = await fetchAllModels();
  const seen = new Set<string>();
  const unique = models.filter(m => seen.has(m.id) ? false : (seen.add(m.id), true));

  res.json({
    object: 'list',
    data: unique.map(m => ({
      id: m.id,
      object: 'model',
      created: m.created ?? Math.floor(Date.now() / 1000),
      owned_by: m.owned_by ?? 'custom',
    })),
  });
});

// POST /v1/chat/completions
openaiRouter.post('/chat/completions', async (req: Request, res: Response) => {
  const start = Date.now();
  const body = req.body as {
    model: string;
    messages: NormalizedRequest['messages'];
    stream?: boolean;
    temperature?: number;
    max_tokens?: number;
    top_p?: number;
    stop?: string | string[];
  };

  const { model, messages, stream = false } = body;

  if (!model || !messages?.length) {
    res.status(400).json({ error: { message: 'model and messages are required', type: 'invalid_request_error' } });
    return;
  }

  const resolved = resolveProvider(model);
  if (!resolved) {
    res.status(404).json({ error: { message: `No provider found for model: ${model}`, type: 'model_not_found' } });
    return;
  }

  const { adapter, config, resolvedModel } = resolved;
  const normalizedReq: NormalizedRequest = {
    model: resolvedModel,
    messages,
    stream,
    temperature: body.temperature,
    max_tokens: body.max_tokens,
    top_p: body.top_p,
    stop: body.stop,
  };
  const tokenSaverStats = compressNormalizedRequest(normalizedReq);
  const tokenSaverLog = formatTokenSaverLog(tokenSaverStats);
  if (tokenSaverLog) console.log(tokenSaverLog);

  const requestId = `chatcmpl-${uuid().replace(/-/g, '').slice(0, 24)}`;
  const gatewayKeyId = (req as Request & { gatewayKeyId?: string }).gatewayKeyId;

  if (stream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    let inputTokens = 0;
    let outputTokens = 0;
    let fullContent = '';
    let errored = false;

    try {
      await adapter.stream(config, normalizedReq, (chunk) => {
        if (chunk.input_tokens) inputTokens = chunk.input_tokens;
        if (chunk.output_tokens) outputTokens = chunk.output_tokens;

        if (chunk.done) {
          res.write(`data: ${JSON.stringify({
            id: requestId,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: resolvedModel,
            choices: [{ index: 0, delta: {}, finish_reason: chunk.finish_reason ?? 'stop' }],
          })}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
        } else {
          fullContent += chunk.delta;
          res.write(`data: ${JSON.stringify({
            id: requestId,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: resolvedModel,
            choices: [{ index: 0, delta: { role: 'assistant', content: chunk.delta }, finish_reason: null }],
          })}\n\n`);
        }
      });
    } catch (err) {
      errored = true;
      const msg = err instanceof Error ? err.message : String(err);
      res.write(`data: ${JSON.stringify({ error: { message: msg, type: 'api_error' } })}\n\n`);
      res.end();
      logRequest({ id: requestId, provider_id: config.id, model: resolvedModel, endpoint: 'chat.completions', input_tokens: 0, output_tokens: 0, status: 500, latency: Date.now() - start, error: msg, stream: 1, gateway_key_id: gatewayKeyId, req_body: body });
    }

    if (!errored) {
      logRequest({ id: requestId, provider_id: config.id, model: resolvedModel, endpoint: 'chat.completions', input_tokens: inputTokens, output_tokens: outputTokens, status: 200, latency: Date.now() - start, stream: 1, gateway_key_id: gatewayKeyId, req_body: body, res_body: { content: fullContent.slice(0, 500) } });
    }
  } else {
    try {
      const result = await adapter.complete(config, normalizedReq);
      const response = {
        id: requestId,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: result.model,
        choices: [{
          index: 0,
          message: { role: 'assistant', content: result.content },
          finish_reason: result.finish_reason,
        }],
        usage: {
          prompt_tokens: result.input_tokens,
          completion_tokens: result.output_tokens,
          total_tokens: result.input_tokens + result.output_tokens,
        },
      };
      res.json(response);
      logRequest({ id: requestId, provider_id: config.id, model: resolvedModel, endpoint: 'chat.completions', input_tokens: result.input_tokens, output_tokens: result.output_tokens, status: 200, latency: Date.now() - start, stream: 0, gateway_key_id: gatewayKeyId, req_body: body, res_body: { content: result.content.slice(0, 500) } });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: { message: msg, type: 'api_error' } });
      logRequest({ id: requestId, provider_id: config.id, model: resolvedModel, endpoint: 'chat.completions', input_tokens: 0, output_tokens: 0, status: 500, latency: Date.now() - start, error: msg, stream: 0, gateway_key_id: gatewayKeyId, req_body: body });
    }
  }
});

// POST /v1/completions (legacy, map to chat)
openaiRouter.post('/completions', async (req: Request, res: Response) => {
  const body = req.body as { model: string; prompt: string; stream?: boolean; max_tokens?: number; temperature?: number };
  req.body = {
    ...body,
    messages: [{ role: 'user', content: body.prompt }],
  };
  // delegate to chat/completions handler via next but simpler: just handle inline
  res.status(400).json({ error: { message: 'Use /v1/chat/completions instead', type: 'deprecated' } });
});
