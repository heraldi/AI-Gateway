import type { ModelInfo, ProviderAdapter } from '../types.js';

function adapter(type: 'kiro' | 'cursor', models: ModelInfo[]): ProviderAdapter {
  return {
    type,
    async listModels() {
      return models;
    },
    async complete() {
      throw new Error(`${type} login/import is configured, but its binary/protobuf executor is not ported into this gateway yet.`);
    },
    async stream() {
      throw new Error(`${type} login/import is configured, but its binary/protobuf executor is not ported into this gateway yet.`);
    },
  };
}

export const KiroAdapter = adapter('kiro', [
  { id: 'kiro', name: 'Kiro', owned_by: 'aws' },
]);

export const CursorAdapter = adapter('cursor', [
  { id: 'cursor-auto', name: 'Cursor Auto', owned_by: 'cursor' },
  { id: 'claude-4-sonnet-thinking', name: 'Claude 4 Sonnet Thinking', owned_by: 'cursor' },
  { id: 'gpt-5', name: 'GPT-5', owned_by: 'cursor' },
]);
