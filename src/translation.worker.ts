import { checkGpu } from './gpu';
import { errorMessage } from './protocol';
import { translate, unload } from './translation';
self.onmessage = async ({ data }) => {
  try {
    const result = data.type === 'UNLOAD' ? await unload() : data.type === 'CHECK_GPU' ? await checkGpu() : await translate(data.text, data.baseUrl, event => self.postMessage({ id: data.id, type: 'PROGRESS', event }), data.pair);
    self.postMessage({ id: data.id, type: 'RESULT', result });
  } catch (error) { self.postMessage({ id: data.id, type: 'ERROR', error: errorMessage(error) }); }
};
