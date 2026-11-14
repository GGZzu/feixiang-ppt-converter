(function (global) {
  'use strict';

  const WIDTH = 1920;
  const HEIGHT = 1080;
  const PROJECTION_ZOOM = 1.28;
  const MAX_FRAMES = 4200;
  const TAGS = new Set('div header main section aside span b strong small h1 h2 h3 p ul li br img button i'.split(' '));
  const REQUIRED = 'intro game summary startBtn topScore levelName progressText sceneTitle sceneCopy emotionLabel meterFill ratingValue ratingOptions options feedback hintText progressDots scoreSide finalScore rationalCount rankText restartBtn backIntroBtn'.split(' ');
  const INITIAL_HINT = '请先评估情绪强度，再选择应对方式。';
  const RATED_HINT = '现在请选择你的应对方式。';
  const TOASTS = ['先观察后调整，下一题继续练习。', '选择有效，积分增加'];
  const FEEDBACK = ['这个做法可能让事情升级', '这是一种更有效的应对'];
  const UNSAFE_CSS = /[\\<>\x00-\x08\x0b\x0e-\x1f]|@(?!(?:media)\b)|(?:url|image-set|src|paint|element|image)\s*\(/i;
  // Use the same canvas and layout on every device.
  const PROJECTION_CSS = [
    '.app { min-height:0; padding:18px 36px 0; }',
    '.topbar, .screen { max-width:none; }',
    '.topbar { margin-bottom:16px; }',
    '.hero .panel { min-height:776px; display:flex; flex-direction:column; justify-content:center; align-items:flex-start; }',
    '.hero p { margin:14px 0 0; }',
    '.hero .rules { margin:26px 0; }',
    '.hero img { min-width:0; }',
    '.game-layout { gap:18px; }',
    '.scene-card { padding:22px 24px; }',
    '.scene-title { margin:12px 0 6px; }',
    '.scene-copy { font-size:20px; margin:9px 0 8px; }',
    '.self-rating { margin-top:12px; padding:12px 14px; }',
    '.rating-options { margin-top:8px; gap:7px; }',
    '.rating-options button { padding:7px 6px; }',
    '.rating-tip { margin-top:7px; }',
    '#options { display:grid; gap:7px; margin-top:10px; }',
    '.option { width:100%; align-items:center; min-height:60px; padding:10px 14px; font-size:18px; }',
    '.feedback { margin-top:12px; padding:12px 16px; }',
    '.feedback h3, .feedback p { margin:0 0 6px; }',
    '.next-row { margin-top:11px; }',
    '.scene-card:not(.show-feedback) .scene-title { margin:16px 0 9px; }',
    '.scene-card:not(.show-feedback) .self-rating { margin-top:17px; padding:15px 14px; }',
    '.scene-card:not(.show-feedback) .rating-options button { min-height:53px; }',
    '.scene-card:not(.show-feedback) .option { min-height:74px; font-size:19px; }',
    '.scene-card:not(.show-feedback) .next-row { margin-top:15px; }',
    '.side { gap:16px; }',
    '.side-card { padding:18px 20px; }',
    '.side-card h3 { margin:0 0 12px; font-size:21px; }',
    '.method { padding:16px 0; }',
    '.summary { max-width:1370px; }',
    '.summary .panel { min-height:760px; padding:34px 42px; display:flex; flex-direction:column; justify-content:center; }',
    '.summary h1 { margin:14px 0 10px; }',
    '.summary .panel > p { font-size:18px; margin:0 0 12px; }',
    '.summary .score-big { font-size:92px; }',
    '.summary .result-grid { margin:20px 0; }',
    '.summary .result-box { padding:14px 18px; }',
    '.summary .tips { padding:14px 20px; }',
    '.summary .tips h3 { margin:0 0 8px; }',
    '.summary .tips ul { margin:0; }',
    '.summary .tips li { margin:6px 0; }',
    '.toast { right:36px; bottom:27px; font-size:20px; }',
    '.classroom-continue { background:var(--ink); color:#fff; border-color:var(--ink); }',
  ].join('\n');

  function read(source, data) {
    if (!data.originalEmotionLayout || !data.scored || !data.countsCorrect || !data.advanceMs || !data.rank.length ||
        data.branching || data.qs.some(q => q.emotion === null || q.options.some(o => o.points < 0))) return null;
    const t = document.createElement('template');
    t.innerHTML = source;
    const app = t.content.querySelector('.app');
    const toast = t.content.querySelector('#toast.toast');
    const cover = app?.querySelector('#intro img');
    const nodes = app?.querySelectorAll('*');
    const styles = [...t.content.querySelectorAll('style')];
    const css = styles.map(el => el.textContent.replace(/\/\*[\s\S]*?\*\//g, ''))
      .find(value => value.includes('.scene-card') && value.includes('.game-layout') && value.includes('.toast.show'));
    const script = [...t.content.querySelectorAll('script:not([src])')].find(el => el.textContent.includes('function setRating('))?.textContent;
    const hideMs = Number(script?.match(/classList\.remove\(['"]show['"]\)\s*,\s*(\d{3,5})\s*\)/)?.[1]);
    const feedbackHint = script?.match(/\$\(['"]hintText['"]\)\.textContent\s*=\s*['"](评价将在[^'"\r\n]{1,60})['"]/)?.[1];
    if (!app || !toast || !cover || !nodes || nodes.length > 350 || !css || css.length > 16000 ||
        UNSAFE_CSS.test(css) || !feedbackHint || hideMs < 250 || !hideMs || hideMs >= data.advanceMs ||
        ![INITIAL_HINT, RATED_HINT, ...TOASTS, ...FEEDBACK].every(value => script.includes(value)) ||
        !REQUIRED.every(id => app.querySelectorAll('#' + id).length === 1) ||
        !app.querySelector('.mini-status') ||
        [...nodes].filter(node => node.localName === 'img').length !== 1) return null;

    function copy(node) {
      if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.data);
      if (node.namespaceURI !== 'http://www.w3.org/1999/xhtml' || !TAGS.has(node.localName)) return null;
      const el = document.createElement(node.localName);
      for (const key of ['id', 'class', 'alt']) {
        const value = node.getAttribute(key);
        if (value && value.length <= 256) el.setAttribute(key, value);
      }
      const style = node.getAttribute('style');
      if (style && style.length <= 512 && !UNSAFE_CSS.test(style)) el.setAttribute('style', style);
      for (const child of node.childNodes) {
        const safe = copy(child);
        if (safe) el.append(safe);
      }
      return el;
    }
    const safeApp = copy(app);
    const safeToast = copy(toast);
    if (!safeApp || !safeToast || !REQUIRED.every(id => safeApp.querySelector('#' + id)) ||
      !safeApp.querySelector('#intro h1') || !safeApp.querySelector('#intro .panel p') ||
      !safeApp.querySelector('#game .scene-card .next-row') || !safeApp.querySelector('#summary .result-grid') ||
      !safeApp.querySelector('#summary #finalScore + *')) return null;
    const initial = {
      title: data.title, brand: data.brand, intro: data.intro,
    };
    return { app: safeApp, toast: safeToast, css, feedbackHint, hideMs, initial };
  }

  function sizeOf(el) {
    const { x, y, width, height } = el.getBoundingClientRect();
    return { x, y, w: width, h: height };
  }

  function snap(el) {
    const { x, y, w, h } = sizeOf(el);
    return { x: Math.floor(x), y: Math.floor(y), w: Math.ceil(x + w) - Math.floor(x), h: Math.ceil(y + h) - Math.floor(y) };
  }

  function inlineImage(value) {
    if (typeof value === 'string') return Promise.resolve(value);
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(value);
    });
  }

  function createStage(source, cover) {
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-same-origin');
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    frame.style.cssText = 'position:absolute;left:-2200px;top:0;width:' + WIDTH + 'px;height:' + HEIGHT +
      'px;border:0;pointer-events:none;opacity:0;';
    frame.srcdoc = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">' +
      '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:"></head><body></body></html>';
    return new Promise((resolve, reject) => {
      frame.addEventListener('load', async () => {
        try {
          const doc = frame.contentDocument;
          if (!doc?.body) throw Error('当前浏览器无法绘制原网页。请用新版 Edge 或 Chrome 重试。');
          const style = doc.createElement('style');
          const windowCss = 'html {width:' + WIDTH + 'px; height:' + HEIGHT + 'px; scrollbar-width:none}' +
            'body{width:' + WIDTH + 'px;height:' + HEIGHT + 'px;position:relative}.toast{position:absolute}';
          style.textContent = source.css + '\n' + windowCss + '\n' + PROJECTION_CSS;
          doc.body.append(style, doc.importNode(source.app, true), doc.importNode(source.toast, true));
          const image = doc.querySelector('#intro img');
          image.src = cover;
          await image.decode();
          await doc.fonts.ready;
          resolve({ frame, doc });
        } catch (error) {
          frame.remove();
          reject(error);
        }
      }, { once: true });
      document.body.append(frame);
    });
  }

  function paint(doc, data, source, state, settings) {
    const get = id => doc.getElementById(id);
    const put = (id, value) => { get(id).textContent = value; };
    const phase = state.kind;
    const intro = phase === 'intro';
    const end = phase === 'end';
    const feedback = phase === 'feedback';
    const rated = phase === 'rated';
    const option = feedback ? data.qs[state.question].options[state.value] : null;
    const score = (state.score ?? 0) + (option?.points ?? 0);
    get('intro').classList.toggle('hidden', !intro);
    get('game').classList.toggle('hidden', intro || end);
    get('summary').classList.toggle('hidden', !end);
    get('toast').className = 'toast';
    put('topScore', '积分：' + score);
    if (intro) return;
    if (end) {
      const continuation = get('classroom-continue');
      continuation.hidden = !settings.after.length;
      const accuracy = Math.round(state.correct / data.qs.length * 100);
      put('finalScore', score);
      put('rationalCount', state.correct + ' / ' + data.qs.length);
      put('rankText', data.rank.find(([min]) => accuracy >= min)?.[1] ?? '');
      return;
    }
    const q = data.qs[state.question];
    const answered = state.question + Number(feedback);
    doc.querySelector('.scene-card').classList.toggle('show-feedback', feedback);
    put('levelName', q.level);
    put('progressText', '第 ' + q.progress + ' 题 · 总进度 ' + (answered + 1) + ' / ' + data.qs.length);
    put('sceneTitle', q.title);
    put('sceneCopy', q.copy);
    put('emotionLabel', q.emotion + ' / 10');
    get('meterFill').style.width = (q.emotion * 10) + '%';
    put('scoreSide', '积分：' + score);
    put('ratingValue', rated ? state.value + ' / 10' : '未选择');
    function element(tag, text, className) {
      const el = doc.createElement(tag);
      if (text !== undefined) el.textContent = text;
      if (className) el.className = className;
      return el;
    }
    get('progressDots').replaceChildren(...data.qs.map((_, index) =>
      element('span', index + 1, 'progress-dot' + (index < answered ? ' done' : index === answered ? ' current' : ''))));
    get('ratingOptions').replaceChildren(...Array.from({ length: 10 }, (_, index) => {
      const button = element('button', index + 1, rated && state.value === index + 1 ? 'selected' : '');
      button.type = 'button';
      button.disabled = feedback;
      return button;
    }));
    const wrap = get('options');
    wrap.classList.toggle('locked', !rated);
    wrap.replaceChildren(...q.options.map((item, index) => {
      const label = element('span');
      label.append(element('b', item.text));
      const button = element('button', undefined, 'option');
      button.append(element('span', String.fromCharCode(65 + index), 'letter'), label);
      button.disabled = feedback;
      if (feedback && state.value === index) button.classList.add(option.correct ? 'correct-answer' : 'wrong-answer');
      return button;
    }));
    const f = get('feedback');
    f.className = 'feedback ' + (feedback ? option.correct ? 'good' : 'bad' : 'hidden');
    f.replaceChildren();
    if (feedback) {
      const tip = element('p');
      tip.append(element('b', '情绪调节提示：'), doc.createTextNode(option.tip));
      f.append(element('h3', FEEDBACK[Number(option.correct)]), element('p', option.result), tip);
      if (data.scored) f.append(element('div', option.points ? '+' + option.points + ' 分' : '本题不加分', 'score'));
    }
    const manual = feedback && !data.advanceMs;
    const next = get('manual-next');
    next.hidden = !manual;
    next.textContent = state.finishes ? '查看小结' : '下一题';
    put('hintText', feedback ? (manual ? '讨论完毕后点按钮继续。' : source.feedbackHint) : rated ? RATED_HINT : INITIAL_HINT);
  }

  function makeOrder(data) {
    const { states } = LessonPptx.plan(data);
    const order = [];
    const mapping = [];
    const intros = new Map([[0, 1]]);
    states.forEach((state, index) => {
      mapping[index + 1] = order.push(state);
      if (state.kind === 'feedback' && data.advanceMs) order.push(states[state.next - 1]);
    });
    for (const state of states) {
      if (state.kind === 'end' && !intros.has(state.score)) {
        intros.set(state.score, order.push({ ...states[0], score: state.score }));
      }
    }
    if (order.length > MAX_FRAMES) throw Error('这份课件的答题路线太多，无法完整装进一份 PPT。');
    return { order, mapping, intros, start: mapping[states[0].start] };
  }

  function fitStage(doc, data, source, settings) {
    const app = doc.querySelector('.app');
    const testStates = [{ kind: 'intro' }, { kind: 'end', score: 9999, correct: data.qs.length }];
    for (const [question, q] of data.qs.entries()) {
      testStates.push({ kind: 'question', question });
      q.options.forEach((_, value) => testStates.push({ kind: 'feedback', question, value }));
    }
    const withinPage = state => {
      paint(doc, data, source, state, settings);
      const visible = doc.querySelector('#intro:not(.hidden), #game:not(.hidden), #summary:not(.hidden)');
      const bounds = sizeOf(visible);
      return bounds.y + bounds.h <= HEIGHT - 28;
    };
    for (let percent = Math.round(PROJECTION_ZOOM * 100); percent >= 94; percent -= 2) {
      const zoom = percent / 100;
      app.style.zoom = zoom;
      app.style.width = (WIDTH / zoom) + 'px';
      if (testStates.every(withinPage)) return;
    }
    throw Error('有一页的文字超出了宽屏画面，无法完整导出。请缩短该页的长文字后重试。');
  }

  async function render(source, data, cover, onProgress = () => {}, signal, settings = { before: [], after: [] }) {
    const { order, mapping, intros, start } = makeOrder(data);
    if (!cover) throw Error('没读到原封面。请在「封面和翻页」中选入同一张插图后重试。');
    const check = () => signal?.throwIfAborted();
    check();
    const coverUrl = await inlineImage(cover);
    const { frame, doc } = await createStage(source, coverUrl);
    try {
      const continueButton = Curriculum.button(doc);
      doc.getElementById('restartBtn').parentNode.append(continueButton);
      const next = doc.createElement('button');
      next.id = 'manual-next';
      doc.querySelector('.next-row').append(next);
      if (data.title !== source.initial.title) doc.querySelector('#intro h1').textContent = data.title;
      if (data.brand !== source.initial.brand) doc.querySelector('.brand').textContent = data.brand;
      if (data.intro !== source.initial.intro) doc.querySelector('#intro .panel p').textContent = data.intro;
      if (!data.scored) {
        doc.getElementById('topScore').hidden = true;
        doc.getElementById('scoreSide').hidden = true;
        doc.getElementById('finalScore').hidden = true;
        doc.getElementById('finalScore').nextElementSibling.hidden = true;
        const grid = doc.querySelector('.result-grid');
        grid.style.gridTemplateColumns = '1fr';
        for (const id of ['rationalCount', 'rankText']) doc.getElementById(id).parentNode.hidden = true;
      }
      fitStage(doc, data, source, settings);
      const whole = { x: 0, y: 0, w: WIDTH, h: HEIGHT };
      const encoder = new XMLSerializer();
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { alpha: false });
      const media = [];
      const cache = new Map();
      const unique = new Map();
      const mini = doc.querySelector('.mini-status');
      const side = doc.getElementById('scoreSide');
      const coverImg = doc.querySelector('#intro img');
      const toast = doc.getElementById('toast');
      const hide = (el, hidden) => el.style.visibility = hidden ? 'hidden' : '';
      const sceneBounds = doc.querySelector('.scene-card');
      function picture(key, bytes, rect) {
        const layer = { image: media.push(bytes), ...rect };
        cache.set(key, layer);
        return layer;
      }
      async function raster() {
        // An image document executes no script and cannot load external resources.
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + WIDTH + '" height="' + HEIGHT +
          '"><foreignObject width="' + WIDTH + '" height="' + HEIGHT + '">' +
          encoder.serializeToString(doc.documentElement) + '</foreignObject></svg>';
        const img = new Image();
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
        await img.decode();
        check();
        return img;
      }
      async function capture(key, img, rect) {
        canvas.width = rect.w;
        canvas.height = rect.h;
        ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
        const png = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        if (!png) throw Error('当前浏览器无法生成原样画面。请用新版 Edge 或 Chrome 重试。');
        check();
        return picture(key, await png.arrayBuffer(), rect);
      }
      async function base(state, key) {
        if (cache.has(key)) return cache.get(key);
        paint(doc, data, source, state, settings);
        const visible = doc.querySelector('#intro:not(.hidden), #game:not(.hidden), #summary:not(.hidden)');
        const { y, h } = sizeOf(visible);
        if (y + h > HEIGHT - 1) throw Error('有一页的文字超出了宽屏画面，暂时无法完整导出原样版。');
        hide(mini, true);
        hide(side, true);
        if (state.kind === 'intro') coverImg.src = coverUrl;
        else coverImg.removeAttribute('src');
        return capture(key, await raster(), whole);
      }
      async function scores(score) {
        const topKey = 'top/' + score;
        const sideKey = 'side/' + score;
        if (!cache.has(topKey)) {
          paint(doc, data, source, { kind: 'question', question: 0, score }, settings);
          hide(mini, false);
          hide(side, false);
          coverImg.removeAttribute('src');
          const img = await raster();
          await capture(topKey, img, snap(mini));
          if (data.scored) await capture(sideKey, img, snap(side));
        }
        return [cache.get(topKey), cache.get(sideKey)];
      }
      async function toastLayer(correct) {
        const key = 'toast/' + correct;
        if (cache.has(key)) return cache.get(key);
        toast.textContent = data.scored ? TOASTS[Number(correct)] :
          correct ? '选择有效，留意这次应对方法。' : TOASTS[0];
        toast.style.transition = 'none';
        toast.classList.add('show');
        const rect = snap(toast);
        const layer = await capture(key, await raster(), rect);
        toast.classList.remove('show');
        return layer;
      }
      function actions(state) {
        paint(doc, data, source, state, settings);
        function hit(el, target, name) {
          return { ...sizeOf(el), target, name };
        }
        if (state.kind === 'intro') return [hit(doc.getElementById('startBtn'), start, '开始闯关')];
        if (state.kind === 'end') return [
          hit(doc.getElementById('restartBtn'), start, '再玩一次'),
          hit(doc.getElementById('backIntroBtn'), intros.get(state.score), '返回说明'),
          ...(settings.after.length ? [hit(continueButton, 'classroom', '继续上课')] : []),
        ];
        if (state.kind === 'feedback') return data.advanceMs ? [] :
          [hit(next, mapping[state.next], state.finishes ? '查看小结' : '下一题')];
        const buttons = [...doc.querySelectorAll('#ratingOptions button')].map((el, index) =>
          hit(el, mapping[state.ratings[index]], '情绪强度 ' + (index + 1)));
        if (state.kind === 'rated') buttons.push(...[...doc.querySelectorAll('#options button')].map((el, index) =>
          hit(el, mapping[state.answers[index]], '选项 ' + String.fromCharCode(65 + index))));
        return buttons;
      }
      for (const [index, state] of order.entries()) {
        check();
        if (unique.has(state)) continue;
        const q = data.qs[state.question];
        const feedback = state.kind === 'feedback';
        const option = feedback ? q.options[state.value] : null;
        const score = (state.score ?? 0) + (option?.points ?? 0);
        const key = state.kind === 'end' ? ['end', score, state.correct].join('/')
          : [state.kind, state.question, state.value].join('/');
        const background = await base(state, key);
        const [topScore, sideScore] = await scores(score);
        const inGame = state.kind !== 'intro' && state.kind !== 'end';
        const layers = [background, topScore];
        if (inGame && sideScore) layers.push(sideScore);
        const hits = actions(state);
        if (inGame && sizeOf(sceneBounds).y + sizeOf(sceneBounds).h > HEIGHT) throw Error('题目内容超出了宽屏画面。');
        if (feedback) layers.push({ ...await toastLayer(option.correct), label: '答题提示', effect: 'toast' });
        const name = state.kind === 'intro' ? '开始闯关' : state.kind === 'end' ? '闯关结算'
          : '第 ' + (state.question + 1) + ' 题 · ' + q.title + (feedback ? ' · 答题反馈' : '');
        unique.set(state, { name, layers, hits, auto: Boolean(feedback && data.advanceMs) });
        if (index % 8 === 0 || index + 1 === order.length) {
          onProgress(Math.round((index + 1) / order.length * 64), '正在生成 16:9 宽屏画面');
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      }
      onProgress(64, '正在生成 16:9 宽屏画面');
      return Curriculum.surround({
        media, width: WIDTH, height: HEIGHT, title: data.brand, colors: data.c, advanceMs: data.advanceMs,
        hideMs: source.hideMs, slides: order.map(state => unique.get(state)),
      }, settings);
    } finally {
      frame.remove();
    }
  }

  global.LessonReplica = { read, render };
})(globalThis);
