import './style.css';
import { mountModelUi } from './model-ui';
import { validateImageUrl } from './image-policy';
import { DEFAULT_LANGUAGES, LANGUAGE_SETTINGS_KEY, SOURCE_LANGUAGES, TARGET_LANGUAGES, languageSettings } from './languages';
import { SITE_SETTINGS_KEY, setSiteAllowed, siteAllowed, siteOrigin, siteSettings } from './site-settings';

mountModelUi();

const enableTab = document.querySelector<HTMLButtonElement>('#enable-tab')!;
const siteEnabled = document.querySelector<HTMLInputElement>('#site-enabled')!;
const siteHelp = document.querySelector<HTMLElement>('#site-help')!;
const siteStatus = document.querySelector<HTMLElement>('#site-status')!;
let currentOrigin: string | null = null;
let currentTabId: number | undefined;
let sitePreferences = siteSettings(null);
let siteLoading = true;
let siteSaving = Promise.resolve();
let sitePending = false;
let requestedAllowed: boolean | undefined;
let siteVersion = 0;

function renderSite() {
  const allowed = currentOrigin !== null && siteAllowed(sitePreferences, currentOrigin);
  siteEnabled.checked = sitePending && requestedAllowed !== undefined ? requestedAllowed : allowed;
  siteEnabled.disabled = siteLoading || sitePending || !currentOrigin;
  enableTab.disabled = siteLoading || sitePending || !allowed;
}

const initialSiteVersion = siteVersion;
void Promise.all([chrome.tabs.query({ active: true, currentWindow: true }), chrome.storage.local.get(SITE_SETTINGS_KEY)]).then(([tabs, saved]) => {
  const tab = tabs[0];
  currentOrigin = siteOrigin(tab?.url); currentTabId = tab?.id;
  if (siteVersion === initialSiteVersion) sitePreferences = siteSettings(saved[SITE_SETTINGS_KEY]);
  siteHelp.textContent = currentOrigin ? `Only ${currentOrigin}. Enable controls for each new page.` : 'Open an ordinary website to change its controls.';
  siteLoading = false;
  renderSite();
}).catch(() => {
  siteHelp.textContent = 'Could not read this site. Reopen Aksara to retry.';
  siteLoading = false;
  renderSite();
});

siteEnabled.addEventListener('change', event => {
  if (!event.isTrusted || !currentOrigin || sitePending) { renderSite(); return; }
  const allowed = siteEnabled.checked;
  const origin = currentOrigin;
  sitePending = true; requestedAllowed = allowed; siteStatus.textContent = 'Saving site choice…'; renderSite();
  siteSaving = siteSaving.catch(() => {}).then(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id !== currentTabId || siteOrigin(tab?.url) !== origin) throw new Error('The active page changed. Reopen Aksara to choose its controls.');
    const saved = await chrome.storage.local.get(SITE_SETTINGS_KEY);
    const updated = setSiteAllowed(siteSettings(saved[SITE_SETTINGS_KEY]), origin, allowed);
    await chrome.storage.local.set({ [SITE_SETTINGS_KEY]: updated });
    sitePreferences = updated;
    siteStatus.textContent = allowed ? 'Allowed. Choose Enable image controls.' : 'Controls disabled here. Current results cleared.';
  }).catch(error => {
    siteStatus.textContent = error instanceof Error ? error.message : 'Could not save this site choice. Reopen Aksara to retry.';
  }).finally(() => { sitePending = false; requestedAllowed = undefined; renderSite(); });
});

const siteChanged = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
  if (area !== 'local' || !changes[SITE_SETTINGS_KEY]) return;
  siteVersion++;
  sitePreferences = siteSettings(changes[SITE_SETTINGS_KEY].newValue); renderSite();
};
chrome.storage.onChanged.addListener(siteChanged);
addEventListener('pagehide', () => { chrome.storage.onChanged.removeListener(siteChanged); }, { once: true });

const source = document.querySelector<HTMLSelectElement>('#source-language')!;
const target = document.querySelector<HTMLSelectElement>('#target-language')!;
const languageStatus = document.querySelector<HTMLElement>('#language-status')!;
for (const [select, languages] of [[source, SOURCE_LANGUAGES], [target, TARGET_LANGUAGES]] as const) {
  for (const language of languages) { const option = document.createElement('option'); option.value = language.code; option.textContent = language.label; select.append(option); }
}
let saving = Promise.resolve();
void chrome.storage.local.get(LANGUAGE_SETTINGS_KEY).then(saved => {
  const preferences = languageSettings(saved[LANGUAGE_SETTINGS_KEY]);
  source.value = preferences.sourceLanguage; target.value = preferences.targetLanguage;
  document.querySelector<HTMLFieldSetElement>('#language-settings')!.disabled = false;
  languageStatus.textContent = 'Language choices stay on this device.';
}).catch(() => {
  source.value = DEFAULT_LANGUAGES.sourceLanguage; target.value = DEFAULT_LANGUAGES.targetLanguage;
  languageStatus.textContent = 'Could not load choices. Reopen Aksara to retry.';
});
for (const select of [source, target]) select.addEventListener('change', () => {
  const preferences = languageSettings({ sourceLanguage: source.value, targetLanguage: target.value });
  languageStatus.textContent = 'Saving…';
  saving = saving.catch(() => {}).then(() => chrome.storage.local.set({ [LANGUAGE_SETTINGS_KEY]: preferences })).then(() => { languageStatus.textContent = 'Saved · applies to your next image.'; }).catch(() => { languageStatus.textContent = 'Could not save. Reopen Aksara and retry.'; });
});
document.querySelector('#open-options')!.addEventListener('click', () => { void chrome.runtime.openOptionsPage(); });
enableTab.addEventListener('click', async event => {
  if (!event.isTrusted) return;
  const status = document.querySelector('#popup-status')!;
  try {
    await saving; await siteSaving;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab.id || !tab.url?.match(/^https?:/)) throw new Error('Open an ordinary website to connect Aksara.');
    const origin = siteOrigin(tab.url);
    if (tab.id !== currentTabId || origin !== currentOrigin) throw new Error('The active page changed. Reopen Aksara to enable its controls.');
    const saved = await chrome.storage.local.get(SITE_SETTINGS_KEY);
    if (!origin || !siteAllowed(siteSettings(saved[SITE_SETTINGS_KEY]), origin)) throw new Error('Allow image controls on this site before enabling this page.');
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
allow.addEventListener('click', event => {
  if (!event.isTrusted || !pendingPattern) return;
  // Invoke directly inside the trusted popup click; messaging does not preserve
  // permission user gestures reliably across contexts and asynchronous work.
  const permission = chrome.permissions.request({ origins: [pendingPattern] });
  allow.disabled = true;
  void permission.then(async granted => {
    document.querySelector('#popup-status')!.textContent = granted ? 'Access granted. Return to the image and click Translate again.' : 'Access was not granted. You can retry or prepare another image.';
    if (granted) { permissionSection.hidden = true; await chrome.storage.session.remove('pendingImagePermission'); }
  }).catch(() => { document.querySelector('#popup-status')!.textContent = 'Chrome could not grant access. Open this popup and try again.'; }).finally(() => { allow.disabled = false; });
});
