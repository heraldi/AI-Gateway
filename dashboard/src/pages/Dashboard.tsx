import { useEffect, useState } from 'react';
import { Activity, Zap, AlertCircle, Server, TrendingUp, Clock } from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar
} from 'recharts';
import { api, type Stats } from '../lib/api';

function StatCard({ label, value, sub, icon: Icon, color = 'text-accent' }: {
  label: string; value: string | number; sub?: string;
  icon: React.ElementType; color?: string;
}) {
  return (
    <div className="card flex items-start gap-4">
      <div className={`p-2 rounded-lg bg-base-700 ${color}`}>
        <Icon size={20} />
      </div>
      <div className="min-w-0">
        <p className="text-2xl font-bold text-gray-100">{value}</p>
        <p className="text-xs text-muted mt-0.5">{label}</p>
        {sub && <p className="text-xs text-success mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.stats().then(setStats).catch(e => setError(String(e)));
    const t = setInterval(() => api.stats().then(setStats).catch(() => {}), 10_000);
    return () => clearInterval(t);
  }, []);

  if (error) return (
    <div className="card text-danger flex items-center gap-2">
      <AlertCircle size={16} />
      <span className="text-sm">{error}</span>
    </div>
  );

  if (!stats) return (
    <div className="flex items-center gap-2 text-muted">
      <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      <span className="text-sm">Loading stats...</span>
    </div>
  );

  const chartData = stats.hourly.map(h => ({
    time: new Date(h.hour).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    requests: h.requests,
    tokens: h.tokens ?? 0,
  }));

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Requests" value={fmt(stats.total)} icon={Activity} />
        <StatCard label="Requests Today" value={fmt(stats.today)} sub="last 24h" icon={TrendingUp} color="text-success" />
        <StatCard label="Total Tokens" value={fmt(stats.tokensTotal)} icon={Zap} color="text-warning" />
        <StatCard label="Tokens Today" value={fmt(stats.tokensToday)} sub={`${stats.activeProviders} providers active`} icon={Server} color="text-accent" />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <h3 className="text-sm font-medium text-gray-300 mb-4 flex items-center gap-2">
            <Activity size={14} className="text-accent" /> Requests (7d)
          </h3>
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="reqGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#58a6ff" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#58a6ff" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#30363d" />
              <XAxis dataKey="time" tick={{ fill: '#8b949e', fontSize: 10 }} tickLine={false} />
              <YAxis tick={{ fill: '#8b949e', fontSize: 10 }} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: 6, fontSize: 12 }} />
              <Area type="monotone" dataKey="requests" stroke="#58a6ff" fill="url(#reqGrad)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <h3 className="text-sm font-medium text-gray-300 mb-4 flex items-center gap-2">
            <Zap size={14} className="text-warning" /> Token Usage (7d)
          </h3>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#30363d" />
              <XAxis dataKey="time" tick={{ fill: '#8b949e', fontSize: 10 }} tickLine={false} />
              <YAxis tick={{ fill: '#8b949e', fontSize: 10 }} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: 6, fontSize: 12 }} />
              <Bar dataKey="tokens" fill="#d29922" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Top models */}
      <div className="card">
        <h3 className="text-sm font-medium text-gray-300 mb-4 flex items-center gap-2">
          <Clock size={14} className="text-muted" /> Top Models
        </h3>
        {stats.perModel.length === 0
          ? <p className="text-muted text-sm">No requests yet.</p>
          : (
            <div className="space-y-2">
              {stats.perModel.map(m => {
                const pct = stats.total ? (m.requests / stats.total) * 100 : 0;
                return (
                  <div key={m.model} className="flex items-center gap-3">
                    <span className="text-xs text-gray-300 w-48 truncate font-mono">{m.model}</span>
                    <div className="flex-1 bg-base-700 rounded-full h-1.5">
                      <div className="bg-accent h-1.5 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-xs text-muted w-16 text-right">{m.requests} req</span>
                    <span className="text-xs text-warning w-20 text-right">{fmt(m.tokens ?? 0)} tok</span>
                  </div>
                );
              })}
            </div>
          )
        }
      </div>

      {/* Quick start info */}
      {stats.total === 0 && (
        <div className="card border-accent/30 bg-accent/5 space-y-2">
          <h3 className="text-sm font-medium text-accent">Quick Start</h3>
          <p className="text-xs text-muted">1. Add a provider in the <strong className="text-gray-300">Providers</strong> page</p>
          <p className="text-xs text-muted">2. Create an API key in <strong className="text-gray-300">API Keys</strong> (optional)</p>
          <p className="text-xs text-muted">3. Point your client to:</p>
          <div className="bg-base-900 rounded p-3 space-y-1">
            <p className="text-xs font-mono text-success">OpenAI SDK:     baseURL = "http://localhost:3000/v1"</p>
            <p className="text-xs font-mono text-accent">Anthropic SDK:  baseURL = "http://localhost:3000/anthropic"</p>
          </div>
        </div>
      )}
    </div>
  );
}
