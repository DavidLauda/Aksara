import tokens from '../design-tokens.json';

export const CONTROL_CSS = `
  :host{--aks-ink:${tokens.color.ink};--aks-muted:${tokens.color.muted};--aks-accent:${tokens.color.accent};--aks-surface:${tokens.color.surface};--aks-glass:${tokens.color.glass};--aks-line:${tokens.color.line};--aks-focus:${tokens.color.focus}}
  *{box-sizing:border-box}[hidden]{display:none!important}.sr-only{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip-path:inset(50%)!important;white-space:nowrap!important;border:0!important}
  .control{position:absolute;z-index:1;pointer-events:none;width:max-content;max-width:calc(100vw - 16px);text-align:left;color:var(--aks-ink);font:13px/1.45 system-ui,sans-serif}
  .actionbar{pointer-events:auto;display:flex;align-items:center;gap:2px;width:max-content;max-width:100%;height:44px;padding:3px;border:1px solid var(--aks-line);border-top-color:#ffffffed;border-radius:22px;background:var(--aks-surface);box-shadow:inset 0 1px 0 #fff,0 4px 18px #0d21181f;isolation:isolate}
  .control button{pointer-events:auto;display:inline-flex;align-items:center;justify-content:center;gap:6px;min-width:36px;min-height:36px;margin:0;border:0;border-radius:16px;padding:8px;background:transparent;color:var(--aks-ink);font:600 12px/1.3 system-ui,sans-serif;cursor:pointer;white-space:nowrap}
  .control button.labeled{padding-inline:11px}.control button:hover{background:#193d3010}.control button[aria-pressed=true]{background:#25563f;color:#fff}.control button:disabled{cursor:wait;opacity:.6}
  .control button:focus-visible,.control textarea:focus-visible{outline:3px solid var(--aks-focus);outline-offset:2px}.control svg{display:block;flex:none;width:16px;height:16px;stroke:currentColor;stroke-width:1.8;fill:none;stroke-linecap:round;stroke-linejoin:round}
  .control:not(.has-status):not(.glass-active) .actionbar{opacity:.82}.control.compact .toggle-original span,.control.compact .read-translation span{display:none}
  .control .dismiss{border-left:1px solid var(--aks-line);border-radius:0 16px 16px 0;margin-left:2px}.control .translate{color:var(--aks-accent)}
  .state-label{display:flex;align-items:center;gap:8px;min-width:132px;padding:0 10px;font-size:12px;font-weight:600;white-space:nowrap}.spinner{display:block;width:14px;height:14px;border:1.5px solid #193d3033;border-top-color:var(--aks-accent);border-radius:50%;animation:aks-spin 1s linear infinite}
  .card{position:absolute;top:calc(100% + 6px);right:var(--panel-right,0px);width:280px;max-width:calc(100vw - 16px);max-height:var(--panel-height,300px);overflow:auto;pointer-events:auto;overscroll-behavior:contain;border:1px solid var(--aks-line);border-top-color:#fff;border-radius:16px;background:#f9fcfafa;box-shadow:inset 0 1px 0 #fff,0 8px 28px #0d211824}
  .control[data-side=above] .card{top:auto;bottom:calc(100% + 6px)}.menu{padding:5px}.menu button{display:flex;justify-content:flex-start;width:100%;border-radius:10px;padding:10px;min-height:38px}.menu button[aria-pressed=true]{background:#e1ece5;color:var(--aks-ink)}
  .reader{padding:12px}.reader-head{display:flex;align-items:center;justify-content:space-between;gap:8px}.reader h2{margin:0;font:600 13px/1.4 system-ui,sans-serif}.control .reader-close{min-width:36px;min-height:36px;padding:8px}.reader textarea{display:block;width:100%;min-height:108px;height:130px;max-height:180px;resize:vertical;margin:8px 0 0;border:1px solid #8fa99a;border-radius:8px;padding:9px;background:#fff;color:#193d30;font:14px/1.5 system-ui,sans-serif}
  .notice{padding:12px}.notice p,.reader .copy-help{margin:0;font:12px/1.5 system-ui,sans-serif;overflow-wrap:anywhere;color:var(--aks-ink)}.notice .setup{margin-top:8px;background:var(--aks-accent);color:#fff;border-radius:10px;padding-inline:12px}.reader .copy-help{margin-top:8px}
  .actionbar .copied{color:#1d6041;background:#dcefe3}.control.contrast .actionbar,.control.contrast .card{background:#fff;border-color:#333;box-shadow:none;color:#000}.control.contrast button{color:#000}.control.contrast button[aria-pressed=true]{background:#000;color:#fff}
  @supports(backdrop-filter:blur(1px)){.control.glass-active:not(.contrast) .actionbar{background:linear-gradient(#ffffff38,#ffffff00),var(--aks-glass);backdrop-filter:blur(10px) saturate(1.1)}}
  @media(prefers-reduced-transparency:reduce){.control .actionbar{backdrop-filter:none!important;background:var(--aks-surface)!important}}
  @media(prefers-reduced-motion:reduce){.spinner{animation:none}}
  @media(forced-colors:active){.control .actionbar,.control .card{background:Canvas!important;color:CanvasText;backdrop-filter:none!important;box-shadow:none;border:1px solid CanvasText}.control button,.control textarea{color:CanvasText;background:Canvas}.control button:focus-visible,.control textarea:focus-visible{outline-color:Highlight}.control button[aria-pressed=true],.control.contrast button[aria-pressed=true]{background:Highlight;color:HighlightText}}
  @keyframes aks-spin{to{transform:rotate(360deg)}}
`;

