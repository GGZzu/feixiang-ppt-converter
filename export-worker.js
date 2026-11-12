'use strict';

importScripts('./pptxgen.bundle.js', './pptx.js?v=3');

self.addEventListener('message', async ({ data: input }) => {
  let lastProgress = -1;
  function progress(value, label) {
    if (value === lastProgress) return;
    lastProgress = value;
    self.postMessage({ type: 'progress', value, label });
  }
  try {
    const result = await self.LessonPptx.exportPptx(input.lesson, input.cover, self.PptxGenJS, self.JSZip, progress);
    self.postMessage({ type: 'done', ...result }, [result.bytes]);
  } catch (error) {
    self.postMessage({ type: 'error', message: error.message || 'PPT 生成失败。' });
  }
});

