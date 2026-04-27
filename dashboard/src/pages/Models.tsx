import { useEffect, useState } from 'react';
import { RefreshCw, Plus, Trash2, AlertCircle, Play, CheckCircle2, XCircle, Edit2, Check, X } from 'lucide-react';
import { api, type ModelInfo, type ModelRoute, type ModelTestResult, type Provider, type ModelAlias } from '../lib/api';

type FetchError = { provider_id: string; provider_name: string; error: string };

export default function ModelsPage() {
  const [models, setModels]       = useState<ModelInfo[]>([]);
  const [fetchErrors, setFetchErrors] = useState<FetchError[]>([]);
  const [routes, setRoutes]       = useState<ModelRoute[]>([]);
  const [aliases, setAliases]     = useState<ModelAlias[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading]     = useState(false);
  const [newPattern, setNewPattern]   = useState('');
  const [newProvider, setNewProvider] = useState('');
  const [newOverride, setNewOverride] = useState('');
  const [testPrompt, setTestPrompt] = useState('Reply with a short OK if this model is working.');
  const [testingModel, setTestingModel] = useState('');
  const [testResult, setTestResult] = useState<ModelTestResult | null>(null);
  const [aliasEditingKey, setAliasEditingKey] = useState('');
  const [aliasValue, setAliasValue] = useState('');
  const [aliasFork, setAliasFork] = useState(false);

  const loadModels = async () => {
    setLoading(true);
    setFetchErrors([]);
    try {
      const result = await api.models.list();
      setModels(result.models ?? []);
      setFetchErrors(result.errors ?? []);
    } catch (e) {
      setFetchErrors([{ provider_id: '', provider_name: 'Gateway', error: String(e) }]);
      setModels([]);
    }
    setLoading(false);
  };

  const loadRoutes    = () => api.routes.list().then(setRoutes).catch(console.error);
  const loadAliases   = () => api.aliases.list().then(setAliases).catch(console.error);
  const loadProviders = () => api.providers.list().then(setProviders).catch(console.error);

  useEffect(() => { loadModels(); loadRoutes(); loadAliases(); loadProviders(); }, []);

  async function addRoute() {
    if (!newPattern || !newProvider) return;
    await api.routes.create({ pattern: newPattern, provider_id: newProvider, model_override: newOverride || undefined });
    setNewPattern(''); setNewProvider(''); setNewOverride('');
    loadRoutes();
  }

  async function deleteRoute(id: string) {
    await api.routes.delete(id);
    loadRoutes();
  }

  function aliasKey(m: ModelInfo) {
    return `${m.provider_id}:${m.source_id ?? m.alias_of ?? m.id}`;
  }

  function upstreamModel(m: ModelInfo) {
    return m.source_id ?? m.alias_of ?? m.id;
  }

  function findAlias(m: ModelInfo) {
    const upstream = upstreamModel(m);
    return aliases.find(a => a.provider_id === m.provider_id && a.upstream_model === upstream && a.alias === m.id)
      ?? aliases.find(a => a.provider_id === m.provider_id && a.upstream_model === upstream);
  }

  function startAliasEdit(m: ModelInfo) {
    const existing = findAlias(m);
    setAliasEditingKey(aliasKey(m));
    setAliasValue(existing?.alias ?? '');
    setAliasFork(!!existing?.fork);
  }

  async function saveAlias(m: ModelInfo) {
    const upstream = upstreamModel(m);
    const clean = aliasValue.trim();
    if (!clean) return;
    const existing = findAlias(m);
    if (existing) {
      await api.aliases.update(existing.id, { alias: clean, provider_id: m.provider_id, upstream_model: upstream, fork: aliasFork });
    } else {
      await api.aliases.create({ alias: clean, provider_id: m.provider_id, upstream_model: upstream, fork: aliasFork });
    }
    setAliasEditingKey('');
    setAliasValue('');
    await loadAliases();
    await loadModels();
  }

  async function deleteAlias(m: ModelInfo) {
    const existing = findAlias(m);
    if (!existing) return;
    await api.aliases.delete(existing.id);
    setAliasEditingKey('');
    await loadAliases();
    await loadModels();
  }

  async function testModel(model: string) {
    setTestingModel(model);
    setTestResult(null);
    try {
      const result = await api.models.test({ model, prompt: testPrompt });
      setTestResult(result);
    } catch (e) {
      setTestResult({
        ok: false,
        model,
        resolvedModel: model,
        provider: { id: '', name: 'Gateway', type: 'gateway' },
        latency: 0,
        error: String(e),
      });
    } finally {
      setTestingModel('');
    }
  }

  // Group models by provider
  const grouped = models.reduce<Record<string, ModelInfo[]>>((acc, m) => {
    const k = m.provider_name;
    (acc[k] ??= []).push(m);
    return acc;
  }, {});

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,4fr)_minmax(16rem,1fr)] gap-6 max-w-7xl">
      <div className="space-y-6">

      {/* Model routes */}
      <div className="card space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">Model Routes</h3>
          <p className="text-xs text-muted">Route model requests to specific providers</p>
        </div>

        <div className="grid grid-cols-12 gap-2">
          <input
            className="input col-span-4"
            placeholder="Pattern (e.g. claude-* or exact)"
            value={newPattern}
            onChange={e => setNewPattern(e.target.value)}
          />
          <select className="input col-span-4" value={newProvider} onChange={e => setNewProvider(e.target.value)}>
            <option value="">Select provider...</option>
            {providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <input
            className="input col-span-2"
            placeholder="Model override"
            value={newOverride}
            onChange={e => setNewOverride(e.target.value)}
          />
          <button
            className="col-span-2 btn-primary flex items-center justify-center gap-1"
            disabled={!newPattern || !newProvider}
            onClick={addRoute}
          >
            <Plus size={14} /> Add
          </button>
        </div>

        {routes.length === 0
          ? <p className="text-xs text-muted">No routes configured. Requests are auto-routed by model name prefix.</p>
          : (
            <div className="space-y-1">
              {routes.map(r => (
                <div key={r.id} className="flex items-center gap-3 bg-base-700 rounded px-3 py-2">
                  <span className="font-mono text-xs text-accent flex-1">{r.pattern}</span>
                  <span className="text-xs text-muted">→</span>
                  <span className="text-xs text-gray-300 flex-1">{r.provider_name}</span>
                  {r.model_override && (
                    <span className="text-xs text-warning font-mono">override: {r.model_override}</span>
                  )}
                  <button className="btn-danger p-1" onClick={() => deleteRoute(r.id)}>
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          )
        }
      </div>

      <div className="card space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-medium">Model Test</h3>
          {testingModel && <span className="text-xs text-muted font-mono truncate">Testing {testingModel}</span>}
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            className="input flex-1"
            value={testPrompt}
            onChange={e => setTestPrompt(e.target.value)}
            placeholder="Test prompt"
          />
        </div>
        {testResult && (
          <div className={`border rounded px-3 py-2 ${testResult.ok ? 'bg-success/10 border-success/20' : 'bg-danger/10 border-danger/20'}`}>
            <div className="flex items-start gap-2">
              {testResult.ok
                ? <CheckCircle2 size={14} className="text-success mt-0.5 flex-shrink-0" />
                : <XCircle size={14} className="text-danger mt-0.5 flex-shrink-0" />}
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  <span className={testResult.ok ? 'text-success font-medium' : 'text-danger font-medium'}>
                    {testResult.ok ? 'OK' : 'Failed'}
                  </span>
                  <span className="text-muted">provider: {testResult.provider.name} ({testResult.provider.type})</span>
                  <span className="text-muted">latency: {testResult.latency}ms</span>
                  {testResult.resolvedModel !== testResult.model && (
                    <span className="text-muted">resolved: {testResult.resolvedModel}</span>
                  )}
                </div>
                <p className="text-xs text-gray-300 whitespace-pre-wrap break-words">
                  {testResult.ok ? testResult.content : testResult.error}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Available models */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">Available Models</h3>
          <button className="btn-ghost flex items-center gap-1.5" onClick={loadModels} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            {loading ? 'Fetching...' : 'Refresh'}
          </button>
        </div>

        {/* Per-provider errors */}
        {fetchErrors.length > 0 && (
          <div className="space-y-2">
            {fetchErrors.map((e, i) => (
              <div key={i} className="flex items-start gap-2 bg-danger/10 border border-danger/20 rounded px-3 py-2">
                <AlertCircle size={14} className="text-danger mt-0.5 flex-shrink-0" />
                <div className="min-w-0">
                  <span className="text-xs font-medium text-danger">{e.provider_name}</span>
                  <p className="text-xs text-muted mt-0.5 break-all">{e.error}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Models grouped by provider */}
        {Object.entries(grouped).map(([providerName, pModels]) => (
          <div key={providerName} className="card space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-medium text-accent">{providerName}</h4>
              <span className="text-xs text-muted">{pModels.length} model{pModels.length !== 1 ? 's' : ''}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {pModels.map(m => {
                const key = aliasKey(m);
                const editing = aliasEditingKey === key;
                const existingAlias = findAlias(m);
                const upstream = upstreamModel(m);
                return (
                  <div key={`${m.provider_id}:${m.id}`} className="bg-base-700 rounded px-3 py-1.5 min-w-0 space-y-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="flex-1 min-w-0">
                        <span className="text-xs font-mono text-gray-300 block truncate">{m.id}</span>
                        {m.alias_of && (
                          <span className="text-[11px] text-muted font-mono block truncate">upstream: {m.alias_of}</span>
                        )}
                      </div>
                      {m.owned_by && <span className="text-xs text-muted flex-shrink-0">{m.owned_by}</span>}
                      <button
                        className="btn-ghost p-1 flex-shrink-0"
                        title="Rename model"
                        onClick={() => startAliasEdit(m)}
                      >
                        <Edit2 size={12} />
                      </button>
                      <button
                        className="btn-ghost p-1 flex-shrink-0"
                        title="Test model"
                        disabled={!!testingModel}
                        onClick={() => testModel(m.id)}
                      >
                        <Play size={12} className={testingModel === m.id ? 'animate-pulse' : ''} />
                      </button>
                    </div>
                    {editing && (
                      <div className="flex items-center gap-1.5 pt-1">
                        <input
                          className="input h-8 text-xs font-mono flex-1"
                          placeholder="Client alias"
                          value={aliasValue}
                          onChange={e => setAliasValue(e.target.value)}
                        />
                        <label className="flex items-center gap-1 text-[11px] text-muted whitespace-nowrap">
                          <input
                            type="checkbox"
                            checked={aliasFork}
                            onChange={e => setAliasFork(e.target.checked)}
                          />
                          keep
                        </label>
                        <button className="btn-primary p-1.5" title="Save alias" onClick={() => saveAlias(m)}>
                          <Check size={12} />
                        </button>
                        {existingAlias && (
                          <button className="btn-danger p-1.5" title="Delete alias" onClick={() => deleteAlias(m)}>
                            <Trash2 size={12} />
                          </button>
                        )}
                        <button className="btn-ghost p-1.5" title="Cancel" onClick={() => setAliasEditingKey('')}>
                          <X size={12} />
                        </button>
                      </div>
                    )}
                    {editing && (
                      <p className="text-[11px] text-muted font-mono truncate">maps to {upstream}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {!loading && models.length === 0 && fetchErrors.length === 0 && (
          <div className="card text-center text-muted text-sm py-8">
            No models found. Make sure at least one provider is configured and enabled.
          </div>
        )}

        {!loading && models.length === 0 && fetchErrors.length > 0 && (
          <div className="card text-center text-muted text-sm py-8">
            All providers returned errors. Check the error messages above.
          </div>
        )}
      </div>
      </div>

      <aside className="space-y-3">
        <div className="card space-y-3">
          <h3 className="text-sm font-medium">Model Summary</h3>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="bg-base-700 rounded p-3">
              <p className="text-muted">Providers</p>
              <p className="text-lg text-accent mt-1">{Object.keys(grouped).length}</p>
            </div>
            <div className="bg-base-700 rounded p-3">
              <p className="text-muted">Models</p>
              <p className="text-lg text-gray-100 mt-1">{models.length}</p>
            </div>
            <div className="bg-base-700 rounded p-3 col-span-2">
              <p className="text-muted">Aliases</p>
              <p className="text-lg text-success mt-1">{aliases.length}</p>
            </div>
          </div>
        </div>
        <div className="card space-y-2">
          <h3 className="text-sm font-medium">Alias Rules</h3>
          <p className="text-xs text-muted">Rename creates a client-visible alias that routes to the selected upstream model.</p>
          <p className="text-xs text-muted">Enable `keep` to show both original and alias in model lists.</p>
        </div>
      </aside>
    </div>
  );
}
