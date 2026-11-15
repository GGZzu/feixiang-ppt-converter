(function (global) {
  'use strict';

  const WIDTH = 960;
  const HEIGHT = 540;
  const SCALE = 72;
  const get = id => document.getElementById(id);
  const unit = value => (value ?? 0) * SCALE;
  const colors = value => '#' + (/^[\da-f]{6}$/i.test(value ?? '') ? value : 'FFFFFF');
  const shapeTypes = new Proxy({}, { get: (_, name) => name });
  const label = (tag, value) => {
    const node = document.createElement(tag);
    node.textContent = value;
    return node;
  };

  function draw(page) {
    const items = [];
    const slide = {
      addText(value, options) { items.push({ kind: 'text', value, options }); },
      addShape(value, options) { items.push({ kind: 'shape', value, options }); },
      addImage(options) { items.push({ kind: 'image', options }); },
    };
    page.draw({ ShapeType: shapeTypes }, slide);
    const allLinks = items.filter(item => item.options.hyperlink?.slide);
    const links = [];
    for (const item of allLinks) {
      const { x, y, w, h, hyperlink } = item.options;
      const inside = items.find(({ kind, options }) => kind === 'text' &&
        Math.abs(options.y - y) < 0.05 && Math.abs(options.h - h) < 0.05 &&
        options.x >= x - 0.03 && options.x + options.w <= x + w + 0.03);
      const caption = inside?.value || '前往下一页';
      if (item.kind === 'text' && allLinks.some(other => other.kind === 'shape' &&
        other.options.hyperlink.slide === hyperlink.slide && Math.abs(other.options.y - y) < 0.05 &&
        Math.abs(other.options.h - h) < 0.05 && x >= other.options.x - 0.03 &&
        x + w <= other.options.x + other.options.w + 0.03)) continue;
      if (!links.some(link => link.x === x && link.y === y && link.target === hyperlink.slide)) {
        links.push({ x, y, w, h, name: caption, target: hyperlink.slide });
      }
    }
    return { items, links, color: slide.background?.color };
  }

  function native(pages) {
    return pages.map(page => ({ ...page, drawNative: () => draw(page) }));
  }

  function wide(plan) {
    const mx = WIDTH / plan.width;
    const my = HEIGHT / plan.height;
    const area = item => ({ ...item, x: item.x * mx, y: item.y * my, w: item.w * mx, h: item.h * my });
    return plan.slides.map(slide => {
      if (slide.teaching) {
        return { kind: 'teaching', name: slide.name, drawNative: () => draw({
          draw: (ppt, canvas) => Curriculum.drawTeaching(ppt, canvas, slide.teaching, plan.colors),
        }) };
      }
      return { kind: slide.kind, name: slide.name, layers: slide.layers.map(area), hits: slide.hits.map(area),
        ms: slide.auto ? plan.advanceMs : 0, hideMs: plan.hideMs };
    });
  }

  function rectangle(node, area, scale = 1) {
    node.style.left = (area.x ?? 0) * scale + 'px';
    node.style.top = (area.y ?? 0) * scale + 'px';
    node.style.width = (area.w ?? 0) * scale + 'px';
    node.style.height = (area.h ?? 0) * scale + 'px';
  }

  function renderNative(art, appearance) {
    art.style.background = colors(appearance.color);
    for (const { kind, options: o, value } of appearance.items) {
      let node;
      if (kind === 'shape') {
        node = document.createElement('div');
        if (o.fill?.transparency !== 100) node.style.background = colors(o.fill?.color);
        if (o.line && o.line.transparency !== 100) {
          node.style.border = Math.max(0.5, o.line.width ?? 1) + 'px solid ' + colors(o.line.color);
        }
        if (value === 'roundRect') node.style.borderRadius = Math.min(unit(o.w) / 2, unit(o.h) / 2, unit(o.rectRadius ?? 0.12)) + 'px';
        if (value === 'ellipse') node.style.borderRadius = '50%';
      } else if (kind === 'image') {
        node = document.createElement('img');
        node.alt = '';
        node.className = 'slide-media';
        node.src = o.data;
      } else {
        node = document.createElement('div');
        node.className = 'slide-copy';
        node.style.color = colors(o.color);
        node.style.alignItems = o.valign === 'top' ? 'start' : 'center';
        const span = label('span', value);
        span.style.fontWeight = o.bold ? '700' : '400';
        span.style.textAlign = o.align ?? 'left';
        node.append(span);
        const size = o.fontSize ?? 14;
        span.style.fontSize = size + 'px';
        span.style.lineHeight = '1.17';
        rectangle(node, o, SCALE);
        art.append(node);
        if (o.fit === 'shrink') {
          for (let pt = size - 1; span.scrollHeight > unit(o.h) + 1 && pt >= (o.minFontSize ?? size * 0.68); pt--) {
            span.style.fontSize = pt + 'px';
          }
        }
        continue;
      }
      rectangle(node, o, SCALE);
      art.append(node);
    }
  }

  function inspect(pages, imageCount) {
    if (!pages.length) throw Error('课件没有可放映的页面。');
    const broken = [];
    const routes = [];
    let linkCount = 0;
    let mediaCount = 0;
    for (const [index, page] of pages.entries()) {
      const links = page.drawNative ? page.drawNative().links : page.hits;
      linkCount += links.length;
      const media = page.layers ?? [];
      mediaCount += media.length;
      if (links.some(link => !Number.isInteger(link.target) || link.target < 1 || link.target > pages.length) ||
          media.some(layer => !Number.isInteger(layer.image) || layer.image < 1 || layer.image > imageCount) ||
          (page.ms && index + 1 === pages.length)) broken.push(index + 1);
      routes.push(links.map(link => link.target - 1));
      if (page.ms) routes[index].push(index + 1);
    }
    const reached = new Set([0]);
    for (const index of reached) {
      for (const next of routes[index]) if (pages[next]) reached.add(next);
    }
    const afterClassroom = pages.at(-1).kind === 'teaching';
    const canFinish = afterClassroom ? reached.has(pages.length - 1)
      : [...reached].some(index => ['end', 'wrap', 'done'].includes(pages[index].kind));
    return { pageCount: pages.length, linkCount, mediaCount, broken, canFinish };
  }

  function mount(pages, plan, heading) {
    const frame = get('trial-frame');
    const stages = get('trial-stage');
    const back = get('trial-back');
    const reset = get('trial-reset');
    const status = get('trial-status');
    const urls = new Map();
    const history = [];
    let index = 0;
    let timer;
    let effectTimer;
    let art;
    const observer = new ResizeObserver(() => drawSize());
    function drawSize() {
      if (art) art.style.transform = 'scale(' + frame.clientWidth / WIDTH + ')';
    }
    function addHit(item, scale) {
      const hit = label('button', '');
      hit.type = 'button';
      hit.className = 'trial-hit';
      hit.setAttribute('aria-label', item.name || '继续');
      rectangle(hit, item, scale);
      hit.addEventListener('click', event => move(item.target - 1, event.detail === 0));
      art.append(hit);
    }
    function render(focus = false) {
      clearTimeout(timer);
      clearTimeout(effectTimer);
      const page = pages[index];
      art = label('div', '');
      art.className = 'trial-art' + (page.kind === 'feedback' ? ' trial-fade' : '');
      frame.replaceChildren(art);
      frame.tabIndex = -1;
      drawSize();
      if (page.drawNative) {
        const appearance = page.drawNative();
        renderNative(art, appearance);
        for (const hit of appearance.links) addHit(hit, SCALE);
      } else {
        for (const item of page.layers) {
          if (!urls.has(item.image)) {
            urls.set(item.image, URL.createObjectURL(new Blob([plan.media[item.image - 1]], { type: 'image/png' })));
          }
          const img = label('img', '');
          img.alt = '';
          img.className = 'slide-media' + (item.effect === 'wipe' ? ' trial-wipe' :
            item.effect === 'fade' || item.effect === 'toast' ? ' trial-fade' : '');
          img.src = urls.get(item.image);
          rectangle(img, item);
          art.append(img);
          if (page.hideMs && item.effect === 'toast') effectTimer = setTimeout(() => { img.hidden = true; }, page.hideMs);
        }
        for (const hit of page.hits) addHit(hit, 1);
      }
      back.disabled = !history.length;
      stages.value = [...stages.options].findLast(option => option.textContent === page.name)?.value ?? '0';
      status.textContent = heading + ' · ' + page.name + (page.ms ? ' · ' + page.ms / 1000 + ' 秒后继续' : '');
      if (page.ms && index + 1 < pages.length) timer = setTimeout(() => move(index + 1), page.ms);
      if (focus) frame.focus();
    }
    function move(next, focus) {
      if (!pages[next] || next === index) return;
      history.push(index);
      index = next;
      render(focus);
    }
    const seen = new Set();
    const choices = [];
    for (const [i, page] of pages.entries()) {
      if (seen.has(page.name)) continue;
      seen.add(page.name);
      const option = label('option', page.name);
      option.value = i;
      choices.push(option);
    }
    stages.replaceChildren(...choices);
    stages.disabled = reset.disabled = false;
    stages.onchange = () => move(Number(stages.value));
    back.onclick = () => {
      index = history.pop() ?? index;
      render();
    };
    reset.onclick = () => {
      history.length = 0;
      index = 0;
      render();
    };
    observer.observe(frame);
    render();
    return () => {
      clearTimeout(timer);
      clearTimeout(effectTimer);
      observer.disconnect();
      for (const url of urls.values()) URL.revokeObjectURL(url);
      frame.replaceChildren();
      stages.replaceChildren();
      stages.disabled = back.disabled = reset.disabled = true;
    };
  }

  global.PptxTrial = { native, wide, inspect, mount };
})(globalThis);
