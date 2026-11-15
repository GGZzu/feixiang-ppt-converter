(function (global) {
  'use strict';

  const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
  const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const RELS = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const TYPES = 'http://schemas.openxmlformats.org/package/2006/content-types';
  const PRES = 'ppt/presentation.xml';
  const MANIFEST = '[Content_Types].xml';
  const MAX_PACKED = 80 * 1024 * 1024;
  const MAX_EXPANDED = 210 * 1024 * 1024;
  const parser = new DOMParser();
  const serializer = new XMLSerializer();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const elements = (root, ns, name) => [...root.getElementsByTagNameNS(ns, name)];
  const first = (root, ns, name) => root.getElementsByTagNameNS(ns, name)[0];
  const folder = part => part.slice(0, part.lastIndexOf('/') + 1);
  const basename = part => part.slice(part.lastIndexOf('/') + 1);
  const relPath = part => folder(part) + '_rels/' + basename(part) + '.rels';

  function unzip(bytes) {
    if (bytes.length > MAX_PACKED) throw Error('请选择不超过 80 MB 的 PPTX。');
    let size = 0;
    let count = 0;
    return fflate.unzipSync(bytes, {
      filter(entry) {
        size += entry.originalSize;
        count++;
        if (size > MAX_EXPANDED || count > 20000) throw Error('课件解包后太大。可以拆成较小的文件再合并。');
        if (entry.name.split('/').includes('..') || entry.name.startsWith('/') || entry.name.includes('\\')) {
          throw Error('课件内部文件路径无效。');
        }
        return !entry.name.endsWith('/');
      },
    });
  }

  function parse(text) {
    if (/<!DOCTYPE/i.test(text)) throw Error('无法读取此 PPTX 的 XML。');
    const doc = parser.parseFromString(text, 'application/xml');
    if (doc.querySelector('parsererror')) throw Error('无法读取此 PPTX 的 XML。');
    return doc;
  }

  function readXml(parts, part) {
    if (!Object.hasOwn(parts, part)) throw Error('PPTX 缺少必要的页面数据。');
    return parse(decoder.decode(parts[part]));
  }

  function writeXml(parts, part, doc) {
    parts[part] = encoder.encode(serializer.serializeToString(doc));
  }

  function add(parent, ns, name, attributes = {}) {
    const node = parent.ownerDocument.createElementNS(ns, name);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    parent.append(node);
    return node;
  }

  function resolve(part, target) {
    const value = decodeURIComponent(target);
    const output = [];
    for (const segment of (value.startsWith('/') ? value : folder(part) + value).split('/')) {
      if (segment === '..') {
        if (!output.length) throw Error('PPTX 的关系路径无效。');
        output.pop();
      } else if (segment && segment !== '.') output.push(segment);
    }
    return output.join('/');
  }

  function relative(part, target) {
    const from = folder(part).split('/').filter(Boolean);
    const to = target.split('/');
    while (from.length && from[0] === to[0]) {
      from.shift();
      to.shift();
    }
    return '../'.repeat(from.length) + to.map(encodeURIComponent).join('/');
  }

  function slidesOf(parts) {
    const doc = readXml(parts, PRES);
    const rels = readXml(parts, relPath(PRES));
    if (doc.documentElement.namespaceURI !== P) throw Error('请在 WPS 或 PowerPoint 中将课件另存为常规 PPTX。');
    const links = new Map(elements(rels, RELS, 'Relationship').map(link => [link.getAttribute('Id'), link]));
    const list = first(doc, P, 'sldIdLst');
    const slides = list ? elements(list, P, 'sldId').map(item => {
      const link = links.get(item.getAttributeNS(R, 'id'));
      if (link?.getAttribute('Type') !== R + '/slide') throw Error('课件的页面关系无法读取。');
      return { id: Number(item.getAttribute('id')), path: resolve(PRES, link.getAttribute('Target')) };
    }) : [];
    const size = first(doc, P, 'sldSz');
    const width = Number(size?.getAttribute('cx'));
    const height = Number(size?.getAttribute('cy'));
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
        width <= 0 || height <= 0 || Math.abs(width * 9 / (height * 16) - 1) > 0.002) {
      throw Error('合并支持 16:9 宽屏。请在 WPS 里把原课件另存为 16:9 后再选。');
    }
    if (!slides.length) throw Error('这份 PPTX 里没有幻灯片。');
    return { doc, rels, slides, list, width, height };
  }

  async function open(file) {
    if (!/\.pptx$/i.test(file?.name ?? '')) throw Error('请选择已有的 .pptx 文件。');
    if (file.size > MAX_PACKED) throw Error('请选择不超过 80 MB 的 PPTX。');
    let parts;
    try {
      parts = unzip(new Uint8Array(await file.arrayBuffer()));
    } catch (error) {
      throw Error(/课件/.test(error.message) ? error.message : '无法打开 PPTX。请将课件另存为无密码的常规 PPTX。');
    }
    if (Object.keys(parts).some(path => path.startsWith('_xmlsignatures/'))) throw Error('请使用未签名的课件副本。');
    const info = slidesOf(parts);
    const labels = info.slides.map(({ path }, index) => {
      const doc = readXml(parts, path);
      const title = first(doc, P, 'cSld')?.getAttribute('name') ||
        elements(doc, A, 't').find(t => t.textContent.trim())?.textContent || '无标题';
      return '第 ' + (index + 1) + ' 页 · ' + title.trim().slice(0, 56);
    });
    return { parts, labels };
  }

  function readRels(parts, part) {
    return Object.hasOwn(parts, relPath(part)) ? readXml(parts, relPath(part))
      : parse('<Relationships xmlns="' + RELS + '"/>');
  }

  function attach(rels, type, part, target) {
    const ids = new Set(elements(rels, RELS, 'Relationship').map(node => node.getAttribute('Id')));
    let index = ids.size + 1;
    while (ids.has('rId' + index)) index++;
    const id = 'rId' + index;
    add(rels.documentElement, RELS, 'Relationship', { Id: id, Type: R + '/' + type, Target: relative(part, target) });
    return id;
  }

  function appendButton(doc, relId, width, height, position) {
    const tree = first(doc, P, 'spTree');
    if (!tree) throw Error('无法在所选页面添加入口按钮。');
    const id = 1 + Math.max(1, ...elements(tree, P, 'cNvPr').map(node => Number(node.getAttribute('id'))));
    const w = Math.round(width * 0.157);
    const h = Math.round(height * 0.071);
    const margin = Math.round(width * 0.027);
    const x = position.endsWith('left') ? margin : width - margin - w;
    const y = position.startsWith('top') ? margin : height - margin - h;
    const shape = add(tree, P, 'p:sp');
    const ext = [...tree.children].find(node => node.localName === 'extLst');
    if (ext) tree.insertBefore(shape, ext);
    const nv = add(shape, P, 'p:nvSpPr');
    const props = add(nv, P, 'p:cNvPr', { id, name: '进入互动' });
    add(props, A, 'a:hlinkClick', { action: 'ppaction://hlinksldjump' }).setAttributeNS(R, 'r:id', relId);
    add(nv, P, 'p:cNvSpPr');
    add(nv, P, 'p:nvPr');
    const sp = add(shape, P, 'p:spPr');
    const transform = add(sp, A, 'a:xfrm');
    add(transform, A, 'a:off', { x, y });
    add(transform, A, 'a:ext', { cx: w, cy: h });
    add(add(sp, A, 'a:prstGeom', { prst: 'roundRect' }), A, 'a:avLst');
    add(add(sp, A, 'a:solidFill'), A, 'a:srgbClr', { val: '165344' });
    add(add(sp, A, 'a:ln'), A, 'a:noFill');
    const body = add(shape, P, 'p:txBody');
    add(body, A, 'a:bodyPr', { anchor: 'ctr', lIns: 0, rIns: 0, tIns: 0, bIns: 0 });
    add(body, A, 'a:lstStyle');
    const paragraph = add(body, A, 'a:p');
    add(paragraph, A, 'a:pPr', { algn: 'ctr' });
    const run = add(paragraph, A, 'a:r');
    const copy = add(run, A, 'a:rPr', { lang: 'zh-CN', sz: Math.round(1500 * width / 12192000), b: 1 });
    add(add(copy, A, 'a:solidFill'), A, 'a:srgbClr', { val: 'FFFFFF' });
    add(copy, A, 'a:ea', { typeface: 'Microsoft YaHei' });
    add(run, A, 'a:t').textContent = '进入互动';
  }

  function resize(doc, scale) {
    if (Math.abs(scale - 1) < 0.0001) return;
    function scaleAttrs(node, fields) {
      for (const key of fields) {
        if (node.hasAttribute(key)) node.setAttribute(key, Math.round(Number(node.getAttribute(key)) * scale));
      }
    }
    for (const box of elements(doc, A, 'xfrm')) {
      for (const child of box.children) {
        if (child.localName === 'off' || child.localName === 'chOff') scaleAttrs(child, ['x', 'y']);
        if (child.localName === 'ext' || child.localName === 'chExt') scaleAttrs(child, ['cx', 'cy']);
      }
    }
    for (const name of ['rPr', 'defRPr', 'endParaRPr']) {
      for (const font of elements(doc, A, name)) scaleAttrs(font, ['sz']);
    }
    for (const name of ['bodyPr', 'ln', 'spcPts', 'pPr']) {
      for (const item of elements(doc, A, name)) {
        scaleAttrs(item, ['lIns', 'rIns', 'tIns', 'bIns', 'w', 'val', 'marL', 'marR', 'indent']);
      }
    }
  }

  function merge(base, activityBytes, entry, back, position) {
    const target = { ...base.parts };
    const source = unzip(new Uint8Array(activityBytes));
    const old = slidesOf(target);
    const activity = slidesOf(source);
    const from = old.slides[entry]?.path;
    const returnTo = old.slides[back]?.path;
    if (!from || !returnTo) throw Error('请重新选择入口页和返回页。');
    const originals = new Set(Object.keys(target));
    const moved = new Map();
    const jobs = [];
    const fromTypes = readXml(source, MANIFEST);
    const toTypes = readXml(target, MANIFEST);
    const overrides = new Map(elements(fromTypes, TYPES, 'Override').map(node => [
      decodeURIComponent(node.getAttribute('PartName').slice(1)), node.getAttribute('ContentType'),
    ]));
    const defaults = new Map(elements(fromTypes, TYPES, 'Default').map(node => [node.getAttribute('Extension'), node.getAttribute('ContentType')]));
    const counters = new Map();
    function allocate(path) {
      if (moved.has(path)) return moved.get(path);
      if (!Object.hasOwn(source, path)) throw Error('互动页面缺少必要的资源。');
      const standard = /^(slide|slideLayout|slideMaster|theme)\d+\.xml$/.exec(basename(path));
      const prefix = folder(path) + (standard?.[1] ?? 'activity');
      let counter = counters.get(prefix) ?? 0;
      let name;
      do {
        counter++;
        name = prefix + counter + (standard ? '.xml' : '-' + basename(path));
      } while (originals.has(name) || originals.has(relPath(name)));
      counters.set(prefix, counter);
      originals.add(name);
      moved.set(path, name);
      jobs.push(path);
      const type = overrides.get(path) ?? defaults.get(path.split('.').at(-1));
      if (!type) throw Error('互动页面的资源类型无法读取。');
      add(toTypes.documentElement, TYPES, 'Override', { PartName: '/' + name, ContentType: type });
      return name;
    }
    const firstActivity = allocate(activity.slides[0].path);
    const lastActivity = activity.slides.at(-1).path;
    const masters = [];
    let masterId = 2147483647;
    for (const item of elements(old.doc, P, 'sldMasterId')) {
      masterId = Math.max(masterId, Number(item.getAttribute('id')));
      const relationId = item.getAttributeNS(R, 'id');
      const relation = elements(old.rels, RELS, 'Relationship').find(node => node.getAttribute('Id') === relationId);
      if (!relation) continue;
      const master = readXml(target, resolve(PRES, relation.getAttribute('Target')));
      for (const layout of elements(master, P, 'sldLayoutId')) masterId = Math.max(masterId, Number(layout.getAttribute('id')));
    }
    let slideId = Math.max(255, ...old.slides.map(item => item.id));
    for (const slide of activity.slides) {
      const path = allocate(slide.path);
      const id = attach(old.rels, 'slide', PRES, path);
      add(old.list, P, 'p:sldId', { id: ++slideId }).setAttributeNS(R, 'r:id', id);
    }
    let linkedReturn = false;
    const scale = old.width / activity.width;
    for (const path of jobs) {
      const newPath = moved.get(path);
      const rels = readRels(source, path);
      for (const link of elements(rels, RELS, 'Relationship')) {
        const type = link.getAttribute('Type');
        if (type === R + '/notesSlide') {
          link.remove();
        } else if (link.getAttribute('TargetMode') !== 'External') {
          const isReturn = path === lastActivity && type === R + '/slide';
          const next = isReturn ? returnTo : allocate(resolve(path, link.getAttribute('Target')));
          link.setAttribute('Target', relative(newPath, next));
          if (isReturn) linkedReturn = true;
        }
      }
      if (rels.documentElement.children.length) writeXml(target, relPath(newPath), rels);
      if (/^ppt\/(slides|slideLayouts|slideMasters)\/[^/]+\.xml$/.test(path)) {
        const doc = readXml(source, path);
        resize(doc, scale);
        if (path.startsWith('ppt/slides/')) doc.documentElement.setAttribute('show', '0');
        if (path.startsWith('ppt/slideMasters/')) {
          masters.push(newPath);
          for (const layout of elements(doc, P, 'sldLayoutId')) layout.setAttribute('id', ++masterId);
        }
        writeXml(target, newPath, doc);
      } else target[newPath] = source[path];
    }
    if (!linkedReturn) throw Error('无法给活动设置返回页。');
    let masterList = first(old.doc, P, 'sldMasterIdLst');
    if (!masterList) {
      masterList = add(old.doc.documentElement, P, 'p:sldMasterIdLst');
      old.doc.documentElement.prepend(masterList);
    }
    for (const path of masters) {
      const id = attach(old.rels, 'slideMaster', PRES, path);
      add(masterList, P, 'p:sldMasterId', { id: ++masterId }).setAttributeNS(R, 'r:id', id);
    }
    const entryDoc = readXml(target, from);
    const entryRels = readRels(target, from);
    appendButton(entryDoc, attach(entryRels, 'slide', from, firstActivity), old.width, old.height, position);
    writeXml(target, from, entryDoc);
    writeXml(target, relPath(from), entryRels);
    writeXml(target, PRES, old.doc);
    writeXml(target, relPath(PRES), old.rels);
    writeXml(target, MANIFEST, toTypes);
    const metadata = 'docProps/app.xml';
    if (Object.hasOwn(target, metadata)) {
      const doc = readXml(target, metadata);
      const count = first(doc, doc.documentElement.namespaceURI, 'Slides');
      const hidden = first(doc, doc.documentElement.namespaceURI, 'HiddenSlides');
      if (count) count.textContent = old.slides.length + activity.slides.length;
      if (hidden) hidden.textContent = (Number(hidden.textContent) || 0) + activity.slides.length;
      writeXml(target, metadata, doc);
    }
    const files = Object.entries(target).map(([path, bytes]) => [path,
      /\.(?:png|jpe?g|gif|webp|mp[34]|mov|wm[av]|zip)$/i.test(path) ? [bytes, { level: 0 }] : bytes,
    ]);
    return fflate.zipSync(Object.fromEntries(files), { level: 4 });
  }

  global.PptxComposer = { open, merge };
})(globalThis);
