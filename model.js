(function (global) {
  'use strict';

  const DEFAULT_COLORS = {
    canvas: 'FFF3D9', surface: 'FFF6E3', ink: '78440A', muted: '936835',
    primary: 'F8981F', highlight: 'A6CFEF', attention: '9D3E00',
    positive: '3B6484', border: 'DFCBAF', 'success-soft': 'DCECF7', 'error-soft': 'FBE1C7',
  };
  const MAX_SOURCE = 8 * 1024 * 1024;
  const MAX_QUESTIONS = 24;
  const DATA_NAME = /^(?:(?:quiz|game|lesson|challenge)?(?:levels|questions|scenarios|scenes|situations|data|config|bank)|quiz|questionBank|rounds)$/i;
  const HEADLINE = '这份 HTML 的互动题库未能识别。';
  const text = (value) => typeof value === 'string' ? value.trim() : '';
  const firstText = (...values) => values.map(text).find(Boolean) || '';
  const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

  function readLiteral(node, depth = 0) {
    if (!node || depth > 16) throw new Error('不是直接写在源码中的数据');
    if (node.type === 'Literal' && ['string', 'number', 'boolean'].includes(typeof node.value)) return node.value;
    if (node.type === 'Literal' && node.value === null) return null;
    if (node.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0].value.cooked;
    if (node.type === 'UnaryExpression' && node.operator === '-' && typeof node.argument.value === 'number') {
      return -node.argument.value;
    }
    if (node.type === 'ArrayExpression') return node.elements.map((item) => readLiteral(item, depth + 1));
    if (node.type === 'ObjectExpression') {
      const result = Object.create(null);
      for (const property of node.properties) {
        if (property.type !== 'Property' || property.kind !== 'init' || property.computed || property.method || property.shorthand) {
          throw new Error('题库含有动态数据');
        }
        const key = property.key.name ?? property.key.value;
        result[key] = readLiteral(property.value, depth + 1);
      }
      return result;
    }
    throw new Error('题库含有动态数据');
  }

  function parseScript(code) {
    for (const sourceType of ['script', 'module']) {
      try {
        return global.acorn.parse(code, { ecmaVersion: 'latest', sourceType, allowReturnOutsideFunction: true });
      } catch {
        // A script using import/export is parsed as a module on the second pass.
      }
    }
    return null;
  }

  function collectCandidates(code, type, candidates) {
    if (type === 'application/json' || type === 'application/ld+json') {
      try { candidates.push(JSON.parse(code)); } catch { /* Skip invalid JSON. */ }
      return;
    }
    if (!/\b(?:question|questions|options|choices|levels)\b/i.test(code)) return;
    const ast = parseScript(code);
    if (!ast) return;
    function visit(node, depth = 0) {
      if (!node?.type || depth > 80) return;
      if (node.type === 'VariableDeclarator' && DATA_NAME.test(node.id?.name || '')) {
        add(node.init);
      }
      if (node.type === 'AssignmentExpression' && node.operator === '=') {
        const name = node.left.property?.name ?? node.left.property?.value ?? node.left.name;
        if (DATA_NAME.test(name || '')) add(node.right);
      }
      if (node.type === 'ExportDefaultDeclaration') add(node.declaration);
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) value.forEach((child) => visit(child, depth + 1));
        else if (value?.type) visit(value, depth + 1);
      }
    }
    function add(node) {
      if (!node || !['ArrayExpression', 'ObjectExpression'].includes(node.type)) return;
      try { candidates.push(readLiteral(node)); } catch { /* Dynamic candidates cannot be read without running the page. */ }
    }
    visit(ast);
  }

  function unpack(value) {
    const meta = isObject(value) ? value : Object.create(null);
    const array = Array.isArray(value) ? value
      : meta.levels ?? meta.rounds ?? meta.questions ?? meta.scenarios ?? meta.scenes ?? meta.items;
    if (!Array.isArray(array) || !array.length) return null;
    if (array.every((item) => isObject(item) && Array.isArray(item.questions ?? item.items ?? item.scenes))) {
      return {
        meta,
        levels: array.map((item, index) => ({
          name: firstText(item.name, item.title, '第 ' + (index + 1) + ' 关'),
          tag: text(item.tag),
          questions: item.questions ?? item.items ?? item.scenes,
        })),
      };
    }
    if (array.every((item) => isObject(item) && Array.isArray(item.options ?? item.choices ?? item.answers))) {
      return { meta, levels: [{ name: firstText(meta.levelName, '闯关练习'), tag: '', questions: array }] };
    }
    return null;
  }

  function insideText(container, selector) {
    const node = container.querySelector(selector);
    if (!node) return '';
    const clone = node.cloneNode(true);
    clone.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
    clone.querySelectorAll('style, script').forEach((child) => child.remove());
    return (clone.textContent || '').replace(/[ \t]+/g, ' ').trim();
  }

  function pairs(container, selector) {
    return Array.from(container.querySelectorAll(selector), (node) => [
      insideText(node, 'b, strong'), insideText(node, 'span, p'),
    ]).filter(([name, description]) => name && description);
  }

  function parseOption(option, index, question) {
    const raw = isObject(option) ? option : Object.create(null);
    const feedback = raw.feedback ?? (Array.isArray(question.feedback) ? question.feedback[index] : undefined);
    const details = isObject(feedback) ? feedback : Object.create(null);
    const correctIndex = question.correctIndex ?? question.answerIndex;
    const correctFlag = raw.rational ?? raw.isCorrect ?? raw.correct ?? details.correct;
    const correct = typeof correctFlag === 'boolean' ? correctFlag
      : Number.isInteger(correctIndex) ? index === correctIndex : null;
    const declaredScore = raw.points ?? raw.score ?? details.points ?? details.score;
    const points = declaredScore ?? (Number.isInteger(question.points) && correct !== null
      ? (correct ? question.points : 0) : null);
    return {
      text: firstText(option, raw.text, raw.label, raw.title, raw.answer),
      result: firstText(raw.result, raw.message, feedback, details.text, details.result, details.message, question.explanation),
      tip: firstText(raw.tip, details.tip),
      heading: firstText(raw.feedbackTitle, details.title),
      points,
      correct,
    };
  }

  function normalize(data, fragment, raw) {
    const { meta, levels } = data;
    const originalEmotionLayout = Boolean(fragment.querySelector('#ratingOptions') && fragment.querySelector('#sceneTitle'));
    const qs = levels.flatMap((level) => level.questions.map((question, index) => {
      if (!isObject(question)) throw Error('题库中有不完整的题目。');
      const choices = question.options ?? question.choices ?? question.answers;
      const emotion = question.emotion ?? question.intensity;
      const rating = Number.isInteger(emotion) && emotion >= 1 && emotion <= 10;
      return {
        title: firstText(question.title, question.question, question.prompt, question.name),
        copy: firstText(question.copy, question.scenario, question.description, question.context),
        level: level.name + (level.tag ? ' · ' + level.tag : ''),
        progress: (index + 1) + ' / ' + level.questions.length,
        emotion: rating ? emotion : null,
        options: Array.isArray(choices) ? choices.map((option, i) => parseOption(option, i, question)) : [],
      };
    }));
    if (!qs.length) throw Error('题库没有题目。');
    if (qs.length > MAX_QUESTIONS) throw Error('当前最多支持 ' + MAX_QUESTIONS + ' 道题。');
    for (const [index, question] of qs.entries()) {
      if (!question.title || question.title.length > 64 || question.copy.length > 300 || question.level.length > 64) {
        throw Error('第 ' + (index + 1) + ' 题缺少标题或文字太长，无法排入当前版式。');
      }
      if (question.options.length < 2 || question.options.length > 4) {
        throw Error('第 ' + (index + 1) + ' 题需要有 2 至 4 个选项。');
      }
      if (question.options.some((option) => !option.text || option.text.length > 180 ||
          option.result.length > 240 || option.tip.length > 180 || option.heading.length > 45 ||
          (option.points !== null && (!Number.isSafeInteger(option.points) || Math.abs(option.points) > 500)))) {
        throw Error('第 ' + (index + 1) + ' 题的选项文字、反馈或分值超出支持范围。');
      }
    }
    const options = qs.flatMap((question) => question.options);
    const scored = options.some((option) => option.points !== null);
    const countsCorrect = options.every((option) => option.correct !== null);
    if (scored && options.some((option) => option.points === null)) {
      throw Error('源码只为部分选项写明了分值，无法按原规则累计。');
    }
    if (options.some((option) => !option.result && !option.tip && option.correct === null && option.points === null)) {
      throw Error('有选项缺少可直接读取的反馈、分值或正误结果。');
    }
    const c = { ...DEFAULT_COLORS };
    for (const key of Object.keys(c)) {
      const match = raw.match(new RegExp('--' + key + '\\s*:\\s*#([0-9a-f]{6})\\b', 'i'));
      if (match) c[key] = match[1];
    }
    const fromScript = raw.match(/setTimeout\s*\(\s*\(\s*\)\s*=>\s*\{[^{}]{0,360}(?:'NEXT'|"NEXT"|nextQuestion\s*\()[^{}]{0,140}\}\s*,\s*(\d{3,5})\s*\)/);
    const delay = meta.advanceMs ?? (fromScript ? Number(fromScript[1]) : 0);
    const advanceMs = Number.isInteger(delay) && delay >= 1000 && delay <= 30000 ? delay : 0;
    const ranking = originalEmotionLayout && raw.match(/accuracy\s*>=\s*(\d{1,3})\s*\?\s*'([^']{1,32})'\s*:\s*accuracy\s*>=\s*(\d{1,3})\s*\?\s*'([^']{1,32})'\s*:\s*'([^']{1,32})'/);
    const title = firstText(
      insideText(fragment, '#intro h1, #startScreen h1, #start-screen h1'),
      meta.title, insideText(fragment, 'title'), insideText(fragment, 'h1'), '课堂互动闯关',
    );
    const cover = fragment.querySelector('#intro img, #startScreen img, #start-screen img, img[data-role="teaching-visual"]');
    return {
      qs, c, levelCount: levels.length, originalEmotionLayout, scored, countsCorrect, advanceMs,
      rank: ranking ? [[Number(ranking[1]), ranking[2]], [Number(ranking[3]), ranking[4]], [0, ranking[5]]] : [],
      brand: firstText(insideText(fragment, '.brand'), meta.title, insideText(fragment, 'title'), title),
      audience: insideText(fragment, '.mini-status .pill'),
      title,
      intro: firstText(insideText(fragment, '#intro .panel p, #intro p, #start-screen p'), meta.description),
      rules: pairs(fragment, '#intro .rule'),
      methods: pairs(fragment, '#game .method'),
      endTitle: firstText(insideText(fragment, '#summary h1, #summary h2'), meta.endTitle, '闯关完成'),
      endCopy: firstText(insideText(fragment, '#summary .panel p, #summary p'), meta.endCopy),
      tips: Array.from(fragment.querySelectorAll('#summary .tips li'), (li) => text(li.textContent)),
      coverUrl: cover?.getAttribute('src')?.trim() || '',
    };
  }

  function readSource(source) {
    if (typeof source !== 'string' || !source.trim()) throw Error('请粘贴 HTML 源码或选择 HTML 文件。');
    if (source.length > MAX_SOURCE) throw Error('请选择不超过 8 MB 的 HTML 文件。');
    const raw = source.trim().replace(/^~~~(?:html|javascript|js)?[ \t]*\r?\n|[\r\n]+~~~$/gi, '')
      .replace(/^\x60{3}(?:html|javascript|js)?[ \t]*\r?\n|[\r\n]+\x60{3}$/gi, '');
    if (/^https?:\/\/\S+$/i.test(raw)) throw Error('这里需要飞象导出的 HTML 源码。请打开课件，复制代码或下载 HTML 文件。');
    const template = document.createElement('template');
    // The template remains detached. Source code and its markup are never run or rendered.
    template.innerHTML = raw;
    const fragment = template.content;
    const scripts = Array.from(fragment.querySelectorAll('script:not([src])'));
    const candidates = [];
    for (const script of scripts) collectCandidates(script.textContent, script.type, candidates);
    if (!scripts.length && !fragment.querySelector('body, main, div, head')) {
      collectCandidates(raw, 'text/javascript', candidates);
    }
    let issue;
    const banks = candidates.map(unpack).filter(Boolean)
      .sort((a, b) => b.levels.length - a.levels.length);
    for (const bank of banks) {
      try { return normalize(bank, fragment, raw); } catch (error) { issue ??= error; }
    }
    throw issue ?? Error(HEADLINE + '目前支持源码中写明题目和选项的闯关或选择题。请检查是否复制了完整源码。');
  }

  global.LessonModel = { readSource, MAX_SOURCE };
})(globalThis);

