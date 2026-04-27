import type { NormalizedRequest, ChatMessage, ContentPart } from './types.js';
import { getSetting } from '../db/index.js';

const MIN_COMPRESS_SIZE = 1200;
const RAW_CAP = 800_000;
const HEAD_LINES = 80;
const TAIL_LINES = 40;
const MAX_LINES_PER_BUCKET = 60;

export type TokenSaverStats = {
  bytesBefore: number;
  bytesAfter: number;
  hits: { shape: string; filter: string; saved: number }[];
};

type TextFilter = ((input: string) => string) & { filterName?: string };

export function isTokenSaverEnabled(): boolean {
  const stored = getSetting('token_saver_enabled', process.env.TOKEN_SAVER ?? 'false');
  return stored === '1' || stored.toLowerCase() === 'true';
}

export function compressNormalizedRequest(req: NormalizedRequest, enabled = isTokenSaverEnabled()): TokenSaverStats | null {
  if (!enabled || !Array.isArray(req.messages)) return null;
  const stats: TokenSaverStats = { bytesBefore: 0, bytesAfter: 0, hits: [] };

  for (const msg of req.messages) compressMessage(msg, stats);

  if (!stats.hits.length) return null;
  return stats;
}

export function formatTokenSaverLog(stats: TokenSaverStats | null): string | null {
  if (!stats?.hits.length) return null;
  const saved = stats.bytesBefore - stats.bytesAfter;
  const pct = stats.bytesBefore > 0 ? ((saved / stats.bytesBefore) * 100).toFixed(1) : '0.0';
  const filters = Array.from(new Set(stats.hits.map(h => h.filter))).join(',');
  return `[TokenSaver] saved ${saved}B / ${stats.bytesBefore}B (${pct}%) via [${filters}] hits=${stats.hits.length}`;
}

function compressMessage(msg: ChatMessage, stats: TokenSaverStats): void {
  if (msg.role === 'tool') {
    if (typeof msg.content === 'string') {
      msg.content = compressText(msg.content, stats, 'openai-tool');
      return;
    }
    if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === 'text' && typeof part.text === 'string') {
          part.text = compressText(part.text, stats, 'openai-tool-array');
        }
      }
      return;
    }
  }

  if (!Array.isArray(msg.content)) return;
  for (const block of msg.content) {
    if (!block || block.type !== 'tool_result' || block.is_error === true) continue;
    if (typeof block.content === 'string') {
      block.content = compressText(block.content, stats, 'claude-tool-result');
    } else if (Array.isArray(block.content)) {
      for (const part of block.content as ContentPart[]) {
        if (part?.type === 'text' && typeof part.text === 'string') {
          part.text = compressText(part.text, stats, 'claude-tool-result-array');
        }
      }
    }
  }
}

function compressText(text: string, stats: TokenSaverStats, shape: string): string {
  const bytesIn = text.length;
  stats.bytesBefore += bytesIn;

  if (bytesIn < MIN_COMPRESS_SIZE || bytesIn > RAW_CAP) {
    stats.bytesAfter += bytesIn;
    return text;
  }

  const filter = autoDetectFilter(text);
  if (!filter) {
    stats.bytesAfter += bytesIn;
    return text;
  }

  let out = text;
  try {
    out = filter(text);
  } catch {
    stats.bytesAfter += bytesIn;
    return text;
  }

  if (!out || out.length >= bytesIn) {
    stats.bytesAfter += bytesIn;
    return text;
  }

  stats.bytesAfter += out.length;
  stats.hits.push({ shape, filter: filter.filterName ?? filter.name, saved: bytesIn - out.length });
  return out;
}

