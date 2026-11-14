'use strict';

importScripts('./pptxgen.bundle.js');

const HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const OFFICE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE = 'http://schemas.openxmlformats.org/package/2006/relationships';
const SLIDE_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml';
const MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const escapeXml = value => String(value).replace(/[&<>"'\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,
  ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[ch] || '');
const rel = (id, type, target) => '<Relationship Id="' + id + '" Type="' + OFFICE + '/' + type + '" Target="' + target + '"/>';
const tags = (tag, xml) => '<' + tag + '>' + xml + '</' + tag + '>';

function timing(spid, hideMs, height) {
  const target = '<p:tgtEl><p:spTgt spid="' + spid + '"/></p:tgtEl>';
  const time = (id, duration, fill = '') => '<p:cTn id="' + id + '" dur="' + duration + '"' + fill + '/>';
  const cond = delay => '<p:stCondLst><p:cond delay="' + delay + '"/></p:stCondLst>';
  const behavior = (timeNode, attrs = '') => tags('p:cBhvr', timeNode + target + attrs);
  const visibility = (id, delay, value) => tags('p:set', behavior(
    '<p:cTn id="' + id + '" dur="1" fill="hold">' + cond(delay) + '</p:cTn>',
    tags('p:attrNameLst', tags('p:attrName', 'style.visibility'))) +
    '<p:to><p:strVal val="' + value + '"/></p:to>');
  const fade = (id, direction) => '<p:animEffect transition="' + direction + '" filter="fade">' +
    behavior(time(id, 250)) + '</p:animEffect>';
  const movement = (id, outward) => {
    const dy = (20 / height).toFixed(8);
    const path = outward ? 'M 0 0 L 0 ' + dy + ' E' : 'M 0 ' + dy + ' L 0 0 E';
    return '<p:animMotion origin="layout" path="' + path + '" pathEditMode="relative">' +
      behavior(time(id, 250, ' fill="hold"'),
        tags('p:attrNameLst', tags('p:attrName', 'ppt_x') + tags('p:attrName', 'ppt_y'))) + '</p:animMotion>';
  };
  // Use an "after previous" exit so WPS respects the toast's visible time.
  const group = (id, effectId, entrance, children) => tags('p:par',
    '<p:cTn id="' + id + '" fill="hold">' + cond(entrance ? 0 : 500) + tags('p:childTnLst', tags('p:par',
      '<p:cTn id="' + effectId + '" presetID="10" presetClass="' + (entrance ? 'entr' : 'exit') +
      '" presetSubtype="0" fill="hold" grpId="' + Number(!entrance) + '" nodeType="' +
      (entrance ? 'withEffect' : 'afterEffect') + '">' +
      cond(entrance ? 0 : hideMs - 250) + tags('p:childTnLst', children) + '</p:cTn>')) + '</p:cTn>');
  const effects = group(4, 5, true, visibility(6, 0, 'visible') + fade(7, 'in') + movement(8, false)) +
    group(9, 10, false, fade(11, 'out') + movement(12, true) + visibility(13, 250, 'hidden'));
  const clickGroup = tags('p:par', '<p:cTn id="3" fill="hold"><p:stCondLst><p:cond delay="indefinite"/>' +
    '<p:cond evt="onBegin" delay="0"><p:tn val="2"/></p:cond></p:stCondLst>' + tags('p:childTnLst', effects) + '</p:cTn>');
  const condition = (tag, event) => tags(tag, '<p:cond evt="' + event + '" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond>');
  const sequence = '<p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq">' +
    tags('p:childTnLst', clickGroup) + '</p:cTn>' + condition('p:prevCondLst', 'onPrev') +
    condition('p:nextCondLst', 'onNext') + '</p:seq>';
  return tags('p:timing', tags('p:tnLst', tags('p:par',
    '<p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot">' + tags('p:childTnLst', sequence) + '</p:cTn>')) +
    tags('p:bldLst', '<p:bldP spid="' + spid + '" grpId="0" animBg="1"/><p:bldP spid="' + spid + '" grpId="1" animBg="1"/>'));
}

async function exportReplica(data, report) {
  const { slides, media, advanceMs, hideMs, width, height, title } = data;
  const ppt = new PptxGenJS();
  ppt.layout = 'LAYOUT_WIDE';
  ppt.title = title;
  ppt.subject = '16:9 宽屏互动课件';
  ppt.author = '课件转换';
  ppt.company = '课件转换';
  ppt.addSlide();
  const zip = await JSZip.loadAsync(await ppt.write({ outputType: 'arraybuffer' }));
  const get = name => zip.file(name).async('string');
  const typesPath = '[Content_Types].xml';
  const presentation = 'ppt/presentation.xml';
  const presentationRels = 'ppt/_rels/presentation.xml.rels';
  const props = 'ppt/presProps.xml';
  const app = 'docProps/app.xml';
  const [slideTemplate, types, presXml, presRelsXml, propsXml, appXml] = await Promise.all([
    get('ppt/slides/slide1.xml'), get(typesPath), get(presentation), get(presentationRels), get(props), get(app),
  ]);
  const mx = 12192000 / width;
  const my = 6858000 / height;
  const convert = (v, m) => Math.round(v * m);
  const xfrm = ({ x, y, w, h }) => '<a:xfrm><a:off x="' + convert(x, mx) + '" y="' + convert(y, my) +
    '"/><a:ext cx="' + convert(w, mx) + '" cy="' + convert(h, my) + '"/></a:xfrm>';
  const rect = '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>';
  const picture = (id, relation, bounds, name) => '<p:pic><p:nvPicPr><p:cNvPr id="' + id +
    '" name="' + name + '"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>' +
    '<p:blipFill><a:blip r:embed="' + relation + '"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>' +
    tags('p:spPr', xfrm(bounds) + rect) + '</p:pic>';
  const clickable = (id, relation, bounds) => '<p:sp><p:nvSpPr><p:cNvPr id="' + id + '" name="' +
    escapeXml(bounds.name) + '"><a:hlinkClick r:id="' + relation + '" action="ppaction://hlinksldjump"/>' +
    '</p:cNvPr><p:cNvSpPr/><p:nvPr/></p:nvSpPr>' + tags('p:spPr', xfrm(bounds) + rect +
      '<a:solidFill><a:srgbClr val="FFFFFF"><a:alpha val="0"/></a:srgbClr></a:solidFill><a:ln><a:noFill/></a:ln>') + '</p:sp>';
  const ids = [];
  const pRels = [];
  const overrides = [];
  const slideTitleList = [];
  const toastTiming = timing(5, hideMs, height);
  media.forEach((bytes, index) => zip.file('ppt/media/frame-' + (index + 1) + '.png', bytes, { compression: 'STORE' }));
  zip.remove('ppt/notesSlides');
  for (const [index, slide] of slides.entries()) {
    if (index % 64 === 0) report(65 + Math.floor(index / slides.length * 10), '正在连接答题路线');
    const number = index + 1;
    const slideName = 'slide' + number + '.xml';
    const target = 'slides/' + slideName;
    const id = 'rId' + (index + 20);
    const name = escapeXml(slide.name);
    slideTitleList.push('<vt:lpstr>' + name + '</vt:lpstr>');
    ids.push('<p:sldId id="' + (index + 256) + '" r:id="' + id + '"/>');
    pRels.push(rel(id, 'slide', target));
    overrides.push('<Override PartName="/ppt/' + target + '" ContentType="' + SLIDE_TYPE + '"/>');
    const rels = [rel('rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml')];
    const body = [];
    for (const [i, layer] of slide.layers.entries()) {
      const rid = 'rId' + (rels.length + 1);
      rels.push(rel(rid, 'image', '../media/frame-' + layer.image + '.png'));
      body.push(picture(i + 2, rid, layer, ['原网页画面', '当前积分', '闯关积分', '答题提示'][i]));
    }
    const links = new Map();
    for (const [i, hit] of slide.hits.entries()) {
      if (!Number.isInteger(hit.target) || hit.target < 1 || hit.target > slides.length) throw Error('有一个按钮没有可放映的目标页。');
      if (!links.has(hit.target)) {
        const rid = 'rId' + (rels.length + 1);
        rels.push(rel(rid, 'slide', 'slide' + hit.target + '.xml'));
        links.set(hit.target, rid);
      }
      body.push(clickable(i + 2 + slide.layers.length, links.get(hit.target), hit));
    }
    const transition = slide.feedback ? '<p:transition advClick="0" advTm="' + advanceMs + '"/>' + toastTiming
      : '<p:transition advClick="0"/>';
    zip.file('ppt/' + target, slideTemplate.replace(/<p:cSld name="[^"]*"/, '<p:cSld name="' + name + '"')
      .replace('</p:spTree>', body.join('') + '</p:spTree>')
      .replace('</p:sld>', transition + '</p:sld>'));
    zip.file('ppt/slides/_rels/' + slideName + '.rels', HEADER + '<Relationships xmlns="' + PACKAGE + '">' +
      rels.join('') + '</Relationships>');
  }
  zip.file(typesPath, types.replace(/<Override\b[^>]*\bPartName="(\/ppt\/[^"]+)"[^>]*\/>/g,
    (entry, part) => /^\/ppt\/slides\/slide\d+\.xml$/.test(part) || !zip.file(part.slice(1)) ? '' : entry)
    .replace('</Types>', overrides.join('') + '</Types>'));
  zip.file(presentation, presXml.replace(/<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/, tags('p:sldIdLst', ids.join(''))));
  zip.file(presentationRels, presRelsXml.replace(/<Relationship\b[^>]*\bType="[^"]+\/slide"[^>]*\/>/g, '')
    .replace('</Relationships>', pRels.join('') + '</Relationships>'));
  // WPS adds its own three-second timer to untimed slides in kiosk mode.
  const show = '<p:showPr useTimings="1"><p:present/><p:sldAll/></p:showPr>';
  zip.file(props, propsXml.includes('</p:presentationPr>')
    ? propsXml.replace('</p:presentationPr>', show + '</p:presentationPr>')
    : propsXml.replace(/(<p:presentationPr[^>]*?)\s*\/>/, '$1>' + show + '</p:presentationPr>'));
  zip.file(app, appXml.replace(/<Slides>\d+<\/Slides>/, tags('Slides', slides.length))
    .replace(/<Notes>\d+<\/Notes>/, '<Notes>0</Notes>')
    .replace(/(<vt:lpstr>Slide Titles<\/vt:lpstr><\/vt:variant>\s*<vt:variant><vt:i4>)\d+/, '$1' + String(slides.length))
    .replace(/(<TitlesOfParts>\s*<vt:vector size=")\d+/, '$1' + String(slides.length + 3))
    .replace('<vt:lpstr>Slide 1</vt:lpstr>', slideTitleList.join('')));
  report(76, '正在打包 PPT');
  const bytes = await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE', compressionOptions: { level: 3 } },
    ({ percent }) => report(76 + Math.floor(percent * 0.23), '正在打包 PPT'));
  return { bytes, mime: MIME };
}

self.addEventListener('message', async ({ data }) => {
  let progress = 64;
  function report(value, label) {
    if (value <= progress) return;
    progress = value;
    self.postMessage({ type: 'progress', value, label });
  }
  try {
    const output = await exportReplica(data, report);
    self.postMessage({ type: 'done', ...output }, [output.bytes]);
  } catch (error) {
    self.postMessage({ type: 'error', message: error.message || 'PPT 生成失败。' });
  }
});
