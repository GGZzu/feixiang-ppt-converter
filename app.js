(function () {
  'use strict';

  const get = (id) => document.getElementById(id);
  const SAMPLE = [
    '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">',
    '<title>小组讨论练习</title></head><body><main id="intro">',
    '<h1>小组讨论练习</h1><p>遇到不同意见时，你会怎么做？</p></main>',
    '<script>',
    'const quizData = { levels: [',
    " {name: '合作中的选择', questions: [",
    "  {question: '同桌还没说完', scenario: '你已经想好答案，同桌还在解释自己的想法。', choices: [",
    "   {label: '等同桌讲完，再说自己的理由', feedback: '两个人都有机会把理由说清楚。', score: 10, correct: true},",
    "   {label: '打断同桌，直接告诉他答案', feedback: '同桌可能还没机会说出重要信息。', score: 0, correct: false}]},",
    "  {question: '小组有两个方案', scenario: '离下课还有五分钟，大家还没决定展示哪个方案。', choices: [",
    "   {label: '请两组各用一句话说出方案的优点', feedback: '先了解两种方案，再一起定一个可行的选择。', score: 10, correct: true},",
    "   {label: '不讨论，直接挑自己提出的方案', feedback: '有些同学可能不清楚选择这个方案的理由。', score: 0, correct: false}]}",
    ' ]} ], advanceMs: 5000 };',
    '</' + 'script></body></html>',
  ].join('\n');
  const MAX_IMAGE = 6 * 1024 * 1024;
  const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
  const tabIds = ['paste', 'file'];
  let lesson = null;
  let sourceVersion = 0;
  let coverVersion = 0;
  let pendingCover = Promise.resolve(null);
  let exportJob = null;

  function chooseTab(name, focus = false) {
    for (const id of tabIds) {
      const tab = get(id + '-tab');
      const active = id === name;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      get(id + '-panel').hidden = !active;
      if (active && focus) tab.focus();
    }
  }

  function showStatus(message = '', state = '') {
    const notice = get('status');
    notice.textContent = message;
    notice.dataset.state = state;
    notice.hidden = !message;
  }

  function clearLesson() {
    lesson = null;
    coverVersion++;
    pendingCover = Promise.resolve(null);
    get('cover-file').value = '';
    get('settings').hidden = true;
    get('preview-ready').hidden = true;
    get('preview-empty').hidden = false;
    get('preview-desc').textContent = '导入后可试选一道题，确认反馈。';
    get('export').disabled = true;
    get('export-note').textContent = '下载后用桌面版 PowerPoint 从第一页放映。';
    showStatus();
  }

  function element(tag, value, className) {
    const item = document.createElement(tag);
    item.textContent = value;
    if (className) item.className = className;
    return item;
  }

  function renderPreview(data) {
    const preview = get('preview-ready');
    const q = data.qs[0];
    get('preview-empty').hidden = true;
    preview.hidden = false;
    preview.style.setProperty('--source-canvas', '#' + data.c.canvas);
    get('preview-desc').textContent = '试选第一题，查看对应反馈。';
    get('lesson-name').textContent = data.brand;
    const facts = [data.levelCount + ' 关', data.qs.length + ' 题'];
    if (data.scored) facts.push('累计计分');
    if (data.qs.some((question) => question.emotion !== null)) facts.push('情绪强度');
    if (data.advanceMs && get('use-timing').checked) facts.push(data.advanceMs / 1000 + ' 秒翻页');
    get('facts').replaceChildren(...facts.map((fact) => element('span', fact)));
    const choices = element('div', '', 'choices');
    const feedback = element('p', '', 'choice-result');
    feedback.setAttribute('role', 'status');
    feedback.hidden = true;
    for (const [index, option] of q.options.entries()) {
      const letter = String.fromCharCode(65 + index);
      const button = element('button', letter + '  ' + option.text);
      button.type = 'button';
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', () => {
        for (const item of choices.children) item.setAttribute('aria-pressed', String(item === button));
        const result = option.result || option.tip || (option.correct === null ? '已选 ' + letter : option.correct ? '回答正确' : '再想一想');
        const points = option.points !== null ? ' · ' + (option.points > 0 ? '+' : '') + option.points + ' 分' : '';
        feedback.textContent = result + points;
        feedback.hidden = false;
      });
      choices.append(button);
    }
    get('preview-question').replaceChildren(element('h3', q.title), choices, feedback);
  }

  function imageURL(value) {
    if (/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=\s]+$/i.test(value) &&
        value.length < MAX_IMAGE * 1.34 + 48) return value;
    return '';
  }

  function allowedRemote(value) {
    try {
      const url = new URL(value);
      const trustedHost = url.hostname === 'fbcontent.cn' || url.hostname.endsWith('.fbcontent.cn');
      return url.protocol === 'https:' && trustedHost && !url.port && !url.username && !url.password ? url : null;
    } catch {
      return null;
    }
  }

  async function loadImageBlob(url) {
    const response = await fetch(url, {
      credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
      signal: AbortSignal.timeout(8000),
    });
    const type = (response.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
    const size = Number(response.headers.get('Content-Length'));
    if (!response.ok || !IMAGE_TYPES.has(type) || size > MAX_IMAGE) throw Error('封面图片不可用。');
    const reader = response.body.getReader();
    const chunks = [];
    let bytes = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_IMAGE) {
          await reader.cancel();
          throw Error('封面图片太大。');
        }
        chunks.push(value);
      }
      return new Blob(chunks, { type });
    } finally {
      reader.releaseLock();
    }
  }

  async function coverData(image) {
    const url = typeof image === 'string' ? image : URL.createObjectURL(image);
    try {
      const item = new Image();
      item.src = url;
      await item.decode();
      const canvas = document.createElement('canvas');
      canvas.width = 864;
      canvas.height = 935;
      const scale = Math.max(canvas.width / item.naturalWidth, canvas.height / item.naturalHeight);
      const width = item.naturalWidth * scale;
      const height = item.naturalHeight * scale;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(item, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
      return canvas.toDataURL('image/jpeg', 0.92);
    } finally {
      if (typeof image !== 'string') URL.revokeObjectURL(url);
    }
  }

  function prepareCover(value) {
    const version = ++coverVersion;
    const notice = get('cover-state');
    const remote = allowedRemote(value);
    const embedded = imageURL(value);
    if (!remote && !embedded) {
      pendingCover = Promise.resolve(null);
      notice.textContent = value ? '这个封面地址无法直接读取，可另选本地图片。' : '没有封面插图，可按需选择一张。';
      return;
    }
    notice.textContent = '正在读取原课件的封面。';
    pendingCover = (remote ? loadImageBlob(remote).then(coverData) : coverData(embedded))
      .then((data) => {
        if (version === coverVersion) notice.textContent = '已读取原封面，导出时会嵌入 PPT。';
        return data;
      }).catch(() => {
        if (version === coverVersion) notice.textContent = '暂时无法读取原封面，可另选本地图片。';
        return null;
      });
  }

  function addCover(file) {
    if (!file) return;
    if (!IMAGE_TYPES.has(file.type) || file.size > MAX_IMAGE) {
      get('cover-state').textContent = '请选择不超过 6 MB 的 JPG、PNG 或 WebP 图片。';
      return;
    }
    const version = ++coverVersion;
    pendingCover = coverData(file).then((data) => {
      if (version === coverVersion) get('cover-state').textContent = '已选用本地封面。';
      return data;
    }).catch(() => {
      if (version === coverVersion) get('cover-state').textContent = '无法读取这张图片，请重新选择。';
      return null;
    });
  }

  function activeLesson() {
    return { ...lesson, advanceMs: get('use-timing').checked ? lesson.advanceMs : 0 };
  }

  function checkPlan() {
    try {
      LessonPptx.plan(activeLesson());
      get('export').disabled = false;
      showStatus('已识别 ' + lesson.levelCount + ' 关、' + lesson.qs.length + ' 题。');
    } catch (error) {
      get('export').disabled = true;
      get('settings').open = true;
      showStatus(error.message, 'error');
    }
  }

  function loadSource(raw) {
    try {
      lesson = LessonModel.readSource(raw);
      get('settings').hidden = false;
      get('settings').open = false;
      get('timing-box').hidden = !lesson.advanceMs;
      get('use-timing').checked = true;
      get('timing-help').textContent = lesson.advanceMs ? '反馈显示 ' + lesson.advanceMs / 1000 + ' 秒后继续。' : '';
      prepareCover(lesson.coverUrl);
      renderPreview(lesson);
      checkPlan();
    } catch (error) {
      clearLesson();
      showStatus(error.message, 'error');
    }
  }

  async function loadFile(file) {
    if (!file || exportJob) return;
    const version = ++sourceVersion;
    clearLesson();
    get('file-label').textContent = file.name;
    get('file-info').textContent = '正在读取';
    try {
      if (!/\.html?$/i.test(file.name)) throw Error('请选择飞象老师导出的 .html 或 .htm 文件。');
      if (file.size > LessonModel.MAX_SOURCE) throw Error('请选择不超过 8 MB 的 HTML 文件。');
      const raw = await file.text();
      if (version !== sourceVersion) return;
      get('file-info').textContent = Math.max(1, Math.round(file.size / 1024)) + ' KB';
      loadSource(raw);
    } catch (error) {
      if (version !== sourceVersion) return;
      get('file-info').textContent = '请选择另一份文件';
      showStatus(error.message, 'error');
    }
  }

  function setBusy(active) {
    for (const id of ['demo', 'source', 'analyze', 'paste-tab', 'file-tab', 'browse', 'cover-file', 'use-timing']) {
      get(id).disabled = active;
    }
    get('export').disabled = active || !lesson;
    get('cancel').hidden = !active;
    get('progress-area').hidden = !active;
  }

  function setProgress(value, label) {
    get('progress').value = value;
    get('progress-number').textContent = value + '%';
    get('progress-label').textContent = label;
  }

  function finish(job, notice) {
    if (exportJob !== job) return;
    job.worker?.terminate();
    exportJob = null;
    setBusy(false);
    get('export-note').textContent = notice;
  }

  function download(bytes, mime, title) {
    const file = new Blob([bytes], { type: mime });
    const url = URL.createObjectURL(file);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = (title.replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ').trim().slice(0, 65) || '课堂互动闯关') + ' - 互动课件.pptx';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  async function exportLesson() {
    if (!lesson || exportJob) return;
    const job = { worker: null };
    exportJob = job;
    setBusy(true);
    setProgress(0, '准备生成');
    get('export-note').textContent = '正在浏览器内处理课件。';
    try {
      const data = activeLesson();
      const cover = await pendingCover;
      if (exportJob !== job) return;
      job.worker = new Worker('./export-worker.js');
      job.worker.addEventListener('message', ({ data: result }) => {
        if (exportJob !== job) return;
        if (result.type === 'progress') setProgress(result.value, result.label);
        if (result.type === 'error') finish(job, '导出失败。' + result.message);
        if (result.type === 'done') {
          download(result.bytes, result.mime, data.brand);
          finish(job, '已生成 PPT。下载完成后，从第一页开始放映。');
        }
      });
      job.worker.addEventListener('error', () =>
        finish(job, '导出程序未能载入。请刷新页面，或用新版 Edge / Chrome 重试。'));
      job.worker.postMessage({ lesson: data, cover });
    } catch (error) {
      finish(job, '导出失败。' + error.message);
    }
  }

  for (const [i, id] of tabIds.entries()) {
    const tab = get(id + '-tab');
    tab.addEventListener('click', () => chooseTab(id));
    tab.addEventListener('keydown', (event) => {
      if (['ArrowLeft', 'ArrowRight'].includes(event.key)) {
        event.preventDefault();
        chooseTab(tabIds[1 - i], true);
      }
    });
  }
  get('source').addEventListener('input', () => {
    sourceVersion++;
    if (lesson || !get('status').hidden) clearLesson();
  });
  get('analyze').addEventListener('click', () => {
    sourceVersion++;
    clearLesson();
    loadSource(get('source').value);
  });
  get('demo').addEventListener('click', () => {
    sourceVersion++;
    clearLesson();
    chooseTab('paste');
    get('source').value = SAMPLE;
    loadSource(SAMPLE);
  });
  get('browse').addEventListener('click', () => get('file').click());
  get('file').addEventListener('change', (event) => {
    const file = event.target.files[0];
    event.target.value = '';
    loadFile(file);
  });
  const drop = get('drop-area');
  drop.addEventListener('dragover', (event) => {
    event.preventDefault();
    if (!exportJob) drop.dataset.over = 'true';
  });
  drop.addEventListener('dragleave', () => { drop.dataset.over = 'false'; });
  drop.addEventListener('drop', (event) => {
    event.preventDefault();
    drop.dataset.over = 'false';
    loadFile(event.dataTransfer.files[0]);
  });
  get('cover-file').addEventListener('change', (event) => addCover(event.target.files[0]));
  get('use-timing').addEventListener('change', () => {
    if (!lesson) return;
    renderPreview(lesson);
    checkPlan();
  });
  get('export').addEventListener('click', exportLesson);
  get('cancel').addEventListener('click', () => {
    if (exportJob) finish(exportJob, '已取消。可以重新导出。');
  });
})();

