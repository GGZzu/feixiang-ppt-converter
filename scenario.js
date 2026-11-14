(function (global) {
  'use strict';

  const { WIDTH, HEIGHT } = Curriculum;
  const TYPE = '双视角选择与过程排序';
  const REQUIRED_FUNCTIONS = ['intro', 'scenario', 'feedbackMarkup', 'order', 'orderResult', 'done'];
  const COSMETIC = '网页上的悬停样式与飞象在线组件仅在原网页使用。';
  const PLAIN = value => typeof value === 'string' && value.trim() && !/[<>]/.test(value);
  const limit = (value, size) => PLAIN(value) && value.length <= size;
  const COLORS = {
    canvas: ['paper', 'F4F0E7'], surface: ['card', 'FBF9F4'], ink: ['ink', '24231F'],
    muted: ['muted', '716D63'], border: ['line', 'D9D2C5'], primary: ['sage', '68766A'],
    positive: ['sage', '68766A'], highlight: ['orange-soft', 'F4E5D9'],
    attention: ['orange', 'C66C3D'], 'success-soft': ['sage-soft', 'E7EBE4'], 'error-soft': ['orange-soft', 'F4E5D9'],
  };
  const SAFE_TAGS = new Set('header div main section article span p h1 h2 h3 b strong ol ul li i em br a button'.split(' '));
  const UNSAFE_CSS = /[\\<>\x00-\x08\x0b\x0e-\x1f]|@(?!(?:media|keyframes)\b)|(?:url|image-set|src|paint|element|image)\s*\(/i;
  const START = 'start';
  const REFERENCE_CSS = [
    'html,body {width:1920px;height:1080px;margin:0;overflow:hidden;}',
    'html {font-family:"Noto Serif SC","Songti SC",SimSun,"Microsoft YaHei",serif;}',
    '*,*::before,*::after {animation:none!important;transition:none!important;}',
    '.shell {width:1508px;max-width:none;padding:17px 35px 12px;zoom:1.27320955;}',
    '.top {padding:0 0 8px;font-size:14px;} .top-right {gap:15px;}',
    '.hero {padding:15px 0;align-items:center;gap:23px;}',
    '.hero h1 {font-size:55px;margin:6px 0;} .hero p {margin:5px 0 0;font-size:17px;}',
    '.hero-note {font-size:15px;} .workspace {min-height:500px;}',
    '.status {height:42px;} .stage {padding:21px 26px;min-height:460px;}',
    '.stage h2 {font-size:37px;margin:6px 0 9px;} .stage .lead {margin:9px 0;max-width:1050px;}',
    '.intro-grid {margin:24px 0;gap:16px;} .slide-intro .mini-card {padding:25px 20px;}',
    '.scenario-head {gap:16px;} .scene {margin:12px 0;padding:12px 16px;line-height:1.53;}',
    '.options {gap:7px;} .option {padding:8px 14px;line-height:1.38;align-items:center;}',
    '.option strong {font-size:17px;margin:0 0 3px;} .option span.desc {font-size:14px;}',
    '.feedback {margin-top:9px;padding:10px 15px;font-size:15px;line-height:1.42;}',
    '.meter-wrap {margin-top:8px;} .meter {padding:7px 12px;} .track {height:7px;margin-top:5px;}',
    '.footnote {font-size:12px;margin-top:9px;line-height:1.35;}',
    '.controls {margin-top:12px;} .primary,.secondary,.process button {min-height:42px;}',
    '.controls button:disabled {opacity:.45;cursor:default;}',
    '.process {margin:15px 0;} .sequence {margin:0;display:grid;gap:6px;min-height:54px;}',
    '.sequence li {margin-left:12px;} .summary-grid {margin:14px 0;} .callout {margin:12px 0;padding:13px 17px;}',
    '.teacher.open {display:block;border:0;padding:20px 26px;font-size:18px;} .teacher.open li {margin:8px 0;}',
    '.teacher .source {font-size:13px;}',
    '.classroom-continue {min-height:42px;padding:0 19px;border:1px solid var(--ink);border-radius:999px;',
    'background:var(--ink);color:#fff;font:700 14px "Microsoft YaHei",sans-serif;}',
    '.result-actions {display:flex;flex-wrap:wrap;gap:10px;}',
  ].join('\n');

  function read(raw) {
    const template = document.createElement('template');
    template.innerHTML = raw;
    const stage = template.content.querySelector('.workspace #stage.stage');
    const scripts = [...template.content.querySelectorAll('script:not([src])')].map(el => el.textContent);
    const code = scripts.find(text => /\b(?:const|let)\s+scenes\s*=/.test(text) && /\b(?:const|let)\s+orderItems\s*=/.test(text));
    const header = template.content.querySelector('.shell > .top');
    const hero = template.content.querySelector('.shell > .hero');
    const title = hero?.querySelector('h1')?.textContent.trim();
    if (!stage || !code) return null;
    if (!header || !title || !REQUIRED_FUNCTIONS.every(name => new RegExp('\\bfunction\\s+' + name + '\\s*\\(').test(code))) {
      throw Error('这份双视角活动有部分环节无法识别。请重新复制完整 HTML。');
    }

    const { scenes, orderItems } = LessonModel.literalVariables(code);
    const answers = /const\s+correct\s*=\s*\[([^\]]+)\]/.exec(code)?.[1].match(/['"][a-z][a-z0-9_-]*['"]/gi)
      ?.map(value => value.slice(1, -1));
    const hasReferences = Array.isArray(orderItems) && Array.isArray(answers) && answers.length === 4 &&
      new Set(answers).size === 4 && answers.every(id => orderItems.some(item => item?.id === id));
    if (!Array.isArray(scenes) || scenes.length !== 2 || !scenes.every(validScene) ||
        !Array.isArray(orderItems) || orderItems.length !== 4 || !orderItems.every(validItem) ||
        new Set(orderItems.map(item => item.id)).size !== 4 || !hasReferences) {
      throw Error('识别到了双视角排序活动，但情境、刻度或参考顺序不完整。请复制完整 HTML。');
    }
    const styles = [...template.content.querySelectorAll('style')].map(el => el.textContent.replace(/\/\*[\s\S]*?\*\//g, ''));
    const css = styles.find(value => value.includes('.meter-wrap') && value.includes('.summary-grid'));
    if (!css || css.length > 18000 || UNSAFE_CSS.test(css)) {
      throw Error('识别到了双视角排序活动，但无法读取它的内置页面样式。');
    }
    const color = Object.fromEntries(Object.entries(COLORS).map(([key, [source, fallback]]) => [
      key, new RegExp('--' + source + '\\s*:\\s*#([0-9a-f]{6})\\b', 'i').exec(css)?.[1] ?? fallback,
    ]));
    return {
      type: TYPE, title, css, color, scenes, orderItems, answers, cosmetics: COSMETIC,
      header: header.cloneNode(true),
      hero: hero.cloneNode(true),
      teacher: template.content.querySelector('#teacherPanel')?.cloneNode(true),
      footer: template.content.querySelector('.shell > .footnote')?.cloneNode(true),
      intro: readStaticStage(code, 'intro'),
      summary: readStaticStage(code, 'done'),
      orderIntro: templatePart(code, '<div class="kicker">最后一步', '<div class="sequence"'),
      discussion: recordFrom(templatePart(code, '<div class="mini-card"><h3>全班讨论', '<div class="controls">')),
      prompt: templatePart(code, '<div class="callout">', '<div class="mini-card"><h3>全班讨论')
        .trim().replace(/^<div class="callout">|<\/div>$/g, ''),
      orderResult: templatePart(code, '</b>｜一种', '</div>', 'function orderResult(').replace(/^<\/b>｜/, ''),
    };
  }

  function validScene(scene) {
    return limit(scene?.title, 64) && limit(scene?.scene, 300) && limit(scene?.tag, 45) &&
      Array.isArray(scene.choices) && scene.choices.length >= 2 && scene.choices.length <= 4 &&
      scene.choices.every(value => limit(value?.title, 140) && limit(value?.desc, 140) &&
        limit(value?.feedback, 240) && Array.isArray(value.meters) && value.meters.length === 3 &&
        value.meters.every(n => Number.isInteger(n) && n >= 0 && n <= 100));
  }

  function validItem(item) {
    return typeof item?.id === 'string' && /^[a-z][a-z0-9_-]{0,31}$/i.test(item.id) && limit(item.text, 100);
  }

  function templatePart(code, from, until, section = '') {
    const start = code.indexOf(from, section ? code.indexOf(section) : 0);
    const end = start >= 0 ? code.indexOf(until, start) : -1;
    if (end <= start) throw Error('无法读取双视角活动中的导入、排序说明或复盘。');
    return code.slice(start, end);
  }

  function recordFrom(html) {
    const template = document.createElement('template');
    template.innerHTML = html;
    return {
      title: template.content.querySelector('h3')?.textContent ?? '',
      copy: template.content.querySelector('p')?.textContent ?? template.content.textContent.trim(),
    };
  }

  function readStaticStage(code, name) {
    const modern = code.indexOf('function ' + name + '(');
    const marker = 'stage.innerHTML=' + String.fromCharCode(96);
    const begin = code.indexOf(marker, modern) + marker.length;
    const cutoff = name === 'intro' ? '<button class="primary" id="start"' : '<div class="controls">';
    if (modern < 0 || begin < marker.length || code.indexOf(cutoff, begin) < 0) {
      throw Error('无法读取活动的开场或收束内容。');
    }
    const raw = code.slice(begin, code.indexOf(cutoff, begin));
    if (name === 'intro' && /\$\{/.test(raw)) throw Error('活动开场依赖网页动态内容，无法按原布局导出。');
    if (name === 'intro') return raw;
    const array = raw.match(/\$\{(\[\[[\s\S]+?\]\])\.map\(x=>/)?.[1];
    const blocks = array && LessonModel.literalVariables('const blocks=' + array).blocks;
    if (!Array.isArray(blocks) || blocks.length !== 4 || !blocks.every(row =>
      Array.isArray(row) && row.length === 3 && row.every(value => limit(value, 90)))) {
      throw Error('无法读取复盘中的四个过程环节。');
    }
    return { header: raw.slice(0, raw.indexOf('<div class="summary-grid">')), blocks };
  }

  function fallbackLesson(source) {
    return {
      title: source.title, brand: source.title, intro: source.hero.querySelector('p')?.textContent ?? '',
      endTitle: '课堂收束', endCopy: source.discussion.copy, c: source.color, scoringEnabled: false,
      qs: [...source.scenes.map(item => ({
        title: item.title, copy: item.scene, level: item.tag,
        options: item.choices.map(value => ({ text: value.title, result: value.feedback, tip: value.desc })),
      })), {
        type: 'order', title: '逆反心理怎样可能形成？', level: '形成过程',
        items: source.answers.map(id => source.orderItems.find(item => item.id === id).text),
        feedback: source.orderResult,
      }],
    };
  }

  function copySafe(node, doc) {
    if (node.nodeType === Node.TEXT_NODE) return doc.createTextNode(node.textContent);
    if (node.namespaceURI !== 'http://www.w3.org/1999/xhtml' || !SAFE_TAGS.has(node.localName)) return null;
    if (node.localName === 'a') return doc.createTextNode(node.textContent);
    const item = doc.createElement(node.localName);
    for (const key of ['class', 'id']) {
      const value = node.getAttribute(key);
      if (value && /^[a-z0-9_ -]+$/i.test(value) && value.length <= 160) item.setAttribute(key, value);
    }
    for (const child of node.childNodes) {
      const cleanChild = copySafe(child, doc);
      if (cleanChild) item.append(cleanChild);
    }
    return item;
  }

  function appendSafeHTML(dest, html) {
    const doc = dest.ownerDocument;
    const template = doc.createElement('template');
    template.innerHTML = html;
    for (const node of template.content.childNodes) {
      const cleanNode = copySafe(node, doc);
      if (cleanNode) dest.append(cleanNode);
    }
  }

  function node(doc, tag, content, className) {
    const el = doc.createElement(tag);
    if (content) el.textContent = content;
    if (className) el.className = className;
    return el;
  }

  function makePlan(source, { light, after }) {
    const slides = new Map();
    function add(key, desc) {
      slides.set(key, desc);
      return key;
    }
    add(START, { kind: 'intro', title: source.title });
    add('teacher', { kind: 'teacher', title: '教师提示' });
    source.scenes.forEach((item, round) => {
      add('scene/' + round, { kind: 'scene', title: item.title, round });
      item.choices.forEach((_, index) => add('choice/' + round + '/' + index,
        { kind: 'choice', title: item.title + ' · 观察提示', round, index }));
    });
    function order(prefix) {
      add('order/' + prefix.join(','), { kind: 'order', title: '逆反心理怎样可能形成？', prefix });
      for (const item of source.orderItems) {
        if (!prefix.includes(item.id)) order([...prefix, item.id]);
      }
    }
    order([]);
    for (const [key, item] of slides) {
      if (item.kind !== 'order' || item.prefix.length !== source.orderItems.length) continue;
      const exact = item.prefix.join(',') === source.answers.join(',');
      add('checked/' + item.prefix.join(','), { ...item, kind: 'checked', exact });
    }
    for (const exact of light ? [false] : [false, true]) {
      add('done/' + exact, { kind: 'done', title: '课堂收束', exact });
    }
    function actions(key, item) {
      const result = [];
      const move = (id, target, name) => result.push({ id, target, name });
      switch (item.kind) {
        case 'intro':
          move('start', 'scene/0', '开始体验');
          break;
        case 'teacher':
          move('teacher-back', START, '回到导入');
          break;
        case 'scene':
          source.scenes[item.round].choices.forEach((_, i) =>
            move('choice-' + i, 'choice/' + item.round + '/' + i, '选择 ' + String.fromCharCode(65 + i)));
          break;
        case 'choice':
          move('retry', 'scene/' + item.round, '重新选择');
          move('next', item.round === 0 ? 'scene/1' : 'order/', item.round === 0 ? '切换角色' : '进入形成过程');
          break;
        case 'order':
          for (const candidate of source.orderItems) if (!item.prefix.includes(candidate.id)) {
            move('item-' + candidate.id, 'order/' + [...item.prefix, candidate.id].join(','), candidate.text);
          }
          if (item.prefix.length === source.orderItems.length) move('check', 'checked/' + item.prefix.join(','), '核对并复盘');
          move('clear', 'order/', '重新排序');
          break;
        case 'checked':
          move('clear', 'order/', '重新排序');
          move('wrap', 'done/' + (!light && item.exact), '进入课堂收束');
          break;
        case 'done':
          move('restart', START, '重新体验');
          if (after.length) move('classroom-continue', 'classroom', '继续上课');
          break;
      }
      if (key === START) move('teacherToggle', 'teacher', '教师提示');
      return result;
    }
    return { slides, actions };
  }

  function makeShell(doc, source) {
    const shell = node(doc, 'div', '', 'shell');
    const header = copySafe(source.header, doc);
    const hero = copySafe(source.hero, doc);
    const workspace = node(doc, 'main', '', 'workspace');
    const status = node(doc, 'div', '', 'status');
    const dots = node(doc, 'div', '', 'steps');
    for (let i = 0; i < 4; i++) dots.append(node(doc, 'i', '', 'dot'));
    const progress = node(doc, 'div', '', 'status-right');
    const phase = node(doc, 'span');
    const score = node(doc, 'span');
    progress.append(phase, score);
    status.append(dots, progress);
    const stage = node(doc, 'section', '', 'stage');
    workspace.append(status, stage);
    shell.append(header, hero, workspace);
    if (source.footer) shell.append(copySafe(source.footer, doc));
    doc.body.append(shell);
    return { shell, header, phase, score, stage, dots };
  }

  function draw(els, source, state, settings) {
    const { header, phase, score, stage, dots } = els;
    const doc = stage.ownerDocument;
    const { kind, round, prefix } = state;
    const level = kind === 'intro' || kind === 'teacher' ? 0 : kind === 'scene' || kind === 'choice' ? 1 : kind === 'done' ? 3 : 2;
    const labels = ['准备进入', '双视角体验 · ' + (round + 1) + '/2', '形成过程', '课堂收束'];
    const points = kind === 'choice' ? round + 1 : kind === 'scene' ? round : kind === 'order' ? 2 :
      kind === 'checked' || kind === 'done' ? (state.exact ? 4 : 3) : 0;
    phase.textContent = labels[level];
    score.hidden = settings.light;
    score.textContent = '观察点 ' + points;
    [...dots.children].forEach((dot, i) => dot.classList.toggle('active', i <= level));
    const teacher = header.querySelector('#teacherToggle');
    if (teacher) teacher.style.visibility = kind === 'intro' ? '' : 'hidden';
    stage.replaceChildren();
    stage.className = 'stage' + (kind === 'intro' ? ' slide-intro' :
      kind === 'order' || kind === 'checked' ? ' order-stage' : '');
    function button(id, label, type = 'primary', disabled = false) {
      const b = node(doc, 'button', label, type);
      b.id = id;
      b.disabled = disabled;
      return b;
    }
    function controls(...children) {
      const row = node(doc, 'div', '', 'controls');
      row.append(...children);
      stage.append(row);
    }
    if (kind === 'intro') {
      appendSafeHTML(stage, source.intro);
      stage.append(button('start', '开始体验'));
    } else if (kind === 'teacher') {
      if (source.teacher) {
        const panel = copySafe(source.teacher, doc);
        panel.classList.add('open');
        stage.append(panel);
      }
      controls(button('teacher-back', '回到导入'));
    } else if (kind === 'scene' || kind === 'choice') {
      const scene = source.scenes[round];
      const head = node(doc, 'div', '', 'scenario-head');
      const title = node(doc, 'div');
      title.append(node(doc, 'div', '情境 ' + (round + 1) + ' / ' + source.scenes.length, 'kicker'), node(doc, 'h2', scene.title));
      head.append(title, node(doc, 'span', scene.tag, 'role-tag'));
      const context = node(doc, 'div', '', 'scene');
      context.append(node(doc, 'small', '请读情境'), doc.createTextNode(scene.scene));
      const prompt = node(doc, 'p', '你更可能怎么想或怎么做？请选择最接近的一项；没有标准人格答案。', 'lead');
      prompt.style.fontSize = '15px';
      const choices = node(doc, 'div', '', 'options');
      scene.choices.forEach((option, i) => {
        const b = button('choice-' + i, '', 'option' + (state.index === i ? ' selected' : ''), kind === 'choice');
        const content = node(doc, 'span');
        content.append(node(doc, 'strong', option.title), node(doc, 'span', option.desc, 'desc'));
        b.append(node(doc, 'span', String.fromCharCode(65 + i), 'num'), content);
        choices.append(b);
      });
      stage.append(head, context, prompt, choices);
      if (kind === 'choice') {
        const option = scene.choices[state.index];
        const feedback = node(doc, 'div', '', 'feedback');
        const meters = node(doc, 'div', '', 'meter-wrap');
        ['好奇/注意', '受阻感', '逆反倾向'].forEach((label, i) => {
          const meter = node(doc, 'div', '', 'meter');
          const track = node(doc, 'div', '', 'track');
          const fill = node(doc, 'div', '', 'fill');
          fill.style.width = option.meters[i] + '%';
          track.append(fill);
          meter.append(node(doc, 'span', label + ' · 情境推演', 'meter-label'), track);
          meters.append(meter);
        });
        feedback.append(node(doc, 'b', '观察提示'), doc.createTextNode('｜' + option.feedback), meters,
          node(doc, 'div', '刻度只用于比较本情境中的讨论方向，不代表真实测量、概率或诊断结论。', 'footnote'));
        stage.append(feedback);
        controls(button('retry', '重新选择', 'secondary'), button('next', round === 0 ? '切换角色' : '进入形成过程'));
      }
    } else if (kind === 'order' || kind === 'checked') {
      appendSafeHTML(stage, source.orderIntro);
      const seq = node(doc, 'ol', '', 'sequence');
      seq.id = 'order-sequence';
      for (let index = 0; index < source.orderItems.length; index++) {
        const id = prefix[index];
        const text = id ? source.orderItems.find(item => item.id === id).text : index === 0 && !prefix.length
          ? '你排出的过程会显示在这里。' : '等待选择';
        seq.append(node(doc, 'li', text));
      }
      const process = node(doc, 'div', '', 'process');
      for (const item of source.orderItems) {
        const picked = prefix.includes(item.id);
        process.append(button('item-' + item.id, item.text, picked ? 'picked' : '', picked));
      }
      process.id = 'order-process';
      stage.append(seq, process);
      if (kind === 'checked') {
        const result = node(doc, 'div', '', 'feedback');
        result.append(node(doc, 'b', state.exact ? '过程抓得很准' : '核心环节已找到'), doc.createTextNode('｜' + source.orderResult));
        stage.append(result);
      }
      controls(button('clear', '重新排序', 'secondary'), kind === 'checked'
        ? button('wrap', '进入课堂收束') : button('check', '核对并复盘', 'primary', prefix.length !== 4));
    } else {
      appendSafeHTML(stage, source.summary.header);
      const summary = node(doc, 'div', '', 'summary-grid');
      for (const [step, title, copy] of source.summary.blocks) {
        const card = node(doc, 'div', '', 'summary-step');
        card.append(node(doc, 'em', step), node(doc, 'b', title), node(doc, 'span', copy));
        summary.append(card);
      }
      const discussion = node(doc, 'div', '', 'mini-card');
      discussion.append(node(doc, 'h3', source.discussion.title), node(doc, 'p', source.discussion.copy));
      const callout = node(doc, 'div', '', 'callout');
      appendSafeHTML(callout, source.prompt);
      stage.append(summary, callout, discussion);
      const actions = node(doc, 'div', '', 'result-actions');
      actions.append(button('restart', '重新体验', settings.after.length ? 'secondary' : 'primary'));
      if (settings.after.length) actions.append(Curriculum.button(doc));
      controls(node(doc, 'span', settings.light ? '观察与复盘已完成。' :
        '本次完成 ' + points + ' 次观察/复盘操作。分数只代表参与，不评价个体心理。', 'footnote'), actions);
    }
  }

  async function stageFrame() {
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-same-origin');
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    frame.style.cssText = 'position:absolute;left:-2200px;top:0;width:1920px;height:1080px;border:0;pointer-events:none;opacity:0;';
    frame.srcdoc = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">' +
      '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:"></head><body></body></html>';
    const ready = new Promise(resolve => frame.addEventListener('load', resolve, { once: true }));
    document.body.append(frame);
    await ready;
    if (!frame.contentDocument?.body) {
      frame.remove();
      throw Error('无法生成宽屏画面。请用新版 Edge 或 Chrome 重试。');
    }
    return frame;
  }

  function rect(el) {
    const r = el.getBoundingClientRect();
    const x = Math.floor(r.x);
    const y = Math.floor(r.y);
    return { x, y, w: Math.ceil(r.right) - x, h: Math.ceil(r.bottom) - y };
  }

  function fitShell(els, source, state, settings) {
    draw(els, source, state, settings);
    for (let percent = 127; percent >= 93; percent -= 2) {
      const zoom = percent / 100;
      els.shell.style.zoom = zoom;
      els.shell.style.width = Math.floor(WIDTH / zoom) + 'px';
      if (rect(els.shell).h <= HEIGHT - 12) return;
    }
    throw Error('「' + state.title + '」的内容超出了 16:9 画面。请缩短材料后重试。');
  }

  async function render(source, settings, progress, signal) {
    const { slides: mapping, actions } = makePlan(source, settings);
    if (signal?.aborted) signal.throwIfAborted();
    const frame = await stageFrame();
    try {
      const doc = frame.contentDocument;
      doc.head.append(node(doc, 'style', source.css + '\n' + REFERENCE_CSS + '\n' +
        '.meter-label {font:600 11px ui-sans-serif,system-ui,sans-serif;color:var(--muted);}' +
        '.stage.slide-intro {padding:24px 26px;} .order-stage .sequence li {min-height:17px;}'));
      const els = makeShell(doc, source);
      await doc.fonts.ready;
      const ids = new Map([...mapping.keys()].map((key, i) => [key, i + 1]));
      const media = [];
      const slides = [];
      const img = new Image();
      const serializer = new XMLSerializer();
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { alpha: false });
      const whole = { x: 0, y: 0, w: WIDTH, h: HEIGHT };
      async function snapshot() {
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080">' +
          '<foreignObject width="1920" height="1080">' + serializer.serializeToString(doc.documentElement) +
          '</foreignObject></svg>';
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
        await img.decode();
        signal?.throwIfAborted();
      }
      const cached = new Map();
      async function layer(bounds, key) {
        if (key && cached.has(key)) return cached.get(key);
        canvas.width = bounds.w;
        canvas.height = bounds.h;
        ctx.drawImage(img, bounds.x, bounds.y, bounds.w, bounds.h, 0, 0, bounds.w, bounds.h);
        const png = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        if (!png) throw Error('没有生成课件画面。');
        const result = { ...bounds, image: media.push(await png.arrayBuffer()) };
        if (key) cached.set(key, result);
        return result;
      }
      for (const [key, state] of mapping) {
        signal?.throwIfAborted();
        fitShell(els, source, state, settings);
        const hits = actions(key, state).map(action => ({
          ...rect(doc.getElementById(action.id)), name: action.name,
          target: action.target === 'classroom' ? 'classroom' : ids.get(action.target),
        }));
        const feedback = els.stage.querySelector('.feedback');
        const fills = [...els.stage.querySelectorAll('.fill')];
        const layers = [];
        const isOrder = state.kind === 'order' || state.kind === 'checked';
        if (feedback) feedback.style.visibility = 'hidden';
        if (isOrder) {
          const sequence = doc.getElementById('order-sequence');
          const process = doc.getElementById('order-process');
          const controls = els.stage.querySelector('.controls');
          const variable = [sequence, process, controls];
          const zoom = els.shell.style.zoom;
          const mode = state.kind + '/' + zoom;
          const baseKey = 'order-base/' + mode;
          if (!cached.has(baseKey)) {
            variable.forEach(item => { item.style.visibility = 'hidden'; });
            if (!settings.light) els.score.style.visibility = 'hidden';
            await snapshot();
            await layer(whole, baseKey);
            variable.forEach(item => { item.style.visibility = ''; });
            els.score.style.visibility = '';
          }
          layers.push({ ...cached.get(baseKey), label: '排序画面' });
          await snapshot();
          const picked = [...state.prefix].sort().join(',');
          layers.push({ ...await layer(rect(sequence), 'sequence/' + zoom + '/' + state.prefix.join(',')), label: '当前顺序' });
          layers.push({ ...await layer(rect(process), 'process/' + zoom + '/' + picked), label: '排序卡片' });
          layers.push({ ...await layer(rect(controls),
            'order-controls/' + mode + '/' + Number(state.prefix.length === 4)), label: '排序按钮' });
          if (!settings.light) layers.push({ ...await layer(rect(els.score), 'order-score/' + mode + '/' + Boolean(state.exact)), label: '观察点' });
        } else {
          await snapshot();
          layers.push({ ...await layer(whole), label: '活动画面' });
        }
        if (feedback) {
          feedback.style.visibility = '';
          fills.forEach(item => item.style.visibility = 'hidden');
          await snapshot();
          layers.push({ ...await layer(rect(feedback), isOrder ? 'review/' + els.shell.style.zoom + '/' + state.exact : null),
            label: '观察或复盘反馈', effect: 'fade' });
          if (fills.length) {
            fills.forEach(item => item.style.visibility = '');
            await snapshot();
            for (const fill of fills) {
              const bounds = rect(fill);
              if (!bounds.w) continue;
              layers.push({ ...await layer(bounds), label: '情境推演刻度', effect: 'wipe' });
            }
          }
        }
        slides.push({ name: state.title, layers, hits });
        if (slides.length % 4 === 0 || slides.length === mapping.size) {
          progress(Math.round(slides.length / mapping.size * 64), '正在生成 16:9 画面');
        }
      }
      return Curriculum.surround({
        slides, media, title: source.title, width: WIDTH, height: HEIGHT, colors: source.color, advanceMs: 0,
      }, settings);
    } finally {
      frame.remove();
    }
  }

  global.ScenarioActivity = { read, render, fallbackLesson };
})(globalThis);
