// Phase 1 connection endpoint. Image detection and overlays are Phase 2/5.
// Keep this entry self-contained: Chrome content scripts are classic scripts.
(() => {
  const key = '__aksaraConnected';
  const scope = globalThis as typeof globalThis & { __aksaraConnected?: boolean };
  if (scope[key]) return;
  scope[key] = true;
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id === chrome.runtime.id && message?.type === 'AKSARA_PING') sendResponse({ ok: true, imageCount: document.images.length });
  });
})();
