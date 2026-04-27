import { type Request, type Response, type NextFunction } from 'express';
import { db } from '../db/index.js';
import { createHash } from 'crypto';
import type { GatewayKey } from '../db/index.js';

declare global {
  namespace Express {
    interface Request {
      gatewayKeyId?: string;
    }
  }
}

function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export function requireGatewayKey(req: Request, res: Response, next: NextFunction): void {
  // Extract key from Authorization header or x-api-key header
  const authHeader = req.headers.authorization;
  const xApiKey = req.headers['x-api-key'] as string | undefined;

  let key: string | undefined;
  if (authHeader?.startsWith('Bearer ')) {
    key = authHeader.slice(7);
  } else if (xApiKey) {
    key = xApiKey;
  }

  // Allow if no keys are configured (open mode)
  const keyCount = (db.prepare('SELECT COUNT(*) as c FROM gateway_keys WHERE enabled = 1').get() as { c: number }).c;
  if (keyCount === 0) {
    next();
    return;
  }

  if (!key) {
    res.status(401).json({
      error: { message: 'API key required. Pass via Authorization: Bearer <key> or x-api-key header.', type: 'authentication_error' },
    });
    return;
  }

  const hash = hashKey(key);
  const record = db.prepare('SELECT * FROM gateway_keys WHERE key_hash = ? AND enabled = 1').get(hash) as GatewayKey | undefined;

  if (!record) {
    res.status(401).json({ error: { message: 'Invalid or disabled API key.', type: 'authentication_error' } });
    return;
  }

  req.gatewayKeyId = record.id;
  next();
}

export function requireAdminPassword(req: Request, res: Response, next: NextFunction): void {
  const adminPwd = process.env.ADMIN_PASSWORD ?? 'changeme123';
  const provided = req.headers['x-admin-password'] as string | undefined;

  if (!provided || provided !== adminPwd) {
    res.status(401).json({ error: 'Admin password required (x-admin-password header)' });
    return;
  }
  next();
}

export function hashApiKey(key: string): string {
  return hashKey(key);
}
