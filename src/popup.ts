import './style.css';
import { validateImageUrl } from './image-policy';
document.querySelector('#open-options')!.addEventListener('click', () => { void chrome.runtime.openOptionsPage(); });
document.querySelector('#enable-tab')!.addEventListener('click', async () => {
  const status = document.querySelector('#popup-status')!;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab.id || !tab.url?.match(/^https?:/)) throw new Error('Open an ordinary website to connect Aksara.');
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    const result = await chrome.tabs.sendMessage(tab.id, { type: 'AKSARA_PING' });
    status.textContent = `Enabled · ${result.eligibleCount ?? result.imageCount} images ready. Hover or use Tab to reach Translate.`;
  } catch (error) { status.textContent = error instanceof Error ? error.message : 'Could not connect this tab.'; }
});

let pendingPattern: string | null = null;
const permissionSection = document.querySelector<HTMLElement>('#image-permission')!;
const allow = document.querySelector<HTMLButtonElement>('#allow-image-host')!;
void chrome.storage.session.get('pendingImagePermission').then(async ({ pendingImagePermission }) => {
  const value = pendingImagePermission as { origin?: string; createdAt?: number } | undefined;
  if (!value?.origin || !value.createdAt || Date.now() - value.createdAt > 300_000) return;
  try {
    const url = validateImageUrl(value.origin);
    pendingPattern = `${url.origin}/*`;
    if (await chrome.permissions.contains({ origins: [pendingPattern] })) return;
    document.querySelector('#image-host')!.textContent = `The selected image is hosted on ${url.hostname}. Allow access to read its images?`;
    permissionSection.hidden = false;
  } catch { pendingPattern = null; }
});
allow.addEventListener('click', () => {
  if (!pendingPattern) return;
  // Invoke directly inside the trusted popup click; messaging does not preserve
  // permission user gestures reliably across contexts and asynchronous work.
  const permission = chrome.permissions.request({ origins: [pendingPattern] });
  allow.disabled = true;
  void permission.then(async granted => {
    document.querySelector('#popup-status')!.textContent = granted ? 'Access granted. Return to the image and click Translate again.' : 'Access was not granted. You can retry or prepare another image.';
    if (granted) { permissionSection.hidden = true; await chrome.storage.session.remove('pendingImagePermission'); }
  }).catch(() => { document.querySelector('#popup-status')!.textContent = 'Chrome could not grant access. Open this popup and try again.'; }).finally(() => { allow.disabled = false; });
});
