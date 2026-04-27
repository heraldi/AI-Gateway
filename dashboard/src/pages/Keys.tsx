import { useEffect, useState } from 'react';
import { Plus, Trash2, Copy, ToggleLeft, ToggleRight, Eye, EyeOff } from 'lucide-react';
import { api, type GatewayKey } from '../lib/api';

function fmt(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export default function KeysPage() {
  const [keys, setKeys] = useState<GatewayKey[]>([]);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [showNewKey, setShowNewKey] = useState(false);

  const load = () => api.keys.list().then(setKeys).catch(console.error);
  useEffect(() => { load(); }, []);

  async function create() {
    const result = await api.keys.create(newName || undefined);
    setNewKey(result.key);
    setNewName('');
    setShowNewKey(true);
    load();
  }

  async function remove(id: string) {
    if (!confirm('Delete this API key?')) return;
    await api.keys.delete(id);
    load();
  }

  async function toggle(k: GatewayKey) {
    await api.keys.toggle(k.id, !k.enabled);
    load();
  }

  function copy(text: string) {
    navigator.clipboard.writeText(text);
  }

  const activeKeys = keys.filter(k => k.enabled).length;
  const totalRequests = keys.reduce((sum, k) => sum + k.requests_count, 0);
  const totalTokens = keys.reduce((sum, k) => sum + k.tokens_count, 0);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,3fr)_minmax(16rem,1fr)] gap-6 max-w-7xl">
      <div className="space-y-6">
      <div className="card space-y-3">
        <h3 className="text-sm font-medium">Create New Gateway Key</h3>
        <p className="text-xs text-muted">
          Gateway keys protect your proxy endpoints. If no keys are created, the gateway runs in open mode (no auth required).
        </p>
        <div className="flex gap-2">
          <input className="input flex-1" placeholder="Key name (optional)" value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === 'Enter' && create()} />
          <button className="btn-primary flex items-center gap-1.5" onClick={create}>
            <Plus size={14} /> Generate Key
          </button>
        </div>
      </div>

      {/* New key reveal */}
      {newKey && (
        <div className="card border-success/30 bg-success/5 space-y-2">
          <p className="text-sm text-success font-medium">Key created — copy it now, it won't be shown again!</p>
          <div className="flex items-center gap-2">
            <code className={`flex-1 text-xs font-mono bg-base-900 rounded px-3 py-2 ${showNewKey ? 'text-gray-100' : 'blur-sm select-none'}`}>
              {newKey}
            </code>
            <button className="btn-ghost p-1.5" onClick={() => setShowNewKey(!showNewKey)}>
              {showNewKey ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
            <button className="btn-primary p-1.5" onClick={() => copy(newKey)} title="Copy">
              <Copy size={16} />
            </button>
          </div>
          <button className="text-xs text-muted hover:text-gray-300" onClick={() => setNewKey(null)}>Dismiss</button>
        </div>
      )}

      {/* Keys list */}
      <div className="space-y-2">
        {keys.length === 0 && (
          <div className="card text-center text-muted text-sm py-8">
            No keys yet. Gateway is in <strong className="text-warning">open mode</strong> — anyone can use it.
          </div>
        )}
        {keys.map(k => (
          <div key={k.id} className={`card flex items-center gap-3 ${!k.enabled ? 'opacity-50' : ''}`}>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-gray-100">{k.name ?? 'Unnamed Key'}</span>
                {k.enabled ? <span className="badge-green">Active</span> : <span className="badge-gray">Disabled</span>}
              </div>
              <div className="flex items-center gap-3 mt-1 text-xs text-muted flex-wrap">
                <code className="font-mono text-gray-400">{k.key_preview}</code>
                <span>{k.requests_count.toLocaleString()} requests</span>
                <span>{fmt(k.tokens_count)} tokens</span>
                {k.last_used_at && <span>Last used: {new Date(k.last_used_at).toLocaleDateString()}</span>}
              </div>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <button className="btn-ghost p-1.5" onClick={() => copy(k.key_preview)} title="Copy preview">
                <Copy size={14} />
              </button>
              <button className="btn-ghost p-1.5" onClick={() => toggle(k)}>
                {k.enabled ? <ToggleRight size={18} className="text-success" /> : <ToggleLeft size={18} />}
              </button>
              <button className="btn-danger p-1.5" onClick={() => remove(k.id)}>
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Usage info */}
      <div className="card bg-base-700 space-y-2">
        <h4 className="text-xs font-medium text-gray-300">Using Your Key</h4>
        <div className="space-y-1 text-xs font-mono">
          <p className="text-muted"># OpenAI SDK</p>
          <p className="text-gray-300">openai.api_key = <span className="text-accent">"sk-gw-xxxx"</span></p>
          <p className="text-muted mt-2"># Anthropic SDK</p>
          <p className="text-gray-300">anthropic.api_key = <span className="text-accent">"sk-gw-xxxx"</span></p>
          <p className="text-muted mt-2"># HTTP header</p>
          <p className="text-gray-300">Authorization: Bearer <span className="text-accent">sk-gw-xxxx</span></p>
          <p className="text-gray-300">   — or —</p>
          <p className="text-gray-300">x-api-key: <span className="text-accent">sk-gw-xxxx</span></p>
        </div>
      </div>
      </div>

      <aside className="space-y-3">
        <div className="card space-y-3">
          <h3 className="text-sm font-medium">Key Summary</h3>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="bg-base-700 rounded p-3">
              <p className="text-muted">Active</p>
              <p className="text-lg text-success mt-1">{activeKeys}</p>
            </div>
            <div className="bg-base-700 rounded p-3">
              <p className="text-muted">Total</p>
              <p className="text-lg text-gray-100 mt-1">{keys.length}</p>
            </div>
            <div className="bg-base-700 rounded p-3 col-span-2">
              <p className="text-muted">Usage</p>
              <p className="text-sm text-gray-100 mt-1">{totalRequests.toLocaleString()} requests</p>
              <p className="text-sm text-gray-100">{fmt(totalTokens)} tokens</p>
            </div>
          </div>
        </div>
        <div className="card space-y-2">
          <h3 className="text-sm font-medium">Headers</h3>
          <p className="text-xs text-muted">Use `Authorization: Bearer sk-gw-...` for OpenAI SDKs.</p>
          <p className="text-xs text-muted">Use `x-api-key` when a client does not support bearer keys.</p>
        </div>
      </aside>
    </div>
  );
}