type Icon = 'translate' | 'eye' | 'copy' | 'more' | 'close' | 'retry' | 'contrast' | 'read' | 'check';
const paths: Record<Icon, string[]> = {
  translate: ['M4 5h10M9 3v2M6 5c0 6 5 9 8 10M12 5c0 6-5 9-8 10', 'm13 21 4-10 4 10m-6.5-4h5'],
  eye: ['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z', 'M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0'],
  copy: ['M8 8h12v13H8Z', 'M16 8V3H3v13h5'], more: ['M5 11v2M12 11v2M19 11v2'], close: ['m6 6 12 12M18 6 6 18'],
  retry: ['M20 7v5h-5', 'M20 12a8 8 0 1 0-2 5M20 7l-3-3'], contrast: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z', 'M12 3v18M12 7h4M12 11h7M12 15h6'],
  read: ['M5 3h10l4 4v14H5Z', 'M14 3v5h5M8 12h8M8 16h6'], check: ['m5 12 4 4L19 6'],
};
function icon(name: Icon) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
  for (const d of paths[name]) { const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', d); svg.append(path); }
  return svg;
}
function button(className: string, label: string, symbol: Icon, text?: string) {
  const node = document.createElement('button'); node.type = 'button'; node.className = className; node.setAttribute('aria-label', label); node.title = label; node.append(icon(symbol));
  if (text) { const span = document.createElement('span'); span.textContent = text; node.append(span); node.classList.add('labeled'); }
  return node;
}
const setText = (node: HTMLElement, value: string) => { if (node.textContent !== value) node.textContent = value; };
export type ControlView = {
  status: string; pending: boolean; original: boolean; highContrast: boolean; fallback: boolean; needsReader: boolean; readerOpen: boolean; partial: boolean;
  sourceText?: string; translatedText?: string; notice?: string; setup: boolean; actionNotice: string;
};
type Actions = { translate: () => void; dismiss: () => void; original: () => void; copy: () => void; contrast: () => void; read: (open: boolean) => void; setup: () => void; activate: () => void; menuOpened: () => void };

/** One small controller per image. Global outside-click/active-glass policy is
 * delegated to the content script, rather than adding document listeners per image. */
