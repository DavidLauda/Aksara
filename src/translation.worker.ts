import { checkGpu } from './gpu';
import { errorMessage } from './protocol';
import { translate, translateImage, unload } from './translation';
self.onmessage = async ({ data }) => {
  try {
    const progress = (event: import('./protocol').Progress) => self.postMessage({ id: data.id, type: 'PROGRESS', event });
    const result = data.type === 'UNLOAD' ? await unload() : data.type === 'CHECK_GPU' ? await checkGpu() : data.type === 'TRANSLATE_IMAGE' ? await translateImage(data.ocr, data.baseUrl, progress) : await translate(data.text, data.baseUrl, progress, data.pair);
    self.postMessage({ id: data.id, type: 'RESULT', result });
  } catch (error) { self.postMessage({ id: data.id, type: 'ERROR', error: errorMessage(error) }); }
};
