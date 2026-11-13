(function (global) {
  'use strict';

  const FORMAT = 'feixiang-classroom';
  const MAX_FILE = 9 * 1024 * 1024;
  const MAX_WEB = 7000;
  const COLORS = {
    canvas: 'F2F7F5', surface: 'E7F3EC', ink: '172B27', muted: '52645A',
    primary: '8BC9B5', highlight: 'A9D8D5', attention: '923E35', positive: '116751',
    border: 'C2D7CD', 'success-soft': 'E0F5E6', 'error-soft': 'FCE6E0',
  };
  const TYPES = { choice: '情境选择', match: '配对', order: '排序' };
  const trim = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
  const list = (value) => Array.isArray(value) ? value : [];
  const points = (value) => Number.isSafeInteger(value) && Math.abs(value) <= 500;
  const newId = () => 'q-' + global.crypto.randomUUID();

  function blankQuestion(type, scored, level = '课堂活动') {
    const question = { id: newId(), type, level, title: '', copy: '', emotion: null };
    if (type === 'choice') {
      question.options = Array.from({ length: 2 }, () =>
        ({ text: '', result: '', tip: '', heading: '', correct: null, points: scored ? 0 : null, next: '' }));
    } else {
      question.items = type === 'match' ? [{ left: '', right: '' }, { left: '', right: '' }] : ['', ''];
      question.feedback = '';
    }
    return question;
  }

  function newLesson() {
    const question = blankQuestion('choice', false);
    question.title = '你会怎么做？';
    question.options[0].text = '先了解情况';
    question.options[1].text = '先说出自己的感受';
    return normalize({
      title: '新课件', brand: '新课件', endTitle: '活动完成',
      qs: [question], scoringEnabled: false,
    });
  }

  function normalize(raw) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.qs) || !raw.qs.length || raw.qs.length > 24) {
      throw Error('课件需要包含 1 到 24 道活动题。');
    }
    const title = trim(raw.title, 100);
    if (!title) throw Error('请输入课件标题。');
    const colors = { ...COLORS };
    for (const key of Object.keys(colors)) {
      if (typeof raw.c?.[key] === 'string' && /^[0-9a-f]{6}$/i.test(raw.c[key])) colors[key] = raw.c[key];
    }
    const ids = new Set();
    const qs = raw.qs.map((q, index) => {
      const id = typeof q?.id === 'string' && /^q-[a-z0-9-]{1,64}$/.test(q.id) ? q.id : 'q-' + (index + 1);
      const type = q?.type ?? 'choice';
      const title = trim(q?.title, 64);
      const fail = (reason) => { throw Error('第 ' + (index + 1) + ' 题' + reason); };
      if (!title || !Object.hasOwn(TYPES, type)) fail('缺少题干或题型。');
      if (ids.has(id)) fail('的编号与另一道题重复。');
      ids.add(id);
      const result = {
        id, type, title, copy: trim(q.copy, 300), level: trim(q.level, 64) || '课堂活动',
        emotion: type === 'choice' && Number.isInteger(q.emotion) && q.emotion >= 1 && q.emotion <= 10 ? q.emotion : null,
      };
      if (type === 'choice') {
        if (list(q.options).length < 2 || q.options.length > 4) fail('需要 2 到 4 个选项。');
        result.options = q.options.map((option) => {
          const text = trim(option?.text, 180);
          if (!text) fail('有未填写的选项。');
          if (option.points != null && !points(option.points)) fail('的分值须为 -500 到 500 的整数。');
          return {
            text, result: trim(option.result, 240), tip: trim(option.tip, 180),
            heading: trim(option.heading, 45), correct: typeof option.correct === 'boolean' ? option.correct : null,
            points: option.points ?? null, next: trim(option.next, 67),
          };
        });
      } else {
        if (list(q.items).length < 2 || q.items.length > 4) fail('需要 2 到 4 组材料。');
        result.items = q.items.map(item => type === 'order'
          ? trim(item, 100) : { left: trim(item?.left, 100), right: trim(item?.right, 100) });
        const columns = type === 'order' ? [result.items] : ['left', 'right'].map(key => result.items.map(item => item[key]));
        if (columns.some(values => values.some(value => !value) || new Set(values).size !== values.length)) {
          fail('的材料需要填完整，同一列不能重复。');
        }
        result.feedback = trim(q.feedback, 240);
      }
      return result;
    });
    const positions = new Map(qs.map((q, index) => [q.id, index]));
    const groupTotals = new Map();
    const groupProgress = new Map();
    qs.forEach(q => groupTotals.set(q.level, (groupTotals.get(q.level) || 0) + 1));
    qs.forEach((q, index) => {
      const position = (groupProgress.get(q.level) || 0) + 1;
      groupProgress.set(q.level, position);
      q.progress = position + ' / ' + groupTotals.get(q.level);
      for (const option of q.options ?? []) {
        if (option.next && option.next !== 'end' && !(positions.get(option.next) > index)) {
          throw Error('第 ' + (index + 1) + ' 题的分支须指向后面的题目或结束。');
        }
      }
    });
    const options = qs.flatMap(q => q.options ?? []);
    const hasPoints = options.some(option => option.points !== null);
    const scoringEnabled = typeof raw.scoringEnabled === 'boolean' ? raw.scoringEnabled : hasPoints || raw.countsCorrect === true;
    const scored = scoringEnabled && hasPoints;
    const branching = options.some(option => option.next);
    const countsCorrect = scoringEnabled && !branching && qs.every(q => q.type === 'choice')
      && options.every(option => option.correct !== null);
    const rank = list(raw.rank).slice(0, 10)
      .filter(entry => Array.isArray(entry) && Number.isFinite(entry[0]) && entry[0] >= 0 && entry[0] <= 100)
      .map(entry => [entry[0], trim(entry[1], 45)]).filter(entry => entry[1]).sort((a, b) => b[0] - a[0]);
    const pairs = values => list(values).slice(0, 6).filter(Array.isArray).map(v => [trim(v[0], 100), trim(v[1], 180)]);
    return {
      qs, c: colors, levelCount: groupTotals.size, originalEmotionLayout: raw.originalEmotionLayout === true,
      scoringEnabled, scored, countsCorrect, rank, branching,
      advanceMs: Number.isInteger(raw.advanceMs) && raw.advanceMs >= 1000 && raw.advanceMs <= 30000 ? raw.advanceMs : 0,
      title, brand: trim(raw.brand, 100) || title, audience: trim(raw.audience, 100), intro: trim(raw.intro, 320),
      rules: pairs(raw.rules), methods: pairs(raw.methods), endTitle: trim(raw.endTitle, 100) || '活动完成',
      endCopy: trim(raw.endCopy, 220), tips: list(raw.tips).slice(0, 5).map(tip => trim(tip, 140)),
      coverUrl: trim(raw.coverUrl, MAX_FILE - 32000),
    };
  }

  function nextIndex(data, index, option) {
    if (option?.next === 'end') return data.qs.length;
    return option?.next ? data.qs.findIndex(q => q.id === option.next) : index + 1;
  }

  function accuracyResults(data, correct) {
    if (!data.countsCorrect) return [];
    const results = [[data.originalEmotionLayout ? '理性选择' : '正确题数', correct + ' / ' + data.qs.length]];
    const percentage = Math.round(correct / data.qs.length * 100);
    const rank = data.rank.find(([minimum]) => percentage >= minimum);
    if (rank) results.push(['成长等级', rank[1]]);
    return results;
  }

  function preparePpt(data) {
    const starts = [];
    let size = 0;
    for (const q of data.qs) {
      starts.push(size);
      size += q.type === 'choice' ? 1 : q.items.length;
    }
    starts.push(size);
    const qs = data.qs.flatMap((q, index) => {
      if (q.type === 'choice') {
        return [{
          ...q, options: q.options.map(option => ({
            ...option, points: data.scored ? option.points : null,
            nextIndex: starts[nextIndex(data, index, option)],
          })),
        }];
      }
      const matching = q.type === 'match';
      return q.items.map((item, step) => {
        const correctText = matching ? item.right : item;
        const candidates = matching ? q.items.map(pair => pair.right) : q.items.slice(step);
        const offset = candidates.length > 1 ? (step + 1) % candidates.length : 0;
        const choices = candidates.slice(offset).concat(candidates.slice(0, offset));
        const label = matching ? '配对 ' + (step + 1) + '：' + item.left : '排序：第 ' + (step + 1) + ' 项是什么？';
        return {
          ...q, title: label, copy: q.title + (q.copy ? ' · ' + q.copy : ''), progress: q.progress,
          options: choices.map(text => {
            const correct = text === correctText;
            return {
              text, correct, points: null, heading: correct ? '已完成这一步' : '再试一次', tip: '',
              result: correct
                ? (step === q.items.length - 1 ? q.feedback || '已完成这道活动。' : '继续下一步。')
                : '回到这一步重新选择。',
              nextIndex: starts[index] + step + Number(correct),
            };
          }),
        };
      });
    });
    return { ...data, qs, branching: data.branching || qs.length !== data.qs.length };
  }

  function pack(data, cover) {
    return JSON.stringify({ format: FORMAT, version: 1, lesson: { ...data, coverUrl: cover || data.coverUrl } });
  }

  function unpack(raw) {
    if (typeof raw !== 'string' || raw.length > MAX_FILE) throw Error('课件项目文件过大。');
    const payload = JSON.parse(raw);
    if (payload?.format !== FORMAT || payload.version !== 1) throw Error('请选择由本工具保存的课件项目。');
    return normalize(payload.lesson);
  }

  function inflateLimited(bytes, max) {
    const parts = [];
    let size = 0;
    const inflate = new global.fflate.Inflate(value => {
      size += value.length;
      if (size > max) throw Error('活动内容过大。');
      parts.push(value);
    });
    for (let offset = 0; offset < bytes.length; offset += 256) {
      inflate.push(bytes.subarray(offset, offset + 256), offset + 256 >= bytes.length);
    }
    const result = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) {
      result.set(part, offset);
      offset += part.length;
    }
    return result;
  }

  async function webToken(data) {
    const bytes = new TextEncoder().encode(pack({ ...data, coverUrl: '' }));
    const compressed = global.fflate.deflateSync(bytes, { level: 9 });
    if (compressed.length > MAX_WEB) throw Error('活动链接太长。可以按课次分成两份再分享。');
    const token = btoa(String.fromCharCode(...compressed)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
    if (token.length > MAX_WEB) throw Error('活动链接太长。可以按课次分成两份再分享。');
    return token;
  }

  async function readToken(token) {
    if (!token || token.length > MAX_WEB || !/^[A-Za-z0-9_-]+$/.test(token)) throw Error('活动链接无效或不完整。');
    const bytes = Uint8Array.from(atob(token.replaceAll('-', '+').replaceAll('_', '/')), char => char.charCodeAt(0));
    const raw = inflateLimited(bytes, 384000);
    return unpack(new TextDecoder().decode(raw));
  }

  global.ClassroomProject = {
    MAX_FILE, TYPES, blankQuestion, newLesson, normalize, nextIndex, accuracyResults,
    preparePpt, pack, unpack, webToken, readToken,
  };
})(globalThis);
