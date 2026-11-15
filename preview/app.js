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
  const tabIds = ['file', 'paste'];
  let lesson = null;
  let sourceVersion = 0;
  let coverVersion = 0;
  let replica = null;
  let replicaRaw = '';
  let classroom = Curriculum.normalize();
  let classroomDraft = null;
  let editableAvailable = false;
  let pendingOriginalCover = Promise.resolve(null);
  let pendingCover = Promise.resolve(null);
  let exportJob = null;
  let questionDraft = null;
  let previewIndex = 0;
  let shareVersion = 0;
  let shareGroups = [];
  let libraryId = '';
  let libraryTitle = '';
  let copyFrom = null;
  let joinBase = null;
  let joinVersion = 0;
  let wideCache = null;
  let trialController = null;
  let closeTrial = null;
  let checkController = null;

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
    setReplica(null);
    replicaRaw = '';
    classroom = Curriculum.normalize();
    editableAvailable = false;
    libraryId = libraryTitle = '';
    wideCache = null;
    pendingOriginalCover = Promise.resolve(null);
    pendingCover = Promise.resolve(null);
    get('cover-file').value = '';
    get('settings').hidden = true;
    get('preview-ready').hidden = true;
    get('preview-empty').hidden = false;
    get('download-zone').hidden = get('question-preview').hidden = get('classroom-tools').hidden = true;
    get('question-preview').open = get('classroom-tools').open = false;
    get('export').disabled = true;
    get('export-mode').hidden = true;
    get('export-mode').disabled = true;
    get('edit-classroom').disabled = true;
    get('edit-classroom').textContent = '添加课堂页';
    get('save-project').disabled = true;
    get('share-activity').disabled = true;
    get('export-note').textContent = '';
    showStatus();
  }

  function setReplica(value) {
    replica = value;
    get('export-replica').hidden = get('replica-note').hidden = !value;
    get('export').hidden = value?.kind === 'scenario';
    get('edit-questions').hidden = value?.kind === 'scenario';
    get('share-activity').hidden = Boolean(globalThis.FeixiangOffline) || value?.kind === 'scenario';
    get('export').textContent = value ? '下载可编辑版' : '下载互动 PPT';
    get('export').classList.toggle('primary', !value);
    get('export').classList.toggle('secondary', !!value);
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
    get('lesson-name').textContent = data.brand;
    const facts = replica?.kind === 'scenario' ? ['双视角选择', '四卡排序', '16:9'] : [data.levelCount + ' 关', data.qs.length + ' 题'];
    if (data.scored && !isLight()) facts.push('累计计分');
    if (data.qs.some((question) => question.emotion !== null)) facts.push('情绪强度');
    if (data.advanceMs && get('use-timing').checked && !get('coach').checked) facts.push(data.advanceMs / 1000 + ' 秒翻页');
    if (get('coach').checked) facts.push('讨论节奏由老师控制');
    get('facts').replaceChildren(...facts.map((fact) => element('span', fact)));
    renderCompatibility();
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
        const points = data.scored && !isLight() && option.points !== null
          ? ' · ' + (option.points > 0 ? '+' : '') + option.points + ' 分' : '';
        feedback.textContent = result + points;
        feedback.hidden = false;
      });
      choices.append(button);
    }
    get('preview-question').replaceChildren(element('h3', q.title), choices, feedback);
    if (q.type !== 'choice') get('preview-question').append(
      element('p', ClassroomProject.TYPES[q.type] + ' · ' + q.items.length + ' 组材料，可打开网页试玩。', 'muted'));
  }

  function isLight() {
    return get('export-mode').querySelector('[value="light"]').checked;
  }

  function renderCompatibility() {
    const detail = get('compatibility');
    const mode = get('mode-note');
    if (replica?.kind === 'scenario') {
      detail.replaceChildren(
        element('p', '保留两个角色的选择、三条刻度动画、四张卡片排序、复盘与重试。'),
        element('p', '选择后由老师决定何时继续。' + replica.source.cosmetics, 'muted'),
      );
      mode.textContent = isLight() ? '保留玩法和反馈，省去观察点计数。' : '显示本轮观察点和复盘反馈。';
      return;
    }
    if (replica?.kind === 'emotion') {
      detail.replaceChildren(
        element('p', '保留情绪强度点选、答题反馈、提示动画和 16:9 版式。'),
        element('p', (get('use-timing').checked && !get('coach').checked ? '沿用原课件的自动翻页。' : '答题后由老师点按钮继续。') +
          '网页悬停效果留在原网页。', 'muted'),
      );
    } else {
      const types = [...new Set(lesson.qs.map(q => ClassroomProject.TYPES[q.type]))].join('、');
      const supported = lesson.branching ? types + '、反馈和已识别的分支' : types + '和反馈';
      detail.replaceChildren(
        element('p', '可导出 ' + supported + '。'),
        element('p', '使用可编辑的 PPT 版式。未识别的网页特效留在原网页。', 'muted'),
      );
    }
    mode.textContent = isLight()
      ? '保留点选和反馈，省去累计积分与等级结算。'
      : '保留课件已识别的累计积分和结算规则。';
  }

  function updateClassroomLabel() {
    const count = classroom.before.length + classroom.after.length;
    get('edit-classroom').textContent = count ? '编辑课堂页（' + count + '）' : '添加课堂页';
  }

  function renderClassroomEditor() {
    const root = get('classroom-fields');
    root.replaceChildren();
    for (const [phase, label] of [['before', '互动开始前'], ['after', '互动结束后']]) {
      const group = element('section', '', 'classroom-section');
      group.append(element('h3', label));
      const pages = classroomDraft[phase];
      for (const [index, page] of pages.entries()) {
        const block = document.createElement('fieldset');
        block.append(element('legend', '第 ' + (index + 1) + ' 页'));
        for (const [key, label, max] of [['title', '页面标题', 48], ['body', '正文', 270]]) {
          const row = element('label', label, 'editor-field');
          const input = document.createElement(key === 'body' ? 'textarea' : 'input');
          input.value = page[key];
          input.maxLength = max;
          input.addEventListener('input', () => { page[key] = input.value; });
          row.append(input);
          block.append(row);
        }
        addEditorButton(block, '移除此页', () => {
          pages.splice(index, 1);
          renderClassroomEditor();
        });
        group.append(block);
      }
      if (pages.length < Curriculum.MAX_PAGES_PER_SECTION) {
        addEditorButton(group, phase === 'before' ? '添加导入页' : '添加讨论或总结页', () => {
          pages.push({ title: '', body: '' });
          renderClassroomEditor();
          root.querySelectorAll('.classroom-section')[phase === 'before' ? 0 : 1]
            .querySelector('fieldset:last-of-type input')?.focus();
        });
      }
      root.append(group);
    }
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
    field(fields, '关卡名称', question, 'level', 64);
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
      const points = get('project-scoring').checked ? 0 : null;
      question.options.push({ text: '', result: '', tip: '', heading: '', correct: null, points, next: '' });
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
    redrawEditor(Math.min(previewIndex, lesson.qs.length - 1));
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
    const keptReplica = Boolean(replica) && lesson.scored && lesson.countsCorrect && !lesson.branching &&
      lesson.qs.every(q => q.type === 'choice' && q.emotion !== null && q.options.every(o => o.points >= 0));
    if (!keptReplica) {
      setReplica(null);
      replicaRaw = '';
    }
    get('export-mode').hidden = get('export-mode').disabled = !lesson.scored;
    if (!lesson.scored) get('export-mode').querySelector('[value="full"]').checked = true;
    renderPreview(lesson);
    checkPlan();
    if (!get('export').disabled) showStatus('已应用修改，导出的答题路线会一起更新。');
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
      pendingOriginalCover = Promise.resolve(null);
      pendingCover = Promise.resolve(null);
      notice.textContent = value ? '这个封面地址无法直接读取，可另选本地图片。' : '没有封面插图，可按需选择一张。';
      return;
    }
    notice.textContent = '正在读取原课件的封面。';
    pendingOriginalCover = (remote ? loadImageBlob(remote) : Promise.resolve(embedded)).catch(() => null);
    pendingCover = pendingOriginalCover.then((image) => {
      if (!image) throw Error('封面图片不可用。');
      return coverData(image);
    })
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
    pendingOriginalCover = Promise.resolve(file);
    pendingCover = coverData(file).then((data) => {
      if (version === coverVersion) get('cover-state').textContent = '已选用本地封面。';
      return data;
    }).catch(() => {
      if (version === coverVersion) get('cover-state').textContent = '无法读取这张图片，请重新选择。';
      return null;
    });
  }

  function settingsFromForm() {
    return { mode: isLight() ? 'light' : 'full', auto: get('use-timing').checked, coach: get('coach').checked };
  }

  function activeLesson(native = true, manual = false) {
    const { auto, coach } = settingsFromForm();
    const data = { ...lesson, coach: native && coach, advanceMs: auto && !coach && !manual ? lesson.advanceMs : 0 };
    return isLight() ? Curriculum.lightLesson(data) : data;
  }

  function checkPlan() {
    try {
      LessonPptx.plan(ClassroomProject.preparePpt(activeLesson()));
      get('export').disabled = false;
      editableAvailable = true;
      get('export-replica').disabled = !replica;
      showStatus('已识别 ' + lesson.levelCount + ' 关、' + lesson.qs.length + ' 题。');
    } catch (error) {
      editableAvailable = false;
      get('export').disabled = true;
      get('export-replica').disabled = !replica;
      get('settings').open = true;
      showStatus(error.message, 'error');
    }
    refreshTools();
  }

  function loadSource(raw) {
    try {
      if (raw.length <= LessonModel.MAX_SOURCE && raw.includes('orderItems') && raw.includes('feedbackMarkup')) {
        const source = ScenarioActivity.read(raw);
        if (source) {
          loadLesson(ClassroomProject.normalize(ScenarioActivity.fallbackLesson(source)), { kind: 'scenario', source }, raw);
          return;
        }
      }
      const data = ClassroomProject.normalize(LessonModel.readSource(raw));
      const source = LessonReplica.read(raw, data);
      loadLesson(data, source ? { kind: 'emotion', source } : null, source ? raw : '');
    } catch (error) {
      clearLesson();
      showStatus(error.message, 'error');
    }
  }

  function loadLesson(data, original = null, raw = '', settings = TeacherTools.preferences()) {
    lesson = data;
    classroom = Curriculum.normalize(settings.pages);
    replicaRaw = raw;
    setReplica(original);
    get('settings').hidden = false;
    get('settings').open = false;
    get('timing-box').hidden = !lesson.advanceMs;
    get('use-timing').checked = settings.auto !== false;
    get('coach').checked = settings.coach === true;
    get('timing-help').textContent = lesson.advanceMs ? '自动时，反馈显示 ' + lesson.advanceMs / 1000 + ' 秒后继续。取消勾选可留出讨论时间。' : '';
    get('export-mode').querySelector('[value="' + (settings.mode === 'light' ? 'light' : 'full') + '"]').checked = true;
    get('export-mode').hidden = get('export-mode').disabled = !lesson.scored && original?.kind !== 'scenario';
    get('edit-classroom').disabled = false;
    updateClassroomLabel();
    get('save-project').disabled = false;
    get('share-activity').disabled = false;
    get('download-zone').hidden = get('question-preview').hidden = get('classroom-tools').hidden = false;
    prepareCover(lesson.coverUrl);
    renderPreview(lesson);
    if (original?.kind === 'scenario') {
      get('export-replica').disabled = false;
      showStatus('已识别双视角活动，包含两轮情境与一次排序。');
    } else {
      checkPlan();
    }
    refreshTools();
  }

  async function loadProject(file, localItem = null) {
    if (!file || exportJob) return;
    const version = ++sourceVersion;
    try {
      if (file.size > ClassroomProject.MAX_FILE) throw Error('课件项目文件过大。');
      const { lesson: project, payload } = ClassroomProject.readProject(await file.text());
      if (version !== sourceVersion) return;
      const settings = Curriculum.readProject(payload) ?? {};
      const source = settings.source;
      let original = null;
      if (source) {
        const scenario = source.includes('orderItems') && source.includes('feedbackMarkup') && ScenarioActivity.read(source);
        const emotion = !scenario && LessonReplica.read(source, ClassroomProject.normalize(LessonModel.readSource(source)));
        if (scenario) original = { kind: 'scenario', source: scenario };
        else if (emotion) original = { kind: 'emotion', source: emotion };
      }
      clearLesson();
      get('source').value = '';
      loadLesson(project, original, original ? source : '', settings);
      if (localItem) {
        libraryId = localItem.id;
        libraryTitle = localItem.title;
      }
      if (original || !get('export').disabled) showStatus('已打开课件项目，可继续编辑或导出。');
    } catch (error) {
      if (version === sourceVersion) showStatus(error.message, 'error');
    }
  }

  async function projectBytes() {
    if (!lesson) return;
    const data = lesson;
    const settings = { pages: classroom, ...settingsFromForm() };
    const raw = replicaRaw;
    const original = replica;
    const originalCover = pendingOriginalCover;
    const version = coverVersion;
    const cover = await pendingCover;
    if (data !== lesson || version !== coverVersion) return;
    let savedCover = cover;
    if (original?.kind === 'emotion' && raw && raw.length <= 1500000) {
      const sourceCover = await originalCover;
      if (data !== lesson) return;
      if (typeof sourceCover === 'string') savedCover = sourceCover;
      else if (sourceCover) {
        savedCover = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(sourceCover);
        });
      }
    }
    if (data !== lesson || version !== coverVersion) return;
    const preservesSource = raw && raw.length <= 1500000;
    let localSource = '';
    if (preservesSource) {
      const template = document.createElement('template');
      template.innerHTML = raw;
      template.content.querySelectorAll('script[src], #fx-resource-config, [data-fx-resource-runtime], iframe')
        .forEach(item => item.remove());
      localSource = template.innerHTML;
    }
    return { title: data.title, content: ClassroomProject.pack(data, savedCover, { ...settings, source: localSource }),
      missingWideSource: raw && !preservesSource };
  }

  async function saveProject() {
    try {
      const saved = await projectBytes();
      if (!saved) return;
      download(saved.content, 'application/json', saved.title, ' - 课件项目.json');
      showStatus(saved.missingWideSource
        ? '课件项目已下载。源 HTML 较大，如需再次导出宽屏版，请保留原 HTML。'
        : '课件项目已下载。下次点「打开课件项目」继续备课。');
    } catch (error) {
      showStatus(error.message || '课件项目未能保存。', 'error');
    }
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
      const context = index === 0 ? {} : {
        intro: '', rules: [], methods: [], tips: [], rank: [], endTitle: '活动完成', endCopy: '',
      };
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
    for (const id of ['demo', 'source', 'analyze', 'paste-tab', 'file-tab', 'browse', 'cover-file', 'use-timing',
      'edit-questions', 'new-project', 'open-project', 'open-recent', 'coach', 'save-recent', 'print-lesson']) {
      get(id).disabled = active;
    }
    get('export').disabled = active || !editableAvailable;
    get('export-replica').disabled = active || !replica;
    get('export-mode').disabled = active || get('export-mode').hidden;
    get('edit-classroom').disabled = active || !lesson;
    get('save-project').disabled = active || !lesson;
    get('share-activity').disabled = active || !lesson;
    get('cancel').hidden = !active;
    get('progress-area').hidden = !active;
    refreshTools();
  }

  function setProgress(value, label) {
    get('progress').value = value;
    get('progress-number').textContent = value + '%';
    get('progress-label').textContent = label;
  }

  function finish(job, notice) {
    if (exportJob !== job) return;
    job.abort?.abort();
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

  function refreshTools() {
    const available = Boolean(lesson && !exportJob && (replica || editableAvailable));
    for (const id of ['try-ppt', 'inspect-ppt', 'join-ppt']) get(id).disabled = !available;
    get('use-timing').disabled = Boolean(exportJob || get('coach').checked);
    get('coach-hint').textContent = (replica
      ? '宽屏版改为手动继续。'
      : '') + (replica?.kind === 'scenario' ? '' : '可编辑版的选择题会先停在讨论页，可给提示、重做或直接进小结。');
    for (const id of ['trial-variant', 'inspect-variant', 'join-variant']) {
      const select = get(id);
      select.options[0].disabled = !editableAvailable || replica?.kind === 'scenario';
      select.options[1].disabled = !replica;
      if (select.selectedOptions[0]?.disabled) select.value = replica ? 'wide' : 'native';
    }
  }

  function variant() {
    return replica ? 'wide' : 'native';
  }

  async function preparePpt(kind, progress, signal, joining = false) {
    const data = activeLesson(kind === 'native', joining);
    const pages = joining ? Curriculum.forJoining(classroom) : classroom;
    if (kind === 'native') {
      const cover = await pendingCover;
      signal.throwIfAborted();
      return { lesson: { ...ClassroomProject.preparePpt(data), classroom: pages }, cover };
    }
    const original = replica;
    if (!original) throw Error('这份课件没有宽屏还原版。');
    const key = { lesson, original, classroom, coverVersion, light: isLight(), ms: data.advanceMs };
    if (!joining && wideCache && Object.keys(key).every(name => wideCache.key[name] === key[name])) return wideCache.plan;
    const cover = original.kind === 'emotion' ? await pendingOriginalCover : null;
    signal.throwIfAborted();
    const config = { ...pages, light: key.light };
    const plan = original.kind === 'scenario'
      ? await ScenarioActivity.render(original.source, config, progress, signal)
      : await LessonReplica.render(original.source, data, cover, progress, signal, config);
    signal.throwIfAborted();
    if (!joining) wideCache = { key, plan };
    return plan;
  }

  function workerResult(job, kind, input) {
    return new Promise((resolve, reject) => {
      const url = kind === 'wide' ? './replica-worker.js?v=9' : './export-worker.js?v=9';
      job.worker = globalThis.FeixiangOffline?.worker(kind) ?? new Worker(url);
      job.abort.signal.addEventListener('abort', () => reject(job.abort.signal.reason), { once: true });
      job.worker.onmessage = ({ data: result }) => {
        if (exportJob !== job) return;
        if (result.type === 'progress') setProgress(result.value, result.label);
        if (result.type === 'error') reject(Error(result.message));
        if (result.type === 'done') resolve(result);
      };
      job.worker.onerror = () => reject(Error('导出程序未能载入。请刷新页面，或用新版 Edge / Chrome 重试。'));
      if (kind === 'wide' && wideCache?.plan !== input) job.worker.postMessage(input, input.media);
      else job.worker.postMessage(input);
    });
  }

  async function exportPpt(kind, join = null) {
    if (!lesson || exportJob) return;
    const job = { abort: new AbortController() };
    const brand = lesson.brand;
    const title = lesson.title;
    const light = isLight();
    exportJob = job;
    setBusy(true);
    setProgress(0, kind === 'wide' ? '准备 16:9 宽屏画面' : '准备生成');
    get('export-note').textContent = '正在浏览器内处理课件。';
    try {
      const input = await preparePpt(kind, setProgress, job.abort.signal, Boolean(join));
      const result = await workerResult(job, kind, input);
      if (exportJob !== job) return;
      if (join) {
        setProgress(96, '正在连接原课件的入口和返回页');
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        if (exportJob !== job) return;
        const bytes = PptxComposer.merge(join.base, result.bytes, join.entry, join.back, join.position);
        download(bytes, result.mime, join.name, ' - 插入互动.pptx');
        finish(job, '已生成合并课件。放映至第 ' + (join.entry + 1) + ' 页，点「进入互动」。');
      } else if (kind === 'wide') {
        download(result.bytes, result.mime, title, light ? ' - 16比9轻量讨论版.pptx' : ' - 16比9宽屏互动版.pptx');
        finish(job, '宽屏版已生成。用桌面 WPS 或 PowerPoint 从第一页放映，即可点选答题。');
      } else {
        download(result.bytes, result.mime, brand);
        finish(job, '已生成 PPT。下载完成后，从第一页开始放映。');
      }
    } catch (error) {
      finish(job, '导出失败。' + error.message);
    }
  }

  async function buildTrial(kind, progress, signal) {
    const plan = await preparePpt(kind, progress, signal);
    const pages = kind === 'wide' ? PptxTrial.wide(plan) : PptxTrial.native(LessonPptx.describe(plan.lesson, plan.cover));
    return { plan, pages };
  }

  async function openTrial() {
    const kind = get('trial-variant').value;
    trialController?.abort();
    closeTrial?.();
    closeTrial = null;
    const controller = new AbortController();
    trialController = controller;
    const status = get('trial-status');
    get('trial-cover').hidden = true;
    status.textContent = '正在准备试放画面…';
    try {
      const { plan, pages } = await buildTrial(kind, (value, message) => {
        status.textContent = message + ' · ' + value + '%';
      }, controller.signal);
      if (controller.signal.aborted) return;
      closeTrial = PptxTrial.mount(pages, plan, kind === 'wide' ? '宽屏还原版' : '可编辑版');
    } catch (error) {
      if (!controller.signal.aborted) {
        status.textContent = error.message;
        get('trial-cover').hidden = !needsCover(error);
      }
    }
  }

  function needsCover(error) {
    return /原封面|封面图片/.test(error.message);
  }

  function openCoverSettings(id) {
    get(id).close();
    get('settings').open = true;
    get('cover-file').focus();
  }

  function action(label, callback) {
    const control = element('button', label, 'button secondary small');
    control.type = 'button';
    control.addEventListener('click', callback);
    return control;
  }

  function checkRow(title, detail, level, control) {
    const row = element('section', '', 'check-row');
    row.dataset.level = level;
    row.append(element('h3', title));
    if (detail) row.append(element('p', detail, 'muted'));
    if (control) row.append(control);
    return row;
  }

  async function inspectPpt() {
    checkController?.abort();
    const kind = get('inspect-variant').value;
    const status = get('inspect-status');
    const rows = get('inspect-items');
    const button = get('download-checked');
    button.disabled = true;
    rows.replaceChildren();
    status.textContent = '正在检查 16:9 页面、答题跳转和封面素材…';
    const controller = new AbortController();
    checkController = controller;
    try {
      const { pages, plan } = await buildTrial(kind, (value, label) => {
        status.textContent = label + ' · ' + value + '%';
      }, controller.signal);
      const cover = await pendingCover;
      if (controller.signal.aborted) return;
      const result = PptxTrial.inspect(pages, plan.media?.length ?? 0);
      const issues = [];
      if (!cover && lesson.coverUrl) {
        issues.push(checkRow('原封面读取失败', '可选择本地图片，再重新检查。', 'warning',
          action('更换封面', () => openCoverSettings('inspect-dialog'))));
      }
      if (kind === 'native') for (const [index, q] of lesson.qs.entries()) {
        const blanks = q.options?.filter(option => !option.result && !option.tip && option.correct == null).length;
        if (q.type !== 'choice') {
          issues.push(checkRow('第 ' + (index + 1) + ' 题 · ' + ClassroomProject.TYPES[q.type],
            'WPS 中用逐步点选完成。', 'ok', action('查看题目', () => {
              get('inspect-dialog').close();
              previewIndex = index;
              openEditor();
            })));
        } else if (blanks) {
          issues.push(checkRow('第 ' + (index + 1) + ' 题 · ' + q.title, blanks + ' 个选项只有默认反馈。', 'warning',
            action('补充反馈', () => {
              get('inspect-dialog').close();
              previewIndex = index;
              openEditor();
            })));
        }
      }
      if (replica?.kind === 'scenario') {
        issues.push(checkRow('排序活动', '原网页的拖动手势改为在 PPT 中依次点选卡片。', 'ok'));
      } else if (kind === 'wide') {
        issues.push(checkRow('情绪强度点选', '保留数字按钮和答题反馈。网页的悬停效果只在网页里显示。', 'ok'));
      }
      const missing = result.broken.length;
      const invalid = missing || !result.canFinish;
      rows.append(checkRow('16:9 · ' + result.pageCount + ' 个画面', '共检查 ' + result.linkCount + ' 条按钮跳转' +
        (result.mediaCount ? '、' + result.mediaCount + ' 个画面图层。' : '。'),
        invalid ? 'error' : 'ok'), ...issues);
      if (missing) {
        rows.append(checkRow('有 ' + missing + ' 个画面需要检查', '画面编号 ' + result.broken.slice(0, 12).join('、'), 'error'));
      }
      const ending = result.canFinish ? '可从开头走到活动收束。' : '从活动开头无法到达收束页。';
      rows.append(checkRow('活动收束', ending, result.canFinish ? 'ok' : 'error'));
      status.textContent = (kind === 'wide' ? '宽屏还原版' : '可编辑版') + (invalid ? ' · 发现不可用的画面资源或跳转' : ' · 页面和按钮跳转检查通过');
      button.disabled = Boolean(invalid);
      button.onclick = () => {
        get('inspect-dialog').close();
        exportPpt(kind);
      };
    } catch (error) {
      if (!controller.signal.aborted) {
        status.textContent = error.message;
        if (needsCover(error)) rows.append(checkRow('缺少宽屏版封面', '选择本地图片后可继续。', 'warning',
          action('更换封面', () => openCoverSettings('inspect-dialog'))));
      }
    }
  }

  async function showLibrary() {
    const status = get('recent-status');
    const list = get('recent-items');
    list.replaceChildren();
    get('recent-copy').hidden = true;
    copyFrom = null;
    status.textContent = '';
    if (!get('recent-dialog').open) get('recent-dialog').showModal();
    try {
      const entries = await TeacherTools.list();
      if (!entries.length) status.textContent = '还没有保存的课件。打开课件后，点「存到最近课件」。';
      for (const entry of entries) {
        const row = checkRow(entry.title, new Date(entry.savedAt).toLocaleString('zh-CN'), 'ok');
        const controls = element('div', '', 'project-actions');
        controls.append(
          action('打开', () => {
            get('recent-dialog').close();
            loadProject(new Blob([entry.content]), entry);
          }),
          action('另存班级副本', () => {
            copyFrom = entry;
            get('recent-copy').hidden = false;
            get('copy-name').value = entry.title.slice(0, 56) + ' - 班级副本';
            get('copy-name').focus();
            get('copy-name').select();
          }),
          action('从最近课件移除', async () => {
            try {
              await TeacherTools.remove(entry.id);
              if (libraryId === entry.id) libraryId = libraryTitle = '';
              showLibrary();
            } catch (error) {
              status.textContent = '无法移除课件。' + error.message;
            }
          }),
        );
        row.append(controls);
        list.append(row);
      }
    } catch {
      status.textContent = '当前浏览器无法使用本机课件库。可改用「下载项目文件」。';
    }
  }

  async function saveRecent() {
    const button = get('save-recent');
    button.disabled = true;
    const current = lesson;
    const title = libraryTitle;
    const id = libraryId;
    try {
      const result = await projectBytes();
      if (!result) return;
      const item = await TeacherTools.save(title || result.title, result.content, id);
      if (current !== lesson) return;
      libraryId = item.id;
      if (result.missingWideSource) {
        showStatus('项目已存到本机。源 HTML 较大，宽屏版需从原 HTML 重新导入。');
      } else showStatus('已存到最近课件。可以打开最近课件另存班级副本。');
    } catch {
      showStatus('无法存到当前浏览器。可用「下载项目文件」保留课件。', 'error');
    } finally {
      button.disabled = Boolean(exportJob);
    }
  }

  function reflectSettings() {
    if (!lesson) return;
    TeacherTools.preferences(settingsFromForm());
    renderPreview(lesson);
    if (replica?.kind !== 'scenario') checkPlan();
    refreshTools();
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
    get('try-ppt').focus();
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
  get('edit-classroom').addEventListener('click', () => {
    if (!lesson || exportJob) return;
    classroomDraft = structuredClone(classroom);
    renderClassroomEditor();
    get('classroom-editor').showModal();
  });
  get('classroom-cancel').addEventListener('click', () => get('classroom-editor').close());
  get('classroom-form').addEventListener('submit', event => {
    event.preventDefault();
    classroom = Curriculum.normalize(classroomDraft);
    updateClassroomLabel();
    get('classroom-editor').close();
  });
  get('export-mode').addEventListener('change', reflectSettings);
  get('use-timing').addEventListener('change', reflectSettings);
  get('coach').addEventListener('change', reflectSettings);
  get('export').addEventListener('click', () => exportPpt('native'));
  get('export-replica').addEventListener('click', () => exportPpt('wide'));
  get('cancel').addEventListener('click', () => {
    if (exportJob) finish(exportJob, '已取消。可以重新导出。');
  });
  for (const close of document.querySelectorAll('[data-close]')) {
    close.addEventListener('click', () => get(close.dataset.close).close());
  }
  get('try-ppt').addEventListener('click', () => {
    get('trial-variant').value = variant();
    get('trial-dialog').showModal();
    openTrial();
  });
  get('trial-variant').addEventListener('change', openTrial);
  get('trial-cover').addEventListener('click', () => openCoverSettings('trial-dialog'));
  get('trial-dialog').addEventListener('close', () => {
    trialController?.abort();
    closeTrial?.();
    closeTrial = null;
  });
  get('inspect-ppt').addEventListener('click', () => {
    get('inspect-variant').value = variant();
    get('inspect-dialog').showModal();
    inspectPpt();
  });
  get('inspect-variant').addEventListener('change', inspectPpt);
  get('inspect-dialog').addEventListener('close', () => checkController?.abort());
  get('open-recent').addEventListener('click', showLibrary);
  get('save-recent').addEventListener('click', saveRecent);
  get('recent-copy').addEventListener('submit', async event => {
    event.preventDefault();
    const title = get('copy-name').value.trim();
    if (!copyFrom || !title) return;
    const button = event.currentTarget.querySelector('button');
    button.disabled = true;
    try {
      await TeacherTools.save(title, copyFrom.content);
      await showLibrary();
      get('recent-status').textContent = '已创建「' + title + '」。';
    } catch {
      get('recent-status').textContent = '当前浏览器无法保存副本。';
    } finally {
      button.disabled = false;
    }
  });
  function showHandout() {
    if (!lesson) return;
    TeacherTools.drawHandout(lesson, get('handout'), get('handout-kind').value === 'teacher');
  }
  get('print-lesson').addEventListener('click', () => {
    get('handout-kind').value = 'student';
    showHandout();
    get('handout-dialog').showModal();
  });
  get('handout-kind').addEventListener('change', showHandout);
  get('print-sheet').addEventListener('click', () => window.print());
  get('join-ppt').addEventListener('click', () => {
    get('join-variant').value = variant();
    get('join-dialog').showModal();
  });
  get('join-dialog').addEventListener('close', () => {
    if (!exportJob) return;
    joinBase = null;
    get('join-file').value = '';
    get('join-submit').disabled = get('join-enter').disabled = get('join-return').disabled = true;
    get('join-status').hidden = true;
  });
  get('join-file').addEventListener('change', async event => {
    const version = ++joinVersion;
    const file = event.target.files[0];
    const enter = get('join-enter');
    const back = get('join-return');
    const status = get('join-status');
    joinBase = null;
    enter.disabled = back.disabled = get('join-submit').disabled = true;
    enter.replaceChildren();
    back.replaceChildren();
    status.hidden = !file;
    if (!file) return;
    status.dataset.state = '';
    status.textContent = '正在读取原课件的页码和标题…';
    try {
      const base = await PptxComposer.open(file);
      if (version !== joinVersion) return;
      joinBase = { base, name: file.name.replace(/\.pptx$/i, '') };
      for (const [index, name] of base.labels.entries()) {
        enter.append(new Option(name, index));
        back.append(new Option(name, index));
      }
      back.selectedIndex = Math.min(1, back.length - 1);
      enter.disabled = back.disabled = get('join-submit').disabled = false;
      status.textContent = '已读取 ' + base.labels.length + ' 页。';
    } catch (error) {
      if (version !== joinVersion) return;
      status.textContent = error.message;
      status.dataset.state = 'error';
    }
  });
  get('join-enter').addEventListener('change', event => {
    const back = get('join-return');
    back.selectedIndex = Math.min(Number(event.target.value) + 1, back.length - 1);
  });
  get('join-form').addEventListener('submit', event => {
    event.preventDefault();
    if (!joinBase) return;
    const options = { ...joinBase, entry: Number(get('join-enter').value), back: Number(get('join-return').value),
      position: get('join-position').value };
    get('join-dialog').close();
    exportPpt(get('join-variant').value, options);
  });
})();

