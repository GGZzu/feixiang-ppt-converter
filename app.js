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
  let questionDraft = null;
  let previewIndex = 0;
  let shareVersion = 0;
  let shareGroups = [];

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
    previewIndex = 0;
    coverVersion++;
    pendingCover = Promise.resolve(null);
    get('cover-file').value = '';
    get('settings').hidden = true;
    get('preview-ready').hidden = true;
    get('preview-empty').hidden = false;
    get('preview-desc').textContent = '导入后可试选一道题，确认反馈。';
    get('export').disabled = true;
    get('save-project').disabled = true;
    get('share-activity').disabled = true;
    get('export-note').textContent = '下载后请用课堂电脑上的演示软件从第一页试放。';
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
    const q = data.qs[previewIndex];
    get('preview-empty').hidden = true;
    preview.hidden = false;
    preview.style.setProperty('--source-canvas', '#' + data.c.canvas);
    get('preview-desc').textContent = '试选第 ' + (previewIndex + 1) + ' 题，查看对应反馈。';
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
    for (const [index, option] of (q.options ?? []).entries()) {
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
    if (q.type !== 'choice') get('preview-question').append(
      element('p', ClassroomProject.TYPES[q.type] + ' · ' + q.items.length + ' 组材料，可打开网页试玩。', 'muted'));
  }

  function redrawEditor(index) {
    const select = get('editor-select');
    select.replaceChildren(...questionDraft.map((question, i) => {
      const option = element('option', (i + 1) + '. ' + (question.title || ClassroomProject.TYPES[question.type]));
      option.value = String(i);
      return option;
    }));
    select.value = String(index);
    get('move-up').disabled = index === 0;
    get('move-down').disabled = index === questionDraft.length - 1;
    get('remove-question').disabled = questionDraft.length < 2;
    drawEditorFields();
  }

  function drawEditorFields() {
    const index = Number(get('editor-select').value);
    const question = questionDraft[index];
    const fields = get('editor-fields');
    function field(parent, label, object, key, limit, required = false) {
      const row = element('label', label, 'editor-field');
      const input = document.createElement(limit > 64 ? 'textarea' : 'input');
      input.value = object[key];
      input.maxLength = limit;
      input.required = required;
      input.addEventListener('input', () => {
        object[key] = input.value;
        get('editor-error').hidden = true;
      });
      row.append(input);
      parent.append(row);
    }
    fields.replaceChildren();
    field(fields, '题干', question, 'title', 64, true);
    field(fields, '情境说明', question, 'copy', 300);
    if (question.type !== 'choice') {
      const matching = question.type === 'match';
      fields.append(element('p', matching ? '同一行的两项互为配对答案。' : '按正确顺序填写材料。学生看到的是打乱后的顺序。', 'muted'));
      question.items.forEach((item, i) => {
        const group = document.createElement('fieldset');
        group.append(element('legend', '材料 ' + (i + 1)));
        if (matching) {
          field(group, '左侧', item, 'left', 100, true);
          field(group, '右侧', item, 'right', 100, true);
        } else {
          field(group, '内容', question.items, i, 100, true);
        }
        if (question.items.length > 2) addEditorButton(group, '删除材料 ' + (i + 1), () => {
          question.items.splice(i, 1);
          drawEditorFields();
        });
        fields.append(group);
      });
      if (question.items.length < 4) addEditorButton(fields, '添加材料', () => {
        question.items.push(matching ? { left: '', right: '' } : '');
        drawEditorFields();
      });
      field(fields, '完成后的反馈', question, 'feedback', 240);
      return;
    }
    for (const [i, option] of question.options.entries()) {
      const group = document.createElement('fieldset');
      group.append(element('legend', '选项 ' + String.fromCharCode(65 + i)));
      field(group, '选项文字', option, 'text', 180, true);
      field(group, '反馈', option, 'result', 240);
      field(group, '提示', option, 'tip', 180);
      const judgmentRow = element('label', '选择判定', 'editor-field');
      const judgment = document.createElement('select');
      judgment.setAttribute('aria-label', '选择判定');
      for (const [key, label] of [['', '不判定对错'], ['true', '正确或更合适'], ['false', '错误或需要再想一想']]) {
        const item = element('option', label);
        item.value = key;
        judgment.append(item);
      }
      judgment.value = option.correct === null ? '' : String(option.correct);
      judgment.addEventListener('change', () => { option.correct = judgment.value === '' ? null : judgment.value === 'true'; });
      judgmentRow.append(judgment);
      group.append(judgmentRow);
      if (get('project-scoring').checked) {
        const row = element('label', '分值', 'editor-field');
        const input = document.createElement('input');
        input.type = 'number';
        input.min = '-500';
        input.max = '500';
        input.step = '1';
        input.required = true;
        input.value = option.points ?? 0;
        input.addEventListener('input', () => {
          option.points = input.valueAsNumber;
          get('editor-error').hidden = true;
        });
        row.append(input);
        group.append(row);
      }
      const branchRow = element('label', '选择后前往', 'editor-field');
      const branch = document.createElement('select');
      branch.setAttribute('aria-label', '选择后前往');
      const destinations = [['', '按顺序继续'], ['end', '结束活动'], ...questionDraft.slice(index + 1)
        .map((item, offset) => [item.id, '第 ' + (index + offset + 2) + ' 题 · ' + (item.title || '未命名')])];
      if (option.next && !destinations.some(([id]) => id === option.next)) destinations.push([option.next, '原目标不在本题之后，请重新选择']);
      for (const [id, title] of destinations) {
        const item = element('option', title);
        item.value = id;
        branch.append(item);
      }
      branch.value = option.next;
      branch.addEventListener('change', () => { option.next = branch.value; });
      branchRow.append(branch);
      group.append(branchRow);
      if (question.options.length > 2) addEditorButton(group, '删除选项 ' + String.fromCharCode(65 + i), () => {
        question.options.splice(i, 1);
        drawEditorFields();
      });
      fields.append(group);
    }
    if (question.options.length < 4) addEditorButton(fields, '添加选项', () => {
      question.options.push({ text: '', result: '', tip: '', heading: '', correct: null, points: null, next: '' });
      drawEditorFields();
    });
  }

  function addEditorButton(parent, label, action) {
    const button = element('button', label, 'button secondary small editor-add');
    button.type = 'button';
    button.addEventListener('click', action);
    parent.append(button);
  }

  function openEditor() {
    if (!lesson || exportJob) return;
    questionDraft = structuredClone(lesson.qs);
    get('project-title').value = lesson.title;
    get('project-intro').value = lesson.intro;
    get('project-scoring').checked = lesson.scoringEnabled;
    get('editor-error').hidden = true;
    redrawEditor(previewIndex);
    get('question-editor').showModal();
  }

  function applyEditor(event) {
    event.preventDefault();
    const title = get('project-title').value.trim();
    const scoringEnabled = get('project-scoring').checked;
    try {
      if (scoringEnabled && !lesson.scoringEnabled) {
        for (const question of questionDraft) for (const option of question.options ?? []) {
          if (option.points === null) option.points = 0;
        }
      }
      lesson = ClassroomProject.normalize({
        ...lesson, title, brand: title === lesson.title ? lesson.brand : title,
        intro: get('project-intro').value, scoringEnabled, qs: questionDraft,
      });
    } catch (error) {
      const notice = get('editor-error');
      const number = /^第 (\d+) 题/.exec(error.message);
      if (number) redrawEditor(Number(number[1]) - 1);
      notice.textContent = error.message;
      notice.hidden = false;
      return;
    }
    previewIndex = Number(get('editor-select').value);
    get('question-editor').close();
    renderPreview(lesson);
    checkPlan();
    if (!get('export').disabled) showStatus('已应用修改，导出的所有答题路线会一起更新。');
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
      LessonPptx.plan(ClassroomProject.preparePpt(activeLesson()));
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
      loadLesson(ClassroomProject.normalize(LessonModel.readSource(raw)));
    } catch (error) {
      clearLesson();
      showStatus(error.message, 'error');
    }
  }

  function loadLesson(data) {
    lesson = data;
    get('settings').hidden = false;
    get('settings').open = false;
    get('timing-box').hidden = !lesson.advanceMs;
    get('use-timing').checked = true;
    get('timing-help').textContent = lesson.advanceMs ? '反馈显示 ' + lesson.advanceMs / 1000 + ' 秒后继续。' : '';
    get('save-project').disabled = false;
    get('share-activity').disabled = false;
    prepareCover(lesson.coverUrl);
    renderPreview(lesson);
    checkPlan();
  }

  async function loadProject(file) {
    if (!file || exportJob) return;
    const version = ++sourceVersion;
    try {
      if (file.size > ClassroomProject.MAX_FILE) throw Error('课件项目文件过大。');
      const project = ClassroomProject.unpack(await file.text());
      if (version !== sourceVersion) return;
      clearLesson();
      get('source').value = '';
      loadLesson(project);
      showStatus('已打开课件项目，可继续编辑或导出。');
    } catch (error) {
      if (version === sourceVersion) showStatus(error.message, 'error');
    }
  }

  async function saveProject() {
    if (!lesson) return;
    const data = activeLesson();
    const cover = await pendingCover;
    download(ClassroomProject.pack(data, cover), 'application/json', data.title, ' - 课件项目.json');
    showStatus('课件项目已下载。下次点「打开课件项目」继续备课。');
  }

  function drawQr(link) {
    const canvas = get('share-qr');
    canvas.hidden = true;
    if (typeof qrcode !== 'function') return false;
    try {
      const code = qrcode(0, 'L');
      code.addData(link, 'Byte');
      code.make();
      const cells = code.getModuleCount();
      const cell = Math.max(3, Math.floor(520 / (cells + 8)));
      canvas.width = canvas.height = (cells + 8) * cell;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#172b27';
      for (let row = 0; row < cells; row++) for (let col = 0; col < cells; col++) {
        if (code.isDark(row, col)) ctx.fillRect((col + 4) * cell, (row + 4) * cell, cell, cell);
      }
      canvas.hidden = false;
      return true;
    } catch { return false; }
  }

  function shareActivity() {
    if (!lesson) return;
    const groups = new Map();
    lesson.qs.forEach(q => {
      if (!groups.has(q.level)) groups.set(q.level, []);
      groups.get(q.level).push(q);
    });
    shareGroups = [{ label: '整份课件', qs: lesson.qs }];
    if (groups.size > 1) for (const [label, qs] of groups) shareGroups.push({ label, qs });
    if (lesson.qs.length > 1) lesson.qs.forEach((q, index) => shareGroups.push({
      label: '第 ' + (index + 1) + ' 题 · ' + q.title, qs: [q],
    }));
    get('share-scope').replaceChildren(...shareGroups.map((group, index) => {
      const option = element('option', group.label);
      option.value = String(index);
      return option;
    }));
    get('share-dialog').showModal();
    refreshShare();
  }

  async function refreshShare() {
    const version = ++shareVersion;
    const status = get('share-status');
    get('share-link').value = '';
    get('share-qr').hidden = true;
    get('play-link').hidden = true;
    get('copy-link').disabled = true;
    status.textContent = '正在生成活动链接…';
    try {
      const index = Number(get('share-scope').value);
      const group = shareGroups[index];
      const ids = new Set(group.qs.map(q => q.id));
      let outside = false;
      const qs = group.qs.map(q => q.type !== 'choice' ? q : {
        ...q, options: q.options.map(option => {
          if (!option.next || option.next === 'end' || ids.has(option.next)) return option;
          outside = true;
          return { ...option, next: 'end' };
        }),
      });
      const context = index === 0 ? {} : { intro: '', rules: [], methods: [], tips: [], endCopy: '' };
      const data = ClassroomProject.normalize({ ...activeLesson(), ...context, qs });
      const url = new URL(location.pathname, location.origin);
      url.hash = 'play=' + await ClassroomProject.webToken(data);
      if (version !== shareVersion) return;
      get('share-link').value = url.href;
      get('play-link').href = url.href;
      get('play-link').hidden = false;
      get('copy-link').disabled = false;
      status.textContent = (drawQr(url.href)
        ? '可投屏展示二维码，也可以复制链接。'
        : '内容太多，无法装进一个二维码。可复制链接，或选一关、一题生成二维码。')
        + (outside ? ' 超出分享范围的分支会在此结束。' : '');
    } catch (error) { if (version === shareVersion) status.textContent = error.message; }
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
    for (const id of ['demo', 'source', 'analyze', 'paste-tab', 'file-tab', 'browse', 'cover-file', 'use-timing', 'edit-questions', 'new-project', 'open-project']) {
      get(id).disabled = active;
    }
    get('export').disabled = active || !lesson;
    get('save-project').disabled = active || !lesson;
    get('share-activity').disabled = active || !lesson;
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

  function download(bytes, mime, title, suffix = ' - 互动课件.pptx') {
    const file = new Blob([bytes], { type: mime });
    const url = URL.createObjectURL(file);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = (title.replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ').trim().slice(0, 65) || '课堂互动闯关') + suffix;
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
      const data = ClassroomProject.preparePpt(activeLesson());
      const cover = await pendingCover;
      if (exportJob !== job) return;
      job.worker = new Worker('./export-worker.js?v=3');
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
  get('new-project').addEventListener('click', () => {
    sourceVersion++;
    clearLesson();
    get('source').value = '';
    loadLesson(ClassroomProject.newLesson());
    openEditor();
  });
  get('open-project').addEventListener('click', () => get('project-file').click());
  get('project-file').addEventListener('change', event => {
    const file = event.target.files[0];
    event.target.value = '';
    loadProject(file);
  });
  get('save-project').addEventListener('click', saveProject);
  get('share-activity').addEventListener('click', shareActivity);
  get('share-scope').addEventListener('change', refreshShare);
  get('share-close').addEventListener('click', () => get('share-dialog').close());
  get('copy-link').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(get('share-link').value);
      get('share-status').textContent = '活动链接已复制。';
    } catch {
      get('share-link').select();
      get('share-status').textContent = '已选中链接，可手动复制。';
    }
  });
  get('edit-questions').addEventListener('click', openEditor);
  get('editor-select').addEventListener('change', event => redrawEditor(Number(event.target.value)));
  get('project-scoring').addEventListener('change', drawEditorFields);
  for (const type of Object.keys(ClassroomProject.TYPES)) get('add-' + type).addEventListener('click', () => {
    if (questionDraft.length >= 24) {
      get('editor-error').textContent = '一份课件最多包含 24 道题。';
      get('editor-error').hidden = false;
      return;
    }
    const level = questionDraft[Number(get('editor-select').value)].level;
    questionDraft.push(ClassroomProject.blankQuestion(type, get('project-scoring').checked, level));
    redrawEditor(questionDraft.length - 1);
    get('editor-fields').querySelector('input')?.focus();
  });
  for (const [id, delta] of [['move-up', -1], ['move-down', 1]]) get(id).addEventListener('click', () => {
    const index = Number(get('editor-select').value);
    const target = index + delta;
    if (target < 0 || target >= questionDraft.length) return;
    questionDraft.splice(target, 0, questionDraft.splice(index, 1)[0]);
    redrawEditor(target);
  });
  get('remove-question').addEventListener('click', () => {
    if (questionDraft.length < 2) return;
    const index = Number(get('editor-select').value);
    const [removed] = questionDraft.splice(index, 1);
    let affected = false;
    for (const question of questionDraft) for (const option of question.options ?? []) {
      if (option.next !== removed.id) continue;
      option.next = '';
      affected = true;
    }
    redrawEditor(Math.min(index, questionDraft.length - 1));
    if (affected) {
      get('editor-error').textContent = '原先指向已删除题目的选项已改为按顺序继续。';
      get('editor-error').hidden = false;
    }
  });
  get('editor-cancel').addEventListener('click', () => get('question-editor').close());
  get('question-editor').addEventListener('close', () => { questionDraft = null; });
  get('question-form').addEventListener('submit', applyEditor);
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

