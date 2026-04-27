import type { ModelCapability } from './types.js';

export function classifyModelCapability(modelId: string, ownedBy?: string): ModelCapability {
  const id = modelId.toLowerCase();
  const owner = ownedBy?.toLowerCase() ?? '';

  if (/\b(rerank|reranker)\b/.test(id) || id.includes('rerank')) return 'rerank';
  if (id.includes('moderation') || id.includes('omni-moderation')) return 'moderation';
  if (id.includes('embedding') || id.includes('embed') || /\b(bge|e5|gte|jina-embeddings)\b/.test(id)) return 'embedding';
  if (id.includes('whisper') || id.includes('transcrib')) return 'transcription';
  if (id.includes('tts') || id.includes('speech')) return 'tts';
  if (id.includes('video') || id.includes('veo') || id.includes('sora')) return 'video';
  if (
    id.includes('image') ||
    id.includes('imagine') ||
    id.includes('flux') ||
    id.includes('stable-diffusion') ||
    id.includes('sdxl') ||
    id.includes('dall-e') ||
    id.includes('imagen') ||
    owner.includes('black-forest') ||
    owner.includes('stability')
  ) return 'image';

  return 'chat';
}