export class ImageControls {
  readonly element = document.createElement('div');
  readonly panels = document.createElement('div');
  readonly entry = button('translate', 'Translate image', 'translate', 'Translate');
  private readonly retry = button('retry-primary', 'Try again', 'retry', 'Try again');
  private readonly original = button('toggle-original', 'Show original', 'eye', 'Original');
  private readonly copy = button('copy-translation', 'Copy translation', 'copy');
  private readonly more = button('more', 'More options', 'more');
  private readonly dismiss = button('dismiss', 'Dismiss translation', 'close');
  private readonly read = button('read-translation', 'Read full translation', 'read', 'Read');
  private readonly readerClose = button('reader-close', 'Close text reader', 'close');
  private readonly retryOption = button('retry-translation', 'Translate again', 'retry', 'Translate again');
  private readonly contrast = button('overlay-contrast', 'High contrast', 'contrast', 'High contrast');
  private readonly setup = button('setup', 'Open setup', 'translate', 'Open setup');
  private readonly live = document.createElement('p');
  private readonly actionLive = document.createElement('p');
  private readonly busy = document.createElement('span');
  private readonly busyText = document.createElement('span');
  private readonly menu = document.createElement('div');
  private readonly reader = document.createElement('section');
  private readonly heading = document.createElement('h2');
  private readonly source = document.createElement('textarea');
  private readonly translated = document.createElement('textarea');
  private readonly notice = document.createElement('div');
  private readonly noticeText = document.createElement('p');
  private readonly copyHelp = document.createElement('p');
  private menuOpen = false;
  private view?: ControlView;
  private copiedTimer?: ReturnType<typeof setTimeout>;

