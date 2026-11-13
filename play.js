(function () {
  'use strict';

  const mount = document.getElementById('classroom-player');
  function node(tag, text, className) {
    const item = document.createElement(tag);
    if (text) item.textContent = text;
    if (className) item.className = className;
    return item;
  }

  function button(text, action, primary = false) {
    const control = node('button', text, 'button ' + (primary ? 'primary' : 'secondary'));
    control.type = 'button';
    control.addEventListener('click', action);
    return control;
  }

  function shuffled(items) {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    if (result.every((item, i) => item === items[i])) result.push(result.shift());
    return result;
  }

  function present(lesson) {
    let index = 0;
    let score = 0;
    let correct = 0;
    let timer;
    function frame(title, message, label = '') {
      const pane = node('article', '', 'panel play-panel');
      pane.append(node('p', label, 'muted'), node('h1', title), node('p', message));
      mount.replaceChildren(pane);
      return pane;
    }
    function start() {
      clearTimeout(timer);
      index = 0;
      score = 0;
      correct = 0;
      const pane = frame(lesson.title, lesson.intro, '课堂活动 · ' + lesson.qs.length + ' 题');
      for (const [title, description] of lesson.rules) pane.append(node('p', title + ' ' + description));
      pane.append(button('开始活动', render, true));
    }
    function advance(next) {
      clearTimeout(timer);
      index = next;
      render();
    }
    function render() {
      if (index >= lesson.qs.length) {
        const pane = frame(lesson.endTitle, lesson.endCopy, lesson.scored ? '本次积分 ' + score : '已完成');
        for (const [label, value] of ClassroomProject.accuracyResults(lesson, correct)) {
          pane.append(node('p', label + ' ' + value, 'play-result'));
        }
        for (const tip of lesson.tips) pane.append(node('p', tip));
        pane.append(button('再试一次', start));
        return;
      }
      const q = lesson.qs[index];
      const pane = frame(q.title, q.copy, '第 ' + (index + 1) + ' 题 / ' + lesson.qs.length + ' · ' + ClassroomProject.TYPES[q.type]);
      if (q.type === 'choice') choice(pane, q);
      else if (q.type === 'match') matching(pane, q);
      else ordering(pane, q);
    }
    function choice(pane, q) {
      const choices = node('div', '', 'play-list');
      const response = node('div', '', 'play-feedback');
      const rating = node('div', '', 'play-ratings');
      response.hidden = true;
      response.setAttribute('role', 'status');
      const optionButtons = q.options.map(option => button(option.text, () => {
        optionButtons.forEach(control => { control.disabled = true; });
        [...rating.children].forEach(control => { control.disabled = true; });
        if (lesson.scored) score += option.points ?? 0;
        if (option.correct === true) correct++;
        const next = ClassroomProject.nextIndex(lesson, index, option);
        response.hidden = false;
        const fallback = option.correct === null ? '已记录你的选择。' : option.correct ? '这个选择合适。' : '可以再想一想。';
        response.append(node('p', option.result || fallback), node('p', option.tip));
        if (lesson.scored && option.points !== null) response.append(node('p', '本题 ' + option.points + ' 分', 'muted'));
        if (lesson.advanceMs) response.append(node('p', lesson.advanceMs / 1000 + ' 秒后自动继续', 'muted'));
        const onward = button(next === lesson.qs.length ? '完成活动' : '继续', () => advance(next), true);
        response.append(onward);
        onward.focus();
        if (lesson.advanceMs) timer = setTimeout(() => advance(next), lesson.advanceMs);
      }));
      if (q.emotion !== null) {
        const info = node('p', '先选你的情绪强度（1–10），再回答。参考强度 ' + q.emotion + '/10。');
        for (let value = 1; value <= 10; value++) {
          const control = button(String(value), () => {
            [...rating.children].forEach((item, i) => item.setAttribute('aria-pressed', String(i + 1 === value)));
            optionButtons.forEach(item => { item.disabled = false; });
          });
          control.setAttribute('aria-pressed', 'false');
          rating.append(control);
        }
        optionButtons.forEach(item => { item.disabled = true; });
        pane.append(info, rating);
      }
      choices.append(...optionButtons);
      pane.append(choices, response);
    }

    function bindDrag(source, onStart) {
      source.draggable = true;
      source.addEventListener('dragstart', event => {
        onStart();
        event.dataTransfer.setData('text/plain', source.textContent);
        event.dataTransfer.effectAllowed = 'move';
      });
    }
    function bindDrop(target, action) {
      target.addEventListener('dragover', event => event.preventDefault());
      target.addEventListener('drop', event => {
        event.preventDefault();
        action();
      });
    }
    function feedback(container, success, text) {
      container.replaceChildren(node('p', success ? text || '活动已完成。' : '还有地方需要调整，再试一次。'));
      if (success) container.append(button('继续', () => advance(index + 1), true));
    }
    function matching(pane, q) {
      pane.append(node('p', '点选左侧再点右侧，或将左侧卡片拖到右侧。配完后统一检查。', 'muted'));
      const area = node('div', '', 'play-match');
      const left = node('div', '', 'play-list');
      const right = node('div', '', 'play-list');
      const response = node('div', '', 'play-feedback');
      response.setAttribute('role', 'status');
      const choices = shuffled(q.items.map(pair => pair.right));
      const paired = new Map();
      let selected = null;
      let dragged = null;
      let complete = false;
      function setPair(value, i) {
        if (complete || i === null) return;
        for (const [key, existing] of paired) if (existing === value) paired.delete(key);
        paired.set(i, value);
        selected = dragged = null;
        response.replaceChildren();
        draw();
      }
      function draw() {
        left.replaceChildren(...q.items.map((pair, i) => {
          const control = button(pair.left + (paired.has(i) ? ' · ' + paired.get(i) : ''), () => {
            selected = i;
            [...left.children].forEach((item, position) => item.setAttribute('aria-pressed', String(i === position)));
          });
          control.disabled = complete;
          control.setAttribute('aria-pressed', String(i === selected));
          if (!complete) bindDrag(control, () => { dragged = i; });
          control.addEventListener('dragend', () => { dragged = null; });
          return control;
        }));
        right.replaceChildren(...choices.map(value => {
          const control = button(value, () => setPair(value, selected));
          control.disabled = complete;
          if (!complete) bindDrop(control, () => setPair(value, dragged));
          return control;
        }));
        check.disabled = complete || paired.size !== q.items.length;
      }
      const check = button('检查配对', () => {
        complete = q.items.every((pair, i) => paired.get(i) === pair.right);
        feedback(response, complete, q.feedback);
        draw();
      }, true);
      area.append(left, right);
      pane.append(area, check, response);
      draw();
    }
    function ordering(pane, q) {
      pane.append(node('p', '拖动卡片或用上移、下移排出顺序，再检查。', 'muted'));
      const area = node('ol', '', 'play-list play-order');
      const response = node('div', '', 'play-feedback');
      response.setAttribute('role', 'status');
      const values = shuffled(q.items);
      let dragged = null;
      let complete = false;
      function move(from, to) {
        if (complete || from === null || from === to || to < 0 || to >= values.length) return;
        values.splice(to, 0, values.splice(from, 1)[0]);
        response.replaceChildren();
        draw();
      }
      function draw() {
        area.replaceChildren(...values.map((value, i) => {
          const row = node('li', '', 'order-row');
          const up = button('上移', () => { move(i, i - 1); area.children[i - 1]?.querySelector('button')?.focus(); });
          const down = button('下移', () => { move(i, i + 1); area.children[i + 1]?.querySelector('button:last-child')?.focus(); });
          up.disabled = complete || i === 0;
          down.disabled = complete || i === values.length - 1;
          up.setAttribute('aria-label', '上移 ' + value);
          down.setAttribute('aria-label', '下移 ' + value);
          if (!complete) {
            bindDrag(row, () => { dragged = i; });
            bindDrop(row, () => {
              const from = dragged;
              dragged = null;
              move(from, i);
            });
            row.addEventListener('dragend', () => { dragged = null; });
          }
          row.append(node('span', value), up, down);
          return row;
        }));
      }
      const check = button('检查顺序', () => {
        complete = q.items.every((value, i) => value === values[i]);
        feedback(response, complete, q.feedback);
        check.disabled = complete;
        draw();
      }, true);
      pane.append(area, check, response);
      draw();
    }
    start();
    return () => clearTimeout(timer);
  }

  let dispose = null;
  let revision = 0;
  const scriptUrl = document.currentScript.src;
  async function loadExample() {
    const response = await fetch(new URL('./classroom-example.json?v=4', scriptUrl));
    if (!response.ok) throw Error('示例暂时无法打开。');
    return ClassroomProject.unpack(await response.text());
  }

  function openFromLocation() {
    const turn = ++revision;
    dispose?.();
    dispose = null;
    const hash = location.hash;
    const isExample = hash === '#class-example';
    const playing = isExample || hash.startsWith('#play=');
    document.querySelector('main').hidden = playing;
    document.querySelector('header').hidden = playing;
    mount.hidden = !playing;
    if (!playing) return;
    mount.textContent = '正在打开课堂活动…';
    (isExample ? loadExample() : ClassroomProject.readToken(hash.slice(6))).then(lesson => {
      if (turn === revision) dispose = present(lesson);
    }).catch(() => {
      if (turn !== revision) return;
      const retry = node('a', '返回课件工具', 'button secondary');
      retry.href = location.pathname;
      const message = isExample ? '请刷新页面后再打开示例。' : '请向老师获取完整的活动链接。';
      mount.replaceChildren(node('h1', '活动链接无法打开'), node('p', message), retry);
    });
  }
  window.addEventListener('hashchange', openFromLocation);
  openFromLocation();
})();
