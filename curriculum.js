(function (global) {
  'use strict';

  const MAX_PAGES_PER_SECTION = 5;
  const WIDTH = 1920;
  const HEIGHT = 1080;
  const clean = (value, length) => typeof value === 'string' ? value.trim().slice(0, length) : '';
  const page = value => ({ title: clean(value?.title, 48), body: clean(value?.body, 270) });

  function normalize(raw) {
    function section(key, fallback) {
      if (!Array.isArray(raw?.[key])) return [];
      return raw[key].slice(0, MAX_PAGES_PER_SECTION).map(page)
        .filter(item => item.title || item.body).map(item => ({ ...item, title: item.title || fallback }));
    }
    return { before: section('before', '课堂导入'), after: section('after', '课堂拓展') };
  }

  function lightLesson(data) {
    return {
      ...data, scoringEnabled: false, scored: false, countsCorrect: false, rank: [],
      qs: data.qs.map(q => !q.options ? q : { ...q, options: q.options.map(o => ({ ...o, points: null })) }),
    };
  }

  function button(doc, position = 'classroom-continue') {
    const el = doc.createElement('button');
    el.className = 'classroom-continue';
    el.id = position;
    el.type = 'button';
    el.textContent = '继续上课';
    return el;
  }

  function surround(plan, content) {
    const { before, after } = normalize(content);
    const offset = before.length;
    const firstAfter = offset + plan.slides.length + 1;
    function classroomPage(item, phase, next, label) {
      return { name: item.title, teaching: { ...item, phase, next, label }, layers: [], hits: [] };
    }
    return {
      ...plan,
      slides: [
        ...before.map((item, index) => classroomPage(item, 'before', index + 2,
          index === before.length - 1 ? '进入互动' : '下一页')),
        ...plan.slides.map(slide => ({ ...slide, hits: slide.hits.map(hit => ({
          ...hit, target: hit.target === 'classroom' ? firstAfter : hit.target + offset,
        })) })),
        ...after.map((item, index) => classroomPage(item, 'after',
          index + 1 === after.length ? offset + 1 : firstAfter + index + 1,
          index + 1 === after.length ? '回到活动' : '下一页')),
      ],
    };
  }

  function drawTeaching(ppt, slide, item, colors) {
    const c = { canvas: 'F4F0E7', surface: 'FBF9F4', ink: '24231F', muted: '625C51', primary: '68766A', border: 'D9D2C5', ...colors };
    slide.background = { color: c.canvas };
    slide.addShape(ppt.ShapeType.roundRect, {
      x: 0.62, y: 0.70, w: 12.08, h: 6.10, radius: 0.26, rectRadius: 0.26,
      fill: { color: c.surface }, line: { color: c.border, width: 0.7 },
    });
    const addText = (value, opts) => slide.addText(value, { fontFace: 'Microsoft YaHei', margin: 0, color: c.ink, ...opts });
    addText(item.phase === 'before' ? '课前导入' : '课堂拓展', {
      x: 1.12, y: 1.12, w: 10.5, h: 0.38, fontSize: 15, bold: true, color: c.muted,
    });
    addText(item.title, {
      x: 1.12, y: 1.65, w: 10.95, h: 1.24, fontSize: 34, minFontSize: 23, fit: 'shrink', bold: true, valign: 'mid',
    });
    addText(item.body, {
      x: 1.12, y: 3.03, w: 10.95, h: 2.20, fontSize: 19, minFontSize: 13,
      paraSpaceAfterPt: 7, fit: 'shrink', valign: 'top',
    });
    const hyperlink = { slide: item.next };
    slide.addShape(ppt.ShapeType.roundRect, {
      x: 1.12, y: 5.71, w: 1.72, h: 0.51, fill: { color: c.ink },
      line: { color: c.ink }, hyperlink,
    });
    addText(item.label, {
      x: 1.12, y: 5.71, w: 1.72, h: 0.51, fontSize: 14, bold: true, align: 'center', color: 'FFFFFF',
    });
    slide.addShape(ppt.ShapeType.rect, {
      x: 1.12, y: 5.71, w: 1.72, h: 0.51,
      fill: { color: 'FFFFFF', transparency: 100 }, line: { transparency: 100 }, hyperlink,
    });
  }

  function readProject(payload) {
    if (payload?.version !== 2) return null;
    const pages = normalize(payload.pages);
    const source = typeof payload.source === 'string' && payload.source.length <= 1500000 ? payload.source : '';
    return {
      pages, source, mode: payload.mode === 'light' ? 'light' : 'full', auto: payload.auto !== false,
    };
  }

  global.Curriculum = { WIDTH, HEIGHT, MAX_PAGES_PER_SECTION, normalize, lightLesson, button, surround, drawTeaching, readProject };
})(globalThis);