  constructor(id: string, private readonly actions: Actions) {
    this.element.className = 'control'; this.element.dataset.imageId = id;
    const bar = document.createElement('div'); bar.className = 'actionbar'; bar.setAttribute('role', 'group'); bar.setAttribute('aria-label', 'Aksara image translation');
    this.live.className = 'sr-only'; this.live.setAttribute('role', 'status'); this.live.setAttribute('aria-live', 'polite'); this.live.setAttribute('aria-atomic', 'true');
    this.actionLive.className = 'sr-only action-note'; this.actionLive.setAttribute('role', 'status');
    this.busy.className = 'state-label'; const spinner = document.createElement('span'); spinner.className = 'spinner'; spinner.setAttribute('aria-hidden', 'true'); this.busy.append(spinner, this.busyText);
    this.panels.className = 'card'; this.panels.hidden = true;
    this.menu.id = `options-${id}`; this.menu.className = 'menu'; this.menu.setAttribute('role', 'group'); this.menu.setAttribute('aria-label', 'Translation options');
    this.more.setAttribute('aria-controls', this.menu.id); this.more.setAttribute('aria-expanded', 'false');
    this.reader.id = `reader-${id}`; this.reader.className = 'reader'; this.reader.setAttribute('aria-labelledby', `reader-title-${id}`);
    this.heading.id = `reader-title-${id}`; const head = document.createElement('div'); head.className = 'reader-head'; head.append(this.heading, this.readerClose);
    this.read.setAttribute('aria-controls', this.reader.id); this.read.setAttribute('aria-expanded', 'false');
    for (const [field, name, key] of [[this.source, 'Recognized text', 'source'], [this.translated, 'Translated text', 'translation']] as const) {
      field.id = `${key}-${id}`; field.className = key === 'source' ? 'recognized-text' : 'translated-text'; field.readOnly = true; field.spellcheck = false; field.setAttribute('aria-label', name);
      const label = document.createElement('label'); label.className = 'sr-only'; label.htmlFor = field.id; label.textContent = name; this.reader.append(label);
    }
    this.copyHelp.className = 'copy-help'; this.reader.prepend(head); this.reader.append(this.source, this.translated, this.copyHelp);
    this.notice.className = 'notice'; this.notice.append(this.noticeText, this.setup);
    this.menu.append(this.retryOption, this.contrast); this.panels.append(this.menu, this.reader, this.notice);
    bar.append(this.entry, this.retry, this.busy, this.original, this.read, this.copy, this.more, this.dismiss);
    this.element.append(this.live, this.actionLive, bar, this.panels);
    const on = (node: HTMLButtonElement, task: () => void) => node.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); if (event.isTrusted) { this.actions.activate(); task(); } });
    on(this.entry, actions.translate); on(this.retry, actions.translate); on(this.dismiss, actions.dismiss); on(this.original, actions.original); on(this.copy, actions.copy);
    on(this.more, () => { this.menuOpen = !this.menuOpen; if (this.menuOpen) { this.actions.menuOpened(); this.actions.read(false); } this.refresh(); if (this.menuOpen) this.retryOption.focus({ preventScroll: true }); });
    on(this.read, () => { this.closeMenu(); actions.read(!this.view?.readerOpen); if (this.view?.readerOpen) this.focusReader(); });
    on(this.readerClose, () => { actions.read(false); this.read.focus({ preventScroll: true }); });
    on(this.retryOption, () => { this.closeMenu(true); actions.translate(); }); on(this.contrast, () => { this.closeMenu(true); actions.contrast(); }); on(this.setup, actions.setup);
    this.element.addEventListener('focusin', () => actions.activate());
    this.element.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        if (this.menuOpen) { event.preventDefault(); event.stopPropagation(); this.closeMenu(true); }
        else if (this.view?.readerOpen) { event.preventDefault(); event.stopPropagation(); actions.read(false); this.read.focus({ preventScroll: true }); }
      } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && (event.target === this.more || this.menu.contains(event.target as Node))) {
        event.preventDefault(); if (!this.menuOpen) { this.menuOpen = true; actions.menuOpened(); actions.read(false); this.refresh(); }
        const choices = [this.retryOption, this.contrast].filter(node => !node.hidden), current = choices.indexOf((this.element.getRootNode() as ShadowRoot).activeElement as HTMLButtonElement);
        const index = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1 : event.key === 'ArrowUp' ? (current <= 0 ? choices.length - 1 : current - 1) : (current + 1) % choices.length;
        choices[index]?.focus({ preventScroll: true });
      }
    });
  }
  get isMenuOpen() { return this.menuOpen; }
  closeMenu(focus = false) { this.menuOpen = false; this.refresh(); if (focus && !this.more.hidden) this.more.focus({ preventScroll: true }); }
  focusReader() { (this.view?.translatedText ? this.translated : this.source).focus({ preventScroll: true }); }
  flashCopied() {
    clearTimeout(this.copiedTimer); this.copy.replaceChildren(icon('check')); this.copy.classList.add('copied'); this.copy.title = 'Copied';
    this.copiedTimer = setTimeout(() => { this.copy.replaceChildren(icon('copy')); this.copy.classList.remove('copied'); this.copy.title = this.view?.translatedText ? 'Copy translation' : 'Copy recognized text'; }, 1800);
  }
  render(view: ControlView) {
    if (this.view && (Object.keys(view) as Array<keyof ControlView>).every(key => view[key] === this.view![key])) return;
    this.view = view; if (view.pending || !view.status) this.menuOpen = false;
    this.element.classList.toggle('busy', view.pending); this.element.classList.toggle('has-status', !!view.status); this.element.classList.toggle('contrast', view.highContrast);
    const focused = (this.element.getRootNode() as ShadowRoot).activeElement as HTMLElement | null;
    const hasText = !!(view.translatedText || view.sourceText);
    this.entry.hidden = !!view.status; this.retry.hidden = view.pending || !view.status || hasText;
    this.busy.hidden = !view.pending; const percentage = /\d+%/.exec(view.status)?.[0];
    setText(this.busyText, `${/Translat/i.test(view.status) ? 'Translating' : /model/i.test(view.status) ? 'Preparing' : 'Reading'}${percentage ? ` ${percentage}` : '…'}`);
    this.original.hidden = !view.translatedText || view.fallback; this.original.setAttribute('aria-pressed', String(view.original));
    setText(this.original.querySelector('span')!, view.original ? 'Translation' : 'Original'); this.original.setAttribute('aria-label', view.original ? 'Show translation' : 'Show original'); this.original.title = view.original ? 'Show translation' : 'Show original';
    this.copy.hidden = !hasText; this.copy.setAttribute('aria-label', view.translatedText ? 'Copy translation' : 'Copy recognized text');
    this.read.hidden = !hasText || !(view.needsReader || view.readerOpen || !view.translatedText);
    setText(this.read.querySelector('span')!, view.translatedText ? view.partial ? 'Partial' : 'Read' : 'Read text'); this.read.setAttribute('aria-label', view.translatedText ? view.partial ? 'Read available translation' : 'Read full translation' : 'Read recognized text'); this.read.title = this.read.getAttribute('aria-label')!;
    this.read.setAttribute('aria-expanded', String(view.readerOpen));
    this.more.hidden = !hasText; this.more.setAttribute('aria-expanded', String(this.menuOpen));
    this.dismiss.hidden = !view.status; this.dismiss.setAttribute('aria-label', view.pending ? 'Cancel image preparation' : 'Dismiss translation'); this.dismiss.title = view.pending ? 'Cancel translation' : 'Dismiss translation';
    this.contrast.hidden = !view.translatedText || view.fallback; this.contrast.setAttribute('aria-pressed', String(view.highContrast));
    this.source.hidden = !!view.translatedText; this.translated.hidden = !view.translatedText;
    if (this.source.value !== (view.sourceText ?? '')) this.source.value = view.sourceText ?? '';
    if (this.translated.value !== (view.translatedText ?? '')) this.translated.value = view.translatedText ?? '';
    setText(this.heading, view.translatedText ? view.partial ? 'Available translation' : 'Translation' : 'Text in image'); setText(this.copyHelp, view.actionNotice.includes('blocked') ? view.actionNotice : view.partial ? 'Some text was skipped. Try a smaller image for the rest.' : ''); this.copyHelp.hidden = !this.copyHelp.textContent;
    setText(this.noticeText, view.notice ?? ''); this.setup.hidden = !view.setup;
    setText(this.live, view.status); setText(this.actionLive, view.actionNotice);
    this.refresh();
    if (focused && this.element.contains(focused) && focused.closest('[hidden]')) (view.pending ? this.dismiss : !this.original.hidden ? this.original : !this.read.hidden ? this.read : !this.retry.hidden ? this.retry : this.entry).focus({ preventScroll: true });
  }
  private refresh() {
    if (!this.view) return;
    this.more.setAttribute('aria-expanded', String(this.menuOpen));
    this.menu.hidden = !this.menuOpen; this.reader.hidden = !this.view.readerOpen;
    this.notice.hidden = !this.view.notice || this.menuOpen || this.view.readerOpen;
    this.panels.hidden = this.menu.hidden && this.reader.hidden && this.notice.hidden;
  }
  positionPanel(viewX: number, viewY: number, viewWidth: number, viewHeight: number) {
    if (this.panels.hidden) return;
    const rect = this.element.getBoundingClientRect(), width = Math.min(280, viewWidth - 16);
    const left = Math.max(viewX + 8, Math.min(rect.right - width, viewX + viewWidth - width - 8));
    this.element.style.setProperty('--panel-right', `${rect.right - left - width}px`);
    const below = viewY + viewHeight - rect.bottom - 14, above = rect.top - viewY - 14;
    const side = below < Math.min(this.panels.scrollHeight, 220) && above > below ? 'above' : 'below';
    this.element.dataset.side = side; this.element.style.setProperty('--panel-height', `${Math.max(32, side === 'above' ? above : below)}px`);
  }
  dispose() { clearTimeout(this.copiedTimer); this.element.remove(); }
}