function autoDetectFilter(text: string): TextFilter | null {
  const head = text.slice(0, 16_384);
  if (/^diff --git /m.test(head) || /^@@ /m.test(head)) return gitDiffCompact;
  if (/^On branch |^nothing to commit|^Changes (not |to be )|^Untracked files:/m.test(head) || isMostlyPorcelain(head)) return gitStatusCompact;

  const lines = head.split('\n');
  const nonEmpty = lines.filter(l => l.trim().length > 0);
  if (nonEmpty.slice(0, 5).some(isGrepLine)) return grepCompact;
  if (nonEmpty.length >= 3 && nonEmpty.every(isPathLike)) return pathListCompact;
  if (nonEmpty.length >= 5) return dedupAndTruncate;
  if (text.split('\n').length >= 120) return smartTruncate;
  return null;
}

function gitDiffCompact(input: string): string {
  const out: string[] = [];
  let keptInHunk = 0;
  for (const line of input.split('\n')) {
    if (
      line.startsWith('diff --git ') ||
      line.startsWith('index ') ||
      line.startsWith('--- ') ||
      line.startsWith('+++ ') ||
      line.startsWith('@@ ')
    ) {
      out.push(line);
      keptInHunk = 0;
      continue;
    }
    if ((line.startsWith('+') || line.startsWith('-')) && keptInHunk < MAX_LINES_PER_BUCKET) {
      out.push(line);
      keptInHunk++;
    }
  }
  if (out.length < 20) return smartTruncate(input);
  out.push('[full diff omitted by Token Saver]');
  return out.join('\n');
}
gitDiffCompact.filterName = 'git-diff';

function gitStatusCompact(input: string): string {
  const lines = input.split('\n');
  if (lines.length <= 120) return input;
  return [...lines.slice(0, 120), `... +${lines.length - 120} lines omitted by Token Saver`].join('\n');
}
gitStatusCompact.filterName = 'git-status';

function grepCompact(input: string): string {
  const groups = new Map<string, string[]>();
  for (const line of input.split('\n')) {
    const first = line.indexOf(':');
    const second = line.indexOf(':', first + 1);
    const file = first > -1 && second > -1 ? line.slice(0, first) : '(other)';
    const bucket = groups.get(file) ?? [];
    if (bucket.length < MAX_LINES_PER_BUCKET) bucket.push(line);
    groups.set(file, bucket);
  }
  const out: string[] = [];
  for (const [file, lines] of groups) {
    out.push(`## ${file}`, ...lines);
  }
  return out.join('\n');
}
grepCompact.filterName = 'grep';

function pathListCompact(input: string): string {
  const lines = input.split('\n').filter(Boolean);
  if (lines.length <= 180) return input;
  return [...lines.slice(0, 120), `... +${lines.length - 180} paths omitted by Token Saver`, ...lines.slice(-60)].join('\n');
}
pathListCompact.filterName = 'path-list';

function dedupAndTruncate(input: string): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of input.split('\n')) {
    const key = line.trim();
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    out.push(line);
  }
  return smartTruncate(out.join('\n'));
}
dedupAndTruncate.filterName = 'dedup-log';

function smartTruncate(input: string): string {
  const lines = input.split('\n');
  if (lines.length <= HEAD_LINES + TAIL_LINES + 20) return input;
  const cut = lines.length - HEAD_LINES - TAIL_LINES;
  return [...lines.slice(0, HEAD_LINES), `... +${cut} lines omitted by Token Saver`, ...lines.slice(-TAIL_LINES)].join('\n');
}
smartTruncate.filterName = 'smart-truncate';

function isGrepLine(line: string): boolean {
  const first = line.indexOf(':');
  const second = line.indexOf(':', first + 1);
  return first > -1 && second > -1 && /^\d+$/.test(line.slice(first + 1, second));
}

function isPathLike(line: string): boolean {
  const t = line.trim();
  return !!t && !t.includes(':') && (t.startsWith('.') || t.startsWith('/') || t.includes('/'));
}

function isMostlyPorcelain(head: string): boolean {
  const lines = head.split('\n').filter(l => l.trim());
  if (lines.length < 3) return false;
  const hits = lines.filter(l => /^[ MADRCU?!][ MADRCU?!] \S/.test(l)).length;
  return hits / lines.length >= 0.6;
}
