// Browser-test adapter for Chrome action views, which are discoverable CDP page
// targets but are not automatically exposed as Playwright Pages. No production
// code or permissions are changed. All input uses Chrome's trusted Input domain.
import { writeFile } from 'node:fs/promises';
export class NativePopup {
  constructor(browser, targetId, errors) {
    this.browser = browser; this.targetId = targetId; this.closed = false; this.sequence = 0; this.pending = new Map();
    this.receive = event => {
      if (event.sessionId !== this.sessionId) return;
      const message = JSON.parse(event.message), task = this.pending.get(message.id);
      if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
      if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(message.params.args.map(arg => arg.value ?? arg.description ?? '').join(' '));
      if (!task) return; this.pending.delete(message.id); clearTimeout(task.timer);
      if (message.error) task.reject(new Error(message.error.message)); else task.resolve(message.result);
    };
    this.detached = event => { if (event.sessionId === this.sessionId) { this.closed = true; this.cleanup(); } };
    browser.on('Target.receivedMessageFromTarget', this.receive); browser.on('Target.detachedFromTarget', this.detached);
    this.keyboard = { press: key => this.press(key) };
  }
  static async attach(browser, targetId, errors = []) { const view = new NativePopup(browser, targetId, errors); view.sessionId = (await browser.send('Target.attachToTarget', { targetId, flatten:false })).sessionId; await view.command('Runtime.enable'); return view; }
  cleanup() { this.browser.off('Target.receivedMessageFromTarget',this.receive); this.browser.off('Target.detachedFromTarget',this.detached); for (const task of this.pending.values()) { clearTimeout(task.timer); task.reject(new Error('Native popup closed')); } this.pending.clear(); }
  command(method,params = {}) {
    return new Promise((resolve,reject) => { const id = ++this.sequence, timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Native popup command timed out: ${method}`)); },10_000); this.pending.set(id,{resolve,reject,timer}); this.browser.send('Target.sendMessageToTarget',{sessionId:this.sessionId,message:JSON.stringify({id,method,params})}).catch(error => { clearTimeout(timer); this.pending.delete(id); reject(error); }); });
  }
  async expression(expression) { const result = await this.command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true}); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result.value; }
  evaluate(fn,arg) { return this.expression(`(${fn.toString()})(${JSON.stringify(arg) ?? 'undefined'})`); }
  async waitForLoadState() { for (let i=0;i<100;i++) { if (await this.evaluate(() => document.readyState === 'complete')) return; await new Promise(done => setTimeout(done,50)); } throw new Error('Native popup did not finish loading'); }
  isClosed() { return this.closed; }
  async screenshot({path}) { const result = await this.command('Page.captureScreenshot',{format:'png'}); await writeFile(path,Buffer.from(result.data,'base64')); }
  getByText(text) { return { count: () => this.evaluate(text => [...document.querySelectorAll('body *')].filter(node => node.textContent.trim() === text).length,text) }; }
  locator(selector) {
    const evaluate = (fn) => this.expression(`(${fn.toString()})(document.querySelector(${JSON.stringify(selector)}))`);
    const visible = () => evaluate(node => !!node && node.checkVisibility({checkVisibilityCSS:true,checkOpacity:true}));
    const click = async () => { const point = await evaluate(node => { const box = node.getBoundingClientRect(); return {x:box.x+box.width/2,y:box.y+box.height/2}; }); await this.command('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1}); await this.command('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1}); };
    return {
      evaluate, innerText: () => evaluate(node => node.innerText), count: () => this.evaluate(selector => document.querySelectorAll(selector).length,selector),
      isEnabled: () => evaluate(node => !node.disabled), isDisabled: () => evaluate(node => node.disabled), isVisible:visible,
      focus: () => evaluate(node => node.focus()), check:async () => { if (!await evaluate(node => node.checked)) await click(); }, uncheck:async () => { if (await evaluate(node => node.checked)) await click(); },
      selectOption: value => this.expression(`(()=>{const node=document.querySelector(${JSON.stringify(selector)});node.value=${JSON.stringify(value)};node.dispatchEvent(new Event('change',{bubbles:true}));})()`),
      waitFor: async () => { for (let i=0;i<100;i++) { if (await visible()) return; await new Promise(done => setTimeout(done,50)); } throw new Error(`Native popup control unavailable: ${selector}`); },
    };
  }
  async press(name) { const keys = {Enter:['Enter','Enter',13],Space:[' ','Space',32],End:['End','End',35],Tab:['Tab','Tab',9]}, [key,code,keyCode] = keys[name]; await this.command('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:keyCode,...(name === 'Space' ? {text:' '} : name === 'Enter' ? {text:'\r'} : {})}); if (!this.closed) await this.command('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:keyCode}); }
}
