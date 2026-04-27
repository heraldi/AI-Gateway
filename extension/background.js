/**
 * AI Gateway - Background Service Worker
 * Dynamic: works with ANY provider configured in the gateway.
 */

/** Extract ALL cookies from a given URL/domain */
async function extractCookiesFromUrl(url) {
  const allCookies = await chrome.cookies.getAll({ url });
  const result = {};
  for (const c of allCookies) {
    result[c.name] = c.value;
  }
  return result;
}

async function extractBudAuthFromTab(tabId, tabUrl) {
  if (!tabId) return {};
  try {
    const host = new URL(tabUrl).hostname;
    if (!host.endsWith('bud.app')) return {};
  } catch {
    return {};
  }

  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: async () => {
        const out = {};
        const looksJwt = value => typeof value === 'string' && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value);
        const rememberToken = value => {
          if (looksJwt(value) && !out.__clerk_bearer) out.__clerk_bearer = value;
        };

        try {
          const clerk = window.Clerk;
          const token =
            await clerk?.session?.getToken?.() ||
            await clerk?.client?.sessions?.[0]?.getToken?.();
          rememberToken(token);
        } catch {}

        for (const storage of [window.localStorage, window.sessionStorage]) {
          try {
            for (let i = 0; i < storage.length; i += 1) {
              const key = storage.key(i);
              if (!key) continue;
              const value = storage.getItem(key);
              if (!value) continue;
              const lower = key.toLowerCase();
              if (lower.includes('clerk') || lower.includes('token') || lower.includes('session')) {
                rememberToken(value);
                out[`storage_${key}`] = value;
              }
            }
          } catch {}
        }

        return out;
      },
    });
    return injection?.result && typeof injection.result === 'object' ? injection.result : {};
  } catch {
    return {};
  }
}

async function extractDevinAuthFromTab(tabId, tabUrl) {
  if (!tabId) return {};
  try {
    const host = new URL(tabUrl).hostname;
    if (host !== 'app.devin.ai') return {};
  } catch {
    return {};
  }

  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: async () => {
        const out = {};
        const looksJwt = value => typeof value === 'string' && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value);
        const rememberDevinToken = value => {
          if (typeof value === 'string' && value.length > 20 && !out.__devin_auth1_token) out.__devin_auth1_token = value;
        };
        const rememberAccessToken = (value, source = 'runtime') => {
          if (typeof value === 'string' && value.length > 20 && !out.__devin_bearer) {
            out.__devin_bearer = value;
            out.__devin_token_source = source;
          }
        };
        const rememberToken = value => {
          if (looksJwt(value)) rememberAccessToken(value);
        };
        const scanValue = (value, mode = 'none') => {
          if (!value || typeof value !== 'string') return;
          if (mode === 'access') rememberToken(value);
          if (mode === 'auth1') rememberDevinToken(value);
          try {
            const parsed = JSON.parse(value);
            const walk = node => {
              if (!node) return;
              if (typeof node === 'string') {
                if (mode === 'access') rememberToken(node);
                if (mode === 'auth1') rememberDevinToken(node);
                return;
              }
              if (Array.isArray(node)) {
                node.forEach(walk);
                return;
              }
              if (typeof node === 'object') {
                Object.values(node).forEach(walk);
              }
            };
            walk(parsed);
          } catch {}
        };

        const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
        for (let attempt = 0; attempt < 20 && !out.__devin_bearer; attempt += 1) {
          try {
            const getAccessToken = window.__HACK__getAccessToken || globalThis.__HACK__getAccessToken;
            if (typeof getAccessToken === 'function') {
              const token =
                await getAccessToken({ redirectOnError: false, cacheMode: attempt > 8 ? 'off' : 'on' });
              rememberAccessToken(token, 'getAccessToken');
            }
          } catch {}
          if (!out.__devin_bearer) await sleep(250);
        }

        try {
          const orgId = window.__HACK__devinOrgId || globalThis.__HACK__devinOrgId || window.__HACK__devinLatestVisitedOrgId || globalThis.__HACK__devinLatestVisitedOrgId;
          const orgName = window.__HACK__devinLatestVisitedOrgName || globalThis.__HACK__devinLatestVisitedOrgName;
          if (typeof orgId === 'string' && orgId) out.devin_orgid = orgId;
          if (typeof orgName === 'string' && orgName) out.devin_orgname = orgName;
        } catch {}

        for (const storage of [window.localStorage, window.sessionStorage]) {
          try {
            for (let i = 0; i < storage.length; i += 1) {
              const key = storage.key(i);
              if (!key) continue;
              const value = storage.getItem(key);
              if (!value) continue;
              const lower = key.toLowerCase();
              if (lower.includes('auth') || lower.includes('token') || lower.includes('session') || lower.includes('devin')) {
                out[`storage_${key}`] = value;
                if (key === 'auth1_session') {
                  try {
                    const parsed = JSON.parse(value);
                    rememberDevinToken(parsed?.token);
                  } catch {}
                } else if (lower.includes('access') || lower.includes('bearer')) {
                  scanValue(value, 'access');
                }
              }
            }
          } catch {}
        }

        return out;
      },
    });
    return injection?.result && typeof injection.result === 'object' ? injection.result : {};
  } catch {
    return {};
  }
}

