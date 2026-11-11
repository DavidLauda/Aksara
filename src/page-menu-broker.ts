import { siteAllowed, siteSettings, SITE_SETTINGS_KEY } from './site-settings';
import { validateImageUrl } from './image-policy';

/** Read-only menu data and explicit activation, bound to Chrome's sender document. */
export async function handlePageMenu(message: Record<string, unknown>, sender: chrome.runtime.MessageSender, modelState: () => Promise<unknown>) {
  const tabId = sender.tab?.id, documentId = sender.documentId;
  if (sender.id !== chrome.runtime.id || tabId === undefined || sender.frameId !== 0 || !documentId || !/^https?:\/\//.test(sender.url ?? '')) return { ok: false, error: 'UNAUTHORIZED_CONTEXT' };
  const tab = await chrome.tabs.get(tabId);
  if (!tab.active || tab.url !== sender.url) return { ok: false, error: 'PAGE_CHANGED' };
  const origin = new URL(sender.url!).origin;
  const ping = () => chrome.tabs.sendMessage(tabId, { type: 'AKSARA_PING' }, { documentId }).catch(() => null);
  if (message.type === 'ENABLE_PAGE_IMAGES') {
    const saved = await chrome.storage.local.get(SITE_SETTINGS_KEY);
    if (!siteAllowed(siteSettings(saved[SITE_SETTINGS_KEY]), origin)) return { ok: false, error: 'SITE_DISABLED' };
    let connected = await ping();
    if (!connected?.controlsEnabled) {
      await chrome.scripting.executeScript({ target: { tabId, documentIds: [documentId] }, files: ['content.js'] });
      connected = await ping();
    }
    return { ok: true, controlsEnabled: true, imageCount: connected?.imageCount ?? 0 };
  }
  if (message.type === 'OPEN_PRIVACY') { await chrome.tabs.create({ url: chrome.runtime.getURL('privacy.html') }); return { ok: true }; }
  const snapshot = await modelState() as { model: { ready: boolean; cachedBytes: number; totalBytes: number }; job?: { state: string; progress?: { stage: string; fraction: number | null } } };
  const running = snapshot.job?.state === 'running';
  const fraction = snapshot.job?.progress?.fraction;
  const summary = running ? `Preparing model${typeof fraction === 'number' ? ` · ${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%` : '…'}`
    : snapshot.job?.state === 'error' ? 'Setup needs attention'
    : snapshot.model.ready ? 'Ready offline'
    : snapshot.model.cachedBytes > 0 ? 'Download incomplete' : `Download model · ${Math.ceil(snapshot.model.totalBytes / 1_000_000)} MB`;
  let pendingHost: string | undefined;
  const savedPermission = await chrome.storage.session.get('pendingImagePermission');
  const pendingImagePermission = savedPermission.pendingImagePermission as { origin?: string; createdAt?: number; tabId?: number; documentId?: string } | undefined;
  if (pendingImagePermission?.tabId === tabId && pendingImagePermission.documentId === documentId && pendingImagePermission.createdAt && typeof pendingImagePermission.origin === 'string' && pendingImagePermission.createdAt > Date.now() - 300_000) {
    try { const url = validateImageUrl(pendingImagePermission.origin); if (!await chrome.permissions.contains({ origins: [`${url.origin}/*`] })) pendingHost = url.hostname; } catch { /* Ignore stale/invalid access requests. */ }
  }
  return { ok: true, controlsEnabled: !!(await ping())?.controlsEnabled, model: { summary, running, needsSetup: !snapshot.model.ready || snapshot.job?.state === 'error', state: running ? 'running' : snapshot.job?.state === 'error' ? 'error' : snapshot.model.ready ? 'ready' : snapshot.model.cachedBytes ? 'partial' : 'empty' }, pendingHost };
}
