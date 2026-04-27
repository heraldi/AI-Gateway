import { useEffect, useState, useCallback } from 'react';
import { RefreshCw, Trash2, ChevronLeft, ChevronRight, AlertCircle } from 'lucide-react';
import { api, type RequestLog, type LogsResponse } from '../lib/api';

function statusBadge(s: number | null) {
  if (!s) return <span className="badge-gray">—</span>;
  if (s < 300) return <span className="badge-green">{s}</span>;
  if (s < 400) return <span className="badge-yellow">{s}</span>;
  return <span className="badge-red">{s}</span>;
}

function latencyColor(ms: number | null) {
  if (!ms) return 'text-muted';
  if (ms < 1000) return 'text-success';
  if (ms < 5000) return 'text-warning';
  return 'text-danger';
}

function relTime(ts: number) {
  const diff = Date.now() - ts;
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ts).toLocaleDateString();
}

export default function LogsPage() {
  const [data, setData] = useState<LogsResponse | null>(null);
  const [page, setPage] = useState(1);
  const [filterModel, setFilterModel] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);

  const load = useCallback(() => {
    api.logs.list({ page, limit: 50, model: filterModel || undefined, status: filterStatus || undefined })
      .then(setData).catch(console.error);
  }, [page, filterModel, filterStatus]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [autoRefresh, load]);

  async function clearLogs() {
    if (!confirm('Clear all logs?')) return;
    await api.logs.clear();
    load();
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <input className="input w-44" placeholder="Filter by model..." value={filterModel} onChange={e => { setFilterModel(e.target.value); setPage(1); }} />
        <select className="input w-36" value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setPage(1); }}>
          <option value="">All status</option>
          <option value="ok">Success (2xx)</option>
          <option value="error">Error (4xx/5xx)</option>
        </select>
        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-muted cursor-pointer">
            <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} />
            Auto-refresh
          </label>
          <button className="btn-ghost flex items-center gap-1.5" onClick={load}>
            <RefreshCw size={14} /> Refresh
          </button>
          <button className="btn-danger flex items-center gap-1.5" onClick={clearLogs}>
            <Trash2 size={14} /> Clear
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-base-600 text-muted">
                <th className="text-left px-4 py-2.5 font-medium">Time</th>
                <th className="text-left px-4 py-2.5 font-medium">Model</th>
                <th className="text-left px-4 py-2.5 font-medium">Status</th>
                <th className="text-left px-4 py-2.5 font-medium">Latency</th>
                <th className="text-left px-4 py-2.5 font-medium">Tokens</th>
                <th className="text-left px-4 py-2.5 font-medium">Stream</th>
              </tr>
            </thead>
            <tbody>
              {!data && (
                <tr><td colSpan={6} className="text-center px-4 py-8 text-muted">Loading...</td></tr>
              )}
              {data?.logs.length === 0 && (
                <tr><td colSpan={6} className="text-center px-4 py-8 text-muted">No logs found.</td></tr>
              )}
              {data?.logs.map(log => (
                <>
                  <tr
                    key={log.id}
                    className="border-b border-base-700 hover:bg-base-700 cursor-pointer transition-colors"
                    onClick={() => setExpanded(expanded === log.id ? null : log.id)}
                  >
                    <td className="px-4 py-2.5 text-muted whitespace-nowrap">{relTime(log.created_at)}</td>
                    <td className="px-4 py-2.5 font-mono text-gray-300 max-w-[180px] truncate">{log.model ?? '—'}</td>
                    <td className="px-4 py-2.5">{statusBadge(log.status)}</td>
                    <td className={`px-4 py-2.5 font-mono ${latencyColor(log.latency)}`}>
                      {log.latency ? `${log.latency}ms` : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-muted">
                      {log.total_tokens ? (
                        <span className="text-warning">{log.total_tokens.toLocaleString()}</span>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      {log.stream ? <span className="badge-blue">SSE</span> : <span className="badge-gray">sync</span>}
                    </td>
                  </tr>
                  {expanded === log.id && (
                    <tr key={`${log.id}-detail`} className="bg-base-900">
                      <td colSpan={6} className="px-4 py-3">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div>
                            <p className="text-muted text-xs mb-1">Request</p>
                            <pre className="bg-base-800 rounded p-2 text-xs overflow-auto max-h-48 whitespace-pre-wrap text-gray-300">
                              {log.request_preview ?? '(empty)'}
                            </pre>
                          </div>
                          <div>
                            <p className="text-muted text-xs mb-1">Response</p>
                            <pre className="bg-base-800 rounded p-2 text-xs overflow-auto max-h-48 whitespace-pre-wrap text-gray-300">
                              {log.error
                                ? <span className="text-danger flex items-start gap-1"><AlertCircle size={12} className="mt-0.5 flex-shrink-0" />{log.error}</span>
                                : (log.response_preview ?? '(empty)')}
                            </pre>
                          </div>
                          <div className="md:col-span-2 text-muted text-xs font-mono">
                            ID: {log.id} | Provider: {log.provider_id ?? '—'} |
                            Tokens: {log.input_tokens ?? 0}↑ {log.output_tokens ?? 0}↓
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {data && data.pages > 1 && (
        <div className="flex items-center justify-between text-xs text-muted">
          <span>{data.total} total logs</span>
          <div className="flex items-center gap-2">
            <button className="btn-ghost p-1" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
              <ChevronLeft size={14} />
            </button>
            <span>Page {page} / {data.pages}</span>
            <button className="btn-ghost p-1" disabled={page >= data.pages} onClick={() => setPage(p => p + 1)}>
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