/** Push cookies to gateway for a specific provider */
async function pushCookiesToGateway(providerId, cookies) {
  const { gatewayUrl, extensionToken } = await chrome.storage.local.get(['gatewayUrl', 'extensionToken']);
  const url = (gatewayUrl || 'http://localhost:3000').replace(/\/$/, '');
  const token = extensionToken || 'ext-token-change-me';

  if (Object.keys(cookies).length === 0) {
    return { success: false, message: 'No cookies found on this page. Make sure you are logged in.' };
  }

  try {
    const res = await fetch(`${url}/ext/cookies/${providerId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-extension-token': token },
      body: JSON.stringify({ cookies }),
    });
    if (!res.ok) {
      const text = await res.text();
      return { success: false, message: `Gateway ${res.status}: ${text}` };
    }
    return { success: true, message: `Pushed ${Object.keys(cookies).length} cookies` };
  } catch (err) {
    return { success: false, message: `Cannot reach gateway: ${err.message}` };
  }
}

/** Fetch all providers from gateway */
async function fetchProviders() {
  const { gatewayUrl, adminPassword } = await chrome.storage.local.get(['gatewayUrl', 'adminPassword']);
  const url = (gatewayUrl || 'http://localhost:3000').replace(/\/$/, '');
  const res = await fetch(`${url}/api/providers`, {
    headers: { 'x-admin-password': adminPassword || '' },
  });
  if (!res.ok) throw new Error(`Gateway ${res.status}`);
  return res.json();
}

function isBudUrl(url) {
  try {
    return new URL(url).hostname.endsWith('bud.app');
  } catch {
    return false;
  }
}

function isDevinUrl(url) {
  try {
    return new URL(url).hostname === 'app.devin.ai';
  } catch {
    return false;
  }
}

async function findBudTab() {
  const tabs = await chrome.tabs.query({ url: ['https://bud.app/*', 'https://*.bud.app/*'] });
  return tabs.find(tab => tab.id && tab.url) ?? null;
}

const temporaryBudAuthTabs = new Set();
const temporaryDevinAuthTabs = new Set();

function waitForTabComplete(tabId, timeoutMs = 15000, label = 'auth') {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out while opening ${label} for auth refresh.`));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
    };

    const finishIfReady = async () => {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.status === 'complete' && tab.url) {
          cleanup();
          resolve(tab);
        }
      } catch (err) {
        cleanup();
        reject(err);
      }
    };

    const onUpdated = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') finishIfReady();
    };
    const onRemoved = removedTabId => {
      if (removedTabId === tabId) {
        cleanup();
        reject(new Error(`${label} auth tab was closed before token extraction.`));
      }
    };

    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    finishIfReady();
  });
}

async function getBudAuthTarget({ createIfMissing = false } = {}) {
  const existing = await findBudTab();
  if (existing?.id && existing.url) return { tabId: existing.id, tabUrl: existing.url, temporary: false, kind: 'bud' };
  if (!createIfMissing) return null;

  const tab = await chrome.tabs.create({ url: 'https://bud.app/', active: false });
  if (!tab.id) throw new Error('Failed to open bud.app for auth refresh.');
  temporaryBudAuthTabs.add(tab.id);

  const loaded = await waitForTabComplete(tab.id, 15000, 'bud.app');
  if (!loaded.id || !loaded.url) throw new Error('Failed to load bud.app for auth refresh.');
  return { tabId: loaded.id, tabUrl: loaded.url, temporary: true, kind: 'bud' };
}

async function findDevinTab() {
  const tabs = await chrome.tabs.query({ url: ['https://app.devin.ai/*'] });
  return tabs.find(tab => tab.id && tab.url) ?? null;
}

async function getDevinAuthTarget({ createIfMissing = false } = {}) {
  const existing = await findDevinTab();
  if (existing?.id && existing.url) return { tabId: existing.id, tabUrl: existing.url, temporary: false, kind: 'devin' };
  if (!createIfMissing) return null;

  const tab = await chrome.tabs.create({ url: 'https://app.devin.ai/', active: false });
  if (!tab.id) throw new Error('Failed to open app.devin.ai for auth refresh.');
  temporaryDevinAuthTabs.add(tab.id);

  const loaded = await waitForTabComplete(tab.id, 30000, 'app.devin.ai');
  if (!loaded.id || !loaded.url) throw new Error('Failed to load app.devin.ai for auth refresh.');
  return { tabId: loaded.id, tabUrl: loaded.url, temporary: true, kind: 'devin' };
}

