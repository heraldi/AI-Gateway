import { useEffect, useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { api, type Settings } from '../lib/api';

function CodeBlock({ code, label }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="relative">
      {label && <p className="text-xs text-muted mb-1">{label}</p>}
      <pre className="bg-base-900 rounded p-3 text-xs font-mono text-gray-300 overflow-auto pr-10 whitespace-pre-wrap">{code}</pre>
      <button className="absolute top-2 right-2 btn-ghost p-1" onClick={copy}>
        {copied ? <Check size={12} className="text-success" /> : <Copy size={12} />}
      </button>
    </div>
  );
}

export default function SettingsPage() {
  const host = window.location.host.replace(/:\d+$/, ':3000');
  const [settings, setSettings] = useState<Settings>({ token_saver_enabled: false });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.settings.get().then(setSettings).catch(console.error);
  }, []);

  async function updateTokenSaver(enabled: boolean) {
    setSaving(true);
    try {
      await api.settings.update({ token_saver_enabled: enabled });
      setSettings(s => ({ ...s, token_saver_enabled: enabled }));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,3fr)_minmax(16rem,1fr)] gap-6 max-w-7xl">
      <div className="space-y-6">
      <div className="card space-y-4">
        <h3 className="text-sm font-medium">Connection Info</h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          <div className="bg-base-700 rounded p-3 space-y-1">
            <p className="text-muted">OpenAI Base URL</p>
            <code className="text-accent font-mono">http://{host}/v1</code>
          </div>
          <div className="bg-base-700 rounded p-3 space-y-1">
            <p className="text-muted">Anthropic Base URL</p>
            <code className="text-accent font-mono">http://{host}/anthropic</code>
          </div>
        </div>
      </div>

      <div className="card space-y-3">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-medium">Token Saver</h3>
            <p className="text-xs text-muted mt-1">
              Compress large tool outputs such as git diff, grep, find, ls, tree, and logs before forwarding them to the model.
            </p>
          </div>
          <button
            className={settings.token_saver_enabled ? 'btn-primary text-xs' : 'btn-ghost text-xs'}
            disabled={saving}
            onClick={() => updateTokenSaver(!settings.token_saver_enabled)}
          >
            {settings.token_saver_enabled ? 'Enabled' : 'Disabled'}
          </button>
        </div>
        <p className="text-xs text-muted">
          This follows the RTK-style flow from 9router: it only rewrites tool result content and skips error tool results.
        </p>
      </div>

      <div className="card space-y-3">
        <h3 className="text-sm font-medium">Chrome Extension Setup</h3>
        <p className="text-xs text-muted">
          Use the Chrome Extension once to bootstrap web-provider cookies into the gateway.
          After Bud Clerk cookies are stored, Bud token refresh runs server-side.
        </p>
        <ol className="text-xs text-muted space-y-1 list-decimal list-inside">
          <li>Open <code className="text-gray-300">chrome://extensions</code></li>
          <li>Enable <strong className="text-gray-300">Developer mode</strong></li>
          <li>Click <strong className="text-gray-300">Load unpacked</strong></li>
          <li>Select the <code className="text-gray-300">extension/</code> folder from this project</li>
          <li>Open the extension popup and set your Gateway URL + Extension Token</li>
          <li>Visit the provider page, then use Extract &amp; Push for that provider</li>
        </ol>
        <CodeBlock label="extension/.env - extension token" code={`GATEWAY_URL=http://localhost:3000
EXTENSION_TOKEN=ext-token-change-me`} />
      </div>

      <div className="card space-y-3">
        <h3 className="text-sm font-medium">Change Dashboard Password</h3>
        <p className="text-xs text-muted">
          Set <code className="text-gray-300">ADMIN_PASSWORD</code> in your server <code className="text-gray-300">.env</code> file and restart the server.
        </p>
        <button
          className="btn-danger text-xs"
          onClick={() => { localStorage.removeItem('adminPassword'); window.location.reload(); }}
        >
          Logout
        </button>
      </div>
      </div>

      <aside className="space-y-3">
        <div className="card space-y-3">
          <h3 className="text-sm font-medium">Runtime Notes</h3>
          <div className="space-y-2 text-xs text-muted">
            <p>OpenAI SDK clients should use the `/v1` base URL.</p>
            <p>Anthropic SDK clients should use the `/anthropic` base URL.</p>
            <p>OAuth providers are stored server-side and can be rotated from Providers.</p>
          </div>
        </div>
        <div className="card space-y-2">
          <h3 className="text-sm font-medium">Security</h3>
          <p className="text-xs text-muted">Create at least one API key before exposing the gateway outside localhost.</p>
        </div>
      </aside>
    </div>
  );
}
