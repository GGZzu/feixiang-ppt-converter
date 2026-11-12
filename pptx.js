(function (global) {
  'use strict';

  const PAGE_LIMIT = 4200;
  const MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

  function plan(data) {
    const states = [{ kind: 'intro' }];
    const keys = new Map();
    let physicalCount = 1;
    function add(kind, question, score, correct, value = 0) {
      const key = [kind, question, score, correct, value].join('/');
      if (keys.has(key)) return keys.get(key);
      physicalCount += kind === 'feedback' && data.advanceMs ? 2 : 1;
      if (physicalCount > PAGE_LIMIT) {
        const hint = data.advanceMs ? '可关闭定时翻页后重试，或将题库分成两份。' : '请将题库分成两份后再转换。';
        throw Error('这份课件的计分路线会超过 ' + PAGE_LIMIT + ' 页。' + hint);
      }
      const id = states.push({ kind, question, score, correct, value });
      keys.set(key, id);
      return id;
    }
    states[0].start = add('question', 0, 0, 0);
    for (let index = 1; index < states.length; index++) {
      const state = states[index];
      if (state.kind === 'end') continue;
      const q = data.qs[state.question];
      if (state.kind === 'question' && q.emotion !== null) {
        state.ratings = Array.from({ length: 10 }, (_, i) =>
          add('rated', state.question, state.score, state.correct, i + 1));
      } else if (state.kind === 'question' || state.kind === 'rated') {
        state.answers = q.options.map((_, i) => add('feedback', state.question, state.score, state.correct, i));
      }
      if (state.kind === 'feedback') {
        const option = q.options[state.value];
        const question = state.question + 1;
        state.next = add(
          question === data.qs.length ? 'end' : 'question',
          question,
          state.score + (option.points ?? 0),
          state.correct + (data.countsCorrect && option.correct ? 1 : 0),
        );
      }
    }
    for (const state of states) {
      if (state.kind !== 'rated') continue;
      const id = keys.get(['question', state.question, state.score, state.correct, 0].join('/'));
      state.ratings = states[id - 1].ratings;
    }
    const ordered = [];
    const mapping = [];
    states.forEach((state, i) => {
      mapping[i + 1] = ordered.push(state);
      // A timed transition advances to the next physical slide. Insert its exact target.
      if (state.kind === 'feedback' && data.advanceMs) ordered.push(states[state.next - 1]);
    });
    return { states, ordered, mapping };
  }

  function slideTools(ppt, slide, colors, mapping) {
    function jump(id) {
      return id ? { hyperlink: { slide: mapping[id], tooltip: '点击继续' } } : {};
    }
    function box(x, y, w, h, color, border = colors.border, id) {
      slide.addShape(ppt.ShapeType.rect, {
        x, y, w, h, fill: { color }, line: { color: border, width: 0.75 }, ...jump(id),
      });
    }
    function text(value, x, y, w, h, fontSize = 14, settings = {}) {
      if (value === null || value === undefined || value === '') return;
      slide.addText(String(value), {
        x, y, w, h, margin: 0, fontFace: 'Microsoft YaHei', fontSize,
        color: colors.ink, valign: 'mid', fit: 'shrink', ...settings,
      });
    }
    function button(value, x, y, w, h, id, fill = colors.primary, color = colors.ink, size = 14, border) {
      box(x, y, w, h, fill, border, id);
      text(value, x + 0.07, y, w - 0.14, h, size, { bold: true, color, align: 'center', ...jump(id) });
    }
    return { box, text, button, jump };
  }

  function drawHeader(data, score, tools) {
    const { text, button } = tools;
    text(data.brand, 0.38, 0.19, 8.2, 0.47, 23, { bold: true });
    if (data.audience) button(data.audience, 8.86, 0.23, 2.55, 0.38, null, 'FFFFFF', data.c.ink, 11);
    if (data.scored) button('积分 ' + score, 11.51, 0.23, 1.43, 0.38, null, 'FFFFFF', data.c.ink, 11);
  }

  function drawIntro(data, state, cover, slide, tools) {
    const { box, text, button } = tools;
    const { c } = data;
    const panelWidth = cover ? 6.6 : 12.57;
    const innerWidth = panelWidth - 0.72;
    box(0.38, 0.86, panelWidth, 6.23, c.surface);
    text(data.title, 0.74, 1.44, innerWidth, 1.6, 38, { bold: true });
    text(data.intro, 0.74, 3.15, innerWidth, 1.03, 17, { color: c.muted });
    const rules = data.rules.slice(0, 3);
    const ruleWidth = rules.length ? (innerWidth - 0.12 * (rules.length - 1)) / rules.length : 0;
    rules.forEach(([label, description], index) => {
      const x = 0.74 + index * (ruleWidth + 0.12);
      box(x, 4.41, ruleWidth, 1.42, 'FFFFFF');
      text(label, x + 0.1, 4.54, ruleWidth - 0.2, 0.28, 14, { bold: true });
      text(description, x + 0.1, 4.9, ruleWidth - 0.2, 0.76, 11, { color: c.muted });
    });
    button('开始闯关', 0.74, 6.13, 1.85, 0.50, state.start);
    if (cover) slide.addImage({ data: cover, x: 7.19, y: 0.86, w: 5.76, h: 6.23 });
  }

  function drawSummary(data, state, start, tools) {
    const { box, text, button } = tools;
    const { c } = data;
    box(1.55, 0.8, 10.23, 6.25, c.surface);
    text(data.endTitle, 1.92, 1.27, 9.49, 0.76, 32, { bold: true });
    text(data.endCopy, 1.92, 2.10, 9.49, 0.37, 15, { color: c.muted });
    if (data.scored) {
      text(state.score, 1.92, 2.55, 4.0, 0.64, 41, { bold: true });
      text('总积分', 1.92, 3.23, 4.0, 0.26, 13);
    }
    const cards = [['完成关卡', data.levelCount + ' / ' + data.levelCount]];
    if (data.countsCorrect) cards.unshift([data.originalEmotionLayout ? '理性选择' : '正确题数',
      state.correct + ' / ' + data.qs.length]);
    if (data.countsCorrect && data.rank.length) {
      const percent = Math.round(state.correct / data.qs.length * 100);
      const name = data.rank.find(([minimum]) => percent >= minimum)?.[1];
      if (name) cards.push(['成长等级', name]);
    }
    cards.forEach(([label, value], index) => {
      const x = 1.92 + index * 3.16;
      box(x, 3.64, 3.01, 0.86, 'FFFFFF');
      text(label, x + 0.14, 3.74, 2.7, 0.23, 11);
      text(value, x + 0.14, 4.0, 2.7, 0.31, 19, { bold: true });
    });
    if (data.tips.length) {
      box(1.92, 4.68, 9.34, 1.44, 'FFFFFF');
      text('把方法带回校园', 2.08, 4.8, 8.99, 0.29, 16, { bold: true });
      data.tips.slice(0, 3).forEach((tip, i) =>
        text('• ' + tip, 2.08, 5.12 + i * 0.27, 8.99, 0.24, 12));
    }
    button('再玩一次', 1.92, 6.35, 1.5, 0.42, start);
    button('返回说明', 3.54, 6.35, 1.5, 0.42, 1, 'FFFFFF');
  }

  function drawSidebar(data, state, score, tools) {
    const { box, text, button } = tools;
    const { c } = data;
    box(9.25, 0.82, 3.70, 1.46, 'FFFFFF');
    text('闯关进度', 9.42, 0.99, 3.28, 0.29, 16, { bold: true });
    if (data.qs.length <= 12) {
      data.qs.forEach((_, index) => {
        const fill = index < state.question ? c.positive : index === state.question ? c.primary : c.surface;
        const color = index < state.question ? 'FFFFFF' : c.ink;
        const width = Math.min(0.29, 3.21 / data.qs.length);
        button(index + 1, 9.42 + index * 3.32 / data.qs.length, 1.40, width, 0.29, null, fill, color, 8);
      });
    } else {
      box(9.42, 1.48, 3.27, 0.12, c.surface);
      box(9.42, 1.48, 3.27 * (state.question + 1) / data.qs.length, 0.12, c.primary, c.primary);
    }
    if (data.scored) text('积分 ' + score, 9.42, 1.82, 3.25, 0.27, 15, { bold: true });
    if (!data.methods.length) return;
    box(9.25, 2.47, 3.70, 4.69, 'FFFFFF');
    text('情绪工具箱', 9.42, 2.62, 3.28, 0.31, 16, { bold: true });
    data.methods.slice(0, 5).forEach(([label, description], index) => {
      const y = 3.07 + index * 0.76;
      box(9.42, y, 3.34, 0.01, c.border);
      text(label, 9.42, y + 0.08, 3.34, 0.23, 12, { bold: true });
      text(description, 9.42, y + 0.36, 3.34, 0.28, 11, { color: c.muted });
    });
  }

  function feedbackLabel(data, option) {
    if (option.heading) return option.heading;
    if (data.originalEmotionLayout && option.correct !== null) {
      return option.correct ? '这是一种更有效的应对' : '这个做法可能让事情升级';
    }
    return option.correct === null ? '选择反馈' : option.correct ? '回答正确' : '再想一想';
  }

  function drawQuestion(data, state, score, tools) {
    const { box, text, button, jump } = tools;
    const { c } = data;
    const q = data.qs[state.question];
    const feedback = state.kind === 'feedback';
    const rated = state.kind === 'rated';
    const option = feedback ? q.options[state.value] : null;
    const locked = !feedback && !state.answers;
    const accent = feedback && option.correct === false ? c.attention : c.positive;
    const columns = q.options.length > 2 ? 2 : 1;

    box(0.38, 0.82, 8.68, 6.34, c.surface);
    button(q.level, 0.65, 1.04, 4.06, 0.36, null, c.highlight, '18364A', 12);
    text('第 ' + q.progress + ' 题 · 总进度 ' + (state.question + 1) + ' / ' + data.qs.length,
      5.0, 1.04, 3.78, 0.36, 12, { color: c.muted, align: 'right', bold: true });
    text(q.title, 0.65, 1.49, 8.11, 0.49, 25, { bold: true });
    text(q.copy, 0.65, 2.02, 8.11, 0.56, 15, { color: c.muted });

    if (q.emotion !== null) {
      text('情境紧张度参考', 0.65, 2.66, 4, 0.24, 11, { bold: true });
      text(q.emotion + ' / 10', 7.43, 2.66, 1.34, 0.24, 11, { align: 'right' });
      box(0.65, 2.96, 8.10, 0.09, 'FFFFFF');
      box(0.65, 2.96, 8.10 * q.emotion / 10, 0.09, c.primary, c.primary);
      if (!feedback) {
        box(0.65, 3.18, 8.10, 1.78, 'FFFFFF');
        text('先评估一下：此刻我的情绪强度是', 0.82, 3.28, 6, 0.25, 13, { bold: true });
        text(rated ? state.value + ' / 10' : '未选择', 7.14, 3.28, 1.4, 0.25, 12, { align: 'right' });
        state.ratings.forEach((id, index) => {
          const selected = rated && index + 1 === state.value;
          button(index + 1, 0.82 + (index % 5) * 1.55, 3.62 + Math.floor(index / 5) * 0.43, 1.46, 0.34,
            id, selected ? c.highlight : 'FFFFFF', c.ink, 12, selected ? c.positive : c.border);
        });
        text('没有标准答案，请按照你此刻的真实感受选择。', 0.82, 4.55, 7.57, 0.24, 11, { color: c.muted });
      }
    }
    const firstY = feedback ? 3.22 : q.emotion === null ? 3.36 : 5.12;
    const gap = 0.12;
    const width = (8.10 - (columns - 1) * gap) / columns;
    const height = columns === 2 ? 0.62 : 0.61;
    q.options.forEach((item, index) => {
      const x = 0.65 + (index % columns) * (width + gap);
      const y = firstY + Math.floor(index / columns) * (height + 0.09);
      const selected = feedback && index === state.value;
      const fill = selected ? (item.correct === false ? c['error-soft'] : c['success-soft']) : 'FFFFFF';
      const id = state.answers?.[index];
      box(x, y, width, height, fill, selected ? accent : c.border, id);
      button(String.fromCharCode(65 + index), x + 0.13, y + 0.12, 0.36, 0.36, id, c.primary, c.ink, 12);
      text(item.text, x + 0.63, y + 0.05, width - 0.78, height - 0.10, columns === 2 ? 11 : 13, {
        bold: true, color: locked ? c.muted : c.ink, ...jump(id),
      });
    });

    if (feedback) {
      box(0.65, 4.67, 8.10, 1.72, 'FFFFFF');
      box(0.65, 4.67, 0.07, 1.72, accent, accent);
      text(feedbackLabel(data, option), 0.85, 4.75, 7.66, 0.31, 16, { bold: true, color: accent });
      text(option.result, 0.85, 5.09, 7.66, option.tip ? 0.45 : 0.89, 13);
      if (option.tip) text((data.originalEmotionLayout ? '情绪调节提示：' : '') + option.tip,
        0.85, 5.56, 7.66, 0.46, 13);
      if (data.scored) {
        const label = option.points ? (option.points > 0 ? '+' : '') + option.points + ' 分' : '本题不加分';
        text(label, 0.85, 6.08, 3.0, 0.23, 12, { bold: true, color: accent });
      }
      if (data.advanceMs) {
        text((data.advanceMs / 1000) + ' 秒后继续', 0.65, 6.60, 4, 0.29, 11, { color: c.muted });
      }
      button(state.question + 1 === data.qs.length ? '查看结果' : '下一题',
        6.99, 6.56, 1.76, 0.41, state.next);
    } else {
      text(locked ? '请先评估情绪强度，再选择应对方式。' : '请选择一个选项。',
        0.65, 6.66, 8.06, 0.25, 12, { color: c.muted });
    }
    drawSidebar(data, state, score, tools);
  }

  async function exportPptx(data, cover, Pptx, Zip, onProgress = () => {}) {
    const { states, ordered, mapping } = plan(data);
    const ppt = new Pptx();
    ppt.layout = 'LAYOUT_WIDE';
    ppt.title = data.brand;
    ppt.subject = '互动教学课件';
    for (const [index, state] of ordered.entries()) {
      if (index % 40 === 0) onProgress(Math.round(index / ordered.length * 65), '正在生成互动页面');
      const slide = ppt.addSlide();
      slide.background = { color: data.c.canvas };
      const tools = slideTools(ppt, slide, data.c, mapping);
      const score = state.kind === 'feedback'
        ? state.score + (data.qs[state.question].options[state.value].points ?? 0) : state.score ?? 0;
      drawHeader(data, score, tools);
      if (state.kind === 'intro') drawIntro(data, state, cover, slide, tools);
      else if (state.kind === 'end') drawSummary(data, state, states[0].start, tools);
      else drawQuestion(data, state, score, tools);
    }
    onProgress(66, '正在打包 PPT');
    const zip = await Zip.loadAsync(await ppt.write({ outputType: 'arraybuffer' }));
    await Promise.all(ordered.map(async (state, index) => {
      const path = 'ppt/slides/slide' + (index + 1) + '.xml';
      const xml = await zip.file(path).async('string');
      const fade = state.kind === 'feedback';
      const delay = fade && data.advanceMs ? ' advTm="' + data.advanceMs + '"' : '';
      const transition = fade
        ? '<p:transition spd="fast" advClick="0"' + delay + '><p:fade/></p:transition>'
        : '<p:transition advClick="0"/>';
      zip.file(path, xml.replace('</p:sld>', transition + '</p:sld>'));
    }));
    const props = 'ppt/presProps.xml';
    const propsXml = await zip.file(props).async('string');
    const show = '<p:showPr useTimings="' + (data.advanceMs ? '1' : '0') + '"><p:kiosk/><p:sldAll/></p:showPr>';
    zip.file(props, propsXml.includes('</p:presentationPr>')
      ? propsXml.replace('</p:presentationPr>', show + '</p:presentationPr>')
      : propsXml.replace(/(<p:presentationPr[^>]*?)\s*\/>/, '$1>' + show + '</p:presentationPr>'));

    // PptxGenJS includes declarations for slide masters not referenced by this deck.
    const typePath = '[Content_Types].xml';
    const types = await zip.file(typePath).async('string');
    zip.file(typePath, types.replace(/<Override\b[^>]*\bPartName="(\/ppt\/slideMasters\/slideMaster\d+\.xml)"[^>]*\/>/g,
      (entry, part) => zip.file(part.slice(1)) ? entry : ''));
    const bytes = await zip.generateAsync(
      { type: 'arraybuffer', compression: 'DEFLATE', compressionOptions: { level: 3 } },
      ({ percent }) => onProgress(72 + Math.floor(percent * 0.27), '正在压缩 PPT'),
    );
    return { bytes, pages: ordered.length, mime: MIME };
  }

  global.LessonPptx = { plan, exportPptx };
})(globalThis);