async function closeTemporaryBudTab(target) {
  if (!target?.temporary || target.kind !== 'bud' || !target.tabId) return;
  try {
    await chrome.tabs.remove(target.tabId);
  } catch {}
  temporaryBudAuthTabs.delete(target.tabId);
}

async function closeTemporaryDevinTab(target) {
  if (!target?.temporary || target.kind !== 'devin' || !target.tabId) return;
  try {
    await chrome.tabs.remove(target.tabId);
  } catch {}
  temporaryDevinAuthTabs.delete(target.tabId);
}

async function resolveExtractionTarget(providerId, tabUrl, tabId) {
  if (isBudUrl(tabUrl)) return { tabUrl, tabId };
  if (isDevinUrl(tabUrl)) return { tabUrl, tabId };

  let providers = [];
  try { providers = await fetchProviders(); } catch {}
  const provider = providers.find(p => p.id === providerId);
  if (provider?.type === 'devin-web') {
    const target = await getDevinAuthTarget({ createIfMissing: true });
    if (!target) throw new Error('Failed to open app.devin.ai for auth refresh.');
    return target;
  }
  if (provider?.type !== 'bud-web') return { tabUrl, tabId };

  const target = await getBudAuthTarget({ createIfMissing: true });
  if (!target) throw new Error('Failed to open bud.app for auth refresh.');
  return target;
}

async function extractAndPush(providerId, tabUrl, tabId) {
  const target = await resolveExtractionTarget(providerId, tabUrl, tabId);
  try {
    const cookies = {
      ...(await extractCookiesFromUrl(target.tabUrl)),
      ...(isBudUrl(target.tabUrl) ? await extractCookiesFromUrl('https://clerk.bud.app') : {}),
      ...(isBudUrl(target.tabUrl) ? await extractCookiesFromUrl('https://accounts.bud.app') : {}),
    };
    const budAuth = await extractBudAuthFromTab(target.tabId, target.tabUrl);
    const devinAuth = await extractDevinAuthFromTab(target.tabId, target.tabUrl);
    return pushCookiesToGateway(providerId, { ...cookies, ...budAuth, ...devinAuth });
  } finally {
    await closeTemporaryBudTab(target);
    await closeTemporaryDevinTab(target);
  }
}

/** Auto-extract: when a tab finishes loading, push cookies to all matching providers */
async function handleTabUpdate(tabId, changeInfo, tab) {
  if (changeInfo.status !== 'complete' || !tab.url) return;

  const { autoExtract } = await chrome.storage.local.get('autoExtract');
  if (!autoExtract) return;

  let providers;
  try { providers = await fetchProviders(); } catch { return; }

  const tabUrl = new URL(tab.url);

  for (const p of providers) {
    if (!p.base_url || !p.enabled) continue;
    try {
      const providerUrl = new URL(p.base_url);
      if (providerUrl.hostname !== tabUrl.hostname) continue;
      const result = await extractAndPush(p.id, tab.url, tabId);
      if (result.success) {
        chrome.action.setBadgeText({ text: '✓', tabId });
        chrome.action.setBadgeBackgroundColor({ color: '#3fb950', tabId });
        setTimeout(() => chrome.action.setBadgeText({ text: '', tabId }).catch(() => {}), 3000);
      }
    } catch { /* skip */ }
  }
}

chrome.tabs.onUpdated.addListener(handleTabUpdate);

/** Message handler for popup */
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {

  if (msg.type === 'EXTRACT_AND_PUSH') {
    const { providerId, tabUrl, tabId } = msg;
    extractAndPush(providerId, tabUrl, tabId)
      .then(sendResponse)
      .catch(err => sendResponse({ success: false, message: err.message }));
    return true;
  }

  if (msg.type === 'FETCH_PROVIDERS') {
    fetchProviders().then(providers => sendResponse({ success: true, providers }))
      .catch(err => sendResponse({ success: false, message: err.message }));
    return true;
  }

  if (msg.type === 'GET_CURRENT_TAB') {
    chrome.tabs.query({ active: true, currentWindow: true })
      .then(tabs => sendResponse({ tab: tabs[0] ?? null }));
    return true;
  }

  if (msg.type === 'SAVE_SETTINGS') {
    chrome.storage.local.set(msg.settings).then(() => sendResponse({ success: true }));
    return true;
  }

  if (msg.type === 'CHECK_GATEWAY') {
    const { gatewayUrl } = msg;
    const url = (gatewayUrl || 'http://localhost:3000').replace(/\/$/, '');
    fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) })
      .then(r => sendResponse({ ok: r.ok }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
});
