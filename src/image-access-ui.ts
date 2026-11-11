import { validateImageUrl } from './image-policy';

/** Permission requests stay in an extension-owned page and trusted click. */
export function mountImageAccess() {
  const section = document.querySelector<HTMLElement>('#image-access');
  if (!section) return;
  const text = section.querySelector<HTMLElement>('[data-access-host]')!, button = section.querySelector<HTMLButtonElement>('button')!, status = section.querySelector<HTMLElement>('[role=status]')!;
  let pattern: string | undefined;
  let version = 0;
  const refresh = async () => {
    const current = ++version;
    const saved = await chrome.storage.session.get('pendingImagePermission');
    if (current !== version) return;
    const value = saved.pendingImagePermission as { origin?: string; createdAt?: number } | undefined;
    if (!value?.createdAt || typeof value.origin !== 'string' || Date.now() - value.createdAt > 300_000) { if (!section.dataset.granted) section.hidden = true; return; }
    try {
      const url = validateImageUrl(value.origin), nextPattern = `${url.origin}/*`;
      if (await chrome.permissions.contains({ origins: [nextPattern] }) || current !== version) return;
      pattern = nextPattern; button.hidden = false; delete section.dataset.granted;
      text.textContent = `The selected image is hosted on ${url.hostname}. Allow Aksara to read images from this host?`;
      section.hidden = false; button.focus();
    } catch { /* Invalid or expired access request. */ }
  };
  const changed = (changes: Record<string,chrome.storage.StorageChange>,area: string) => { if (area === 'session' && changes.pendingImagePermission) void refresh(); };
  chrome.storage.onChanged.addListener(changed);
  addEventListener('pagehide',() => chrome.storage.onChanged.removeListener(changed),{once:true});
  void refresh();
  button.addEventListener('click',event => {
    if (!event.isTrusted || !pattern) return;
    const consent = chrome.permissions.request({ origins: [pattern] }); button.disabled = true;
    void consent.then(async granted => {
      status.textContent = granted ? 'Access allowed. Return to your image and choose Translate again.' : 'Access was not granted. You can try again.';
      if (granted) { section.dataset.granted = 'true'; await chrome.storage.session.remove('pendingImagePermission'); button.hidden = true; }
    }).catch(() => { status.textContent = 'Chrome could not grant access. Reopen Settings and retry.'; }).finally(() => { button.disabled = false; });
  });
}
