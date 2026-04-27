(() => {
  let currentTab = null;
  let providers = [];

  const $ = id => document.getElementById(id);

  // ── Tab switching ────────────────────────────────────────────────────────────
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      $(`tab-${btn.dataset.tab}`).classList.add('active');
    });
  });

  // ── Status dot ───────────────────────────────────────────────────────────────
  async function checkGateway() {
    const { gatewayUrl } = await chrome.storage.local.get('gatewayUrl');
    chrome.runtime.sendMessage({ type: 'CHECK_GATEWAY', gatewayUrl: gatewayUrl || 'http://localhost:3000' }, res => {
      $('statusDot').className = 'dot ' + (res?.ok ? 'ok' : 'err');
    });
  }

  // ── Settings tab ─────────────────────────────────────────────────────────────
  async function loadSettings() {
    const { gatewayUrl, extensionToken, adminPassword } =
      await chrome.storage.local.get(['gatewayUrl', 'extensionToken', 'adminPassword']);
    $('gatewayUrl').value     = gatewayUrl     || '';
    $('extensionToken').value = extensionToken || '';
    $('adminPassword').value  = adminPassword  || '';
  }

  $('btnSave').addEventListener('click', () => {
    const settings = {
      gatewayUrl:     $('gatewayUrl').value.trim(),
      extensionToken: $('extensionToken').value.trim(),
      adminPassword:  $('adminPassword').value.trim(),
    };
    chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings }, () => {
      showMsg('settingsMsg', 'Settings saved.', 'ok');
      checkGateway();
      fetchProviders();
    });
  });

  // ── Auto-extract toggle ──────────────────────────────────────────────────────
  async function loadAutoExtract() {
    const { autoExtract } = await chrome.storage.local.get('autoExtract');
    $('autoExtract').checked = !!autoExtract;
  }

  $('autoExtract').addEventListener('change', e => {
    chrome.storage.local.set({ autoExtract: e.target.checked });
  });

  // ── Type badge helper ────────────────────────────────────────────────────────
  function typeBadge(type) {
    const map = {
      'anthropic':         ['Anthropic',    'badge-blue'],
      'openai':            ['OpenAI',        'badge-green'],
      'openai-compatible': ['OAI Compat',    'badge-gray'],
      'claude-web':        ['Claude Web',    'badge-blue'],
      'chatgpt-web':       ['ChatGPT Web',   'badge-green'],
      'bud-web':           ['Bud Web',       'badge-green'],
      'devin-web':         ['Devin Web',     'badge-green'],
      'ollama':            ['Ollama',         'badge-yellow'],
    };
    const [label, cls] = map[type] ?? [type, 'badge-gray'];
    return `<span class="badge ${cls}">${label}</span>`;
  }

  // ── Render provider list ─────────────────────────────────────────────────────
  function renderProviders() {
    const list = $('providersList');

    if (!providers.length) {
      list.innerHTML = '<div class="empty">No providers configured in gateway.</div>';
      return;
    }

    const tabHostname = (() => {
      if (!currentTab?.url) return '';
      try { return new URL(currentTab.url).hostname; } catch { return ''; }
    })();

    list.innerHTML = providers.map(p => {
      const provHostname = (() => {
        if (!p.base_url) return '';
        try { return new URL(p.base_url).hostname; } catch { return ''; }
      })();

      const sameDomain = !!(tabHostname && provHostname && tabHostname === provHostname);
      const btnCls = sameDomain ? 'btn btn-push same-domain' : 'btn btn-push';
      const btnLabel = sameDomain ? 'Extract from current tab' : 'Extract &amp; Push';

      return `<div class="provider-card">
        <div class="provider-head">
          <span class="provider-name">${esc(p.name)}</span>
          ${typeBadge(p.type)}
          ${sameDomain ? '<span class="badge badge-green">Active tab</span>' : ''}
        </div>
        ${p.base_url ? `<div class="provider-url">${esc(p.base_url)}</div>` : ''}
        <button class="${btnCls}" data-id="${p.id}">${btnLabel}</button>
      </div>`;
    }).join('');

    list.querySelectorAll('button[data-id]').forEach(btn => {
      btn.addEventListener('click', () => handlePush(btn.dataset.id, btn));
    });
  }

  // ── Push cookies for a provider ──────────────────────────────────────────────
  function handlePush(providerId, btn) {
    if (!currentTab?.url) {
      showMsg('extractMsg', 'No active tab found.', 'err');
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Pushing…';

    chrome.runtime.sendMessage(
      { type: 'EXTRACT_AND_PUSH', providerId, tabUrl: currentTab.url, tabId: currentTab.id },
      res => {
        btn.disabled = false;
        const ok = res?.success;
        btn.textContent = ok ? 'Pushed!' : 'Extract & Push';
        showMsg('extractMsg', res?.message || 'Unknown error', ok ? 'ok' : 'err');
        if (ok) {
          setTimeout(() => {
            btn.textContent = 'Extract & Push';
            hideMsg('extractMsg');
          }, 3000);
        }
      }
    );
  }

  // ── Fetch providers from gateway via background ──────────────────────────────
  function fetchProviders() {
    $('providersList').innerHTML = '<div class="empty">Loading providers…</div>';
    chrome.runtime.sendMessage({ type: 'FETCH_PROVIDERS' }, res => {
      if (res?.success) {
        providers = (res.providers || []).filter(p => p.enabled);
        renderProviders();
      } else {
        $('providersList').innerHTML =
          `<div class="empty">Cannot reach gateway.<br><small>${esc(res?.message || '')}</small></div>`;
      }
    });
  }

  // ── Utilities ────────────────────────────────────────────────────────────────
  function showMsg(id, text, type) {
    const el = $(id);
    el.textContent = text;
    el.className = `msg show ${type}`;
  }

  function hideMsg(id) {
    $(id).className = 'msg';
  }

  function esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Boot ─────────────────────────────────────────────────────────────────────
  async function init() {
    await Promise.all([loadSettings(), loadAutoExtract()]);
    checkGateway();

    chrome.runtime.sendMessage({ type: 'GET_CURRENT_TAB' }, res => {
      currentTab = res?.tab ?? null;
      const domainEl = $('currentDomain');
      if (currentTab?.url) {
        try {
          domainEl.textContent = new URL(currentTab.url).hostname || currentTab.url;
        } catch {
          domainEl.textContent = currentTab.url;
        }
      } else {
        domainEl.textContent = 'No active tab';
      }
      fetchProviders();
    });
  }

  init();
})();
