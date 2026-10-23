import './style.css';
document.querySelector('#open-options')!.addEventListener('click', () => { void chrome.runtime.openOptionsPage(); });
document.querySelector('#enable-tab')!.addEventListener('click', async () => {
  const status = document.querySelector('#popup-status')!;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab.id || !tab.url?.match(/^https?:/)) throw new Error('Open an ordinary website to connect Aksara.');
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    const result = await chrome.tabs.sendMessage(tab.id, { type: 'AKSARA_PING' });
    status.textContent = `Connected · ${result.imageCount} images found. Image controls arrive in Phase 2.`;
  } catch (error) { status.textContent = error instanceof Error ? error.message : 'Could not connect this tab.'; }
});
