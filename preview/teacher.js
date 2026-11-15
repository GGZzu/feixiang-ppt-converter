(function (global) {
  'use strict';

  const PREFERENCES = 'feixiang-teacher-preview-settings';
  let openedDatabase;
  function preferences(value) {
    try {
      if (value) localStorage.setItem(PREFERENCES, JSON.stringify(value));
      return JSON.parse(localStorage.getItem(PREFERENCES)) ?? {};
    } catch {
      return {};
    }
  }

  function database() {
    if (!openedDatabase) {
      openedDatabase = new Promise((resolve, reject) => {
        const request = indexedDB.open('feixiang-teacher-preview', 1);
        request.onupgradeneeded = () => {
          request.result.createObjectStore('projects', { keyPath: 'id' });
        };
        request.onsuccess = () => {
          const connection = request.result;
          connection.onversionchange = () => {
            connection.close();
            openedDatabase = null;
          };
          resolve(connection);
        };
        request.onerror = () => {
          openedDatabase = null;
          reject(request.error);
        };
      });
    }
    return openedDatabase;
  }

  async function updateLibrary(mode, action) {
    const db = await database();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('projects', mode);
      const request = action(transaction.objectStore('projects'));
      transaction.oncomplete = () => resolve(request?.result);
      transaction.onabort = () => reject(transaction.error ?? Error('本机保存已中止。'));
    });
  }

  async function list() {
    const items = await updateLibrary('readonly', store => store.getAll());
    return items.sort((a, b) => b.savedAt - a.savedAt);
  }

  async function save(title, content, id = '') {
    const item = { title, content, id: id || crypto.randomUUID(), savedAt: Date.now() };
    await updateLibrary('readwrite', store => store.put(item));
    return item;
  }

  function remove(id) {
    return updateLibrary('readwrite', store => store.delete(id));
  }

  function node(tag, value) {
    const item = document.createElement(tag);
    if (value) item.textContent = value;
    return item;
  }

  function rotated(items) {
    return items.length > 1 ? [...items.slice(1), items[0]] : items;
  }

  function drawHandout(data, holder, teacher) {
    const intro = node('p', data.intro);
    const heading = node('h1', data.title);
    const meta = node('p', teacher ? '教师提示' : '学生任务单　　班级 __________　　姓名 __________');
    meta.className = 'sheet-meta';
    const content = [heading, meta];
    if (data.intro) content.push(intro);
    for (const [index, q] of data.qs.entries()) {
      const section = node('section');
      section.append(node('h2', (index + 1) + '. ' + q.title));
      if (q.copy && q.copy !== q.title) section.append(node('p', q.copy));
      const list = node('ol');
      if (q.type === 'choice') {
        list.type = 'A';
        for (const option of q.options) {
          const li = node('li', option.text);
          if (teacher) {
            const lines = [];
            if (option.correct === true) lines.push('参考选项');
            if (option.result) lines.push(option.result);
            if (option.tip) lines.push('提示　' + option.tip);
            if (option.next === 'end') lines.push('结束活动');
            else if (option.next) {
              const next = data.qs.findIndex(item => item.id === option.next);
              if (next >= 0) lines.push('进入第 ' + (next + 1) + ' 题');
            }
            if (lines.length) li.append(node('p', lines.join('\n')));
          }
          list.append(li);
        }
        section.append(list);
        if (!teacher && q.emotion != null) section.append(node('p', '我选的情绪强度（1～10） ______'));
      } else if (q.type === 'match') {
        for (const pair of q.items) list.append(node('li', teacher ? pair.left + '　→　' + pair.right : pair.left + ' ______'));
        section.append(list);
        if (!teacher) {
          const options = node('ol');
          options.type = 'A';
          for (const pair of rotated(q.items)) options.append(node('li', pair.right));
          section.append(node('p', '请填入右侧选项的字母。'), options);
        }
      } else if (q.type === 'order') {
        list.type = 'A';
        for (const item of teacher ? q.items : rotated(q.items)) list.append(node('li', item));
        section.append(list);
        if (!teacher) section.append(node('p', '我的顺序 ____________________'));
      }
      if (!teacher) {
        const line = node('p', q.type === 'choice' ? '我的选择和理由' : '我的理由');
        line.className = 'answer-line';
        section.append(line);
      } else if (q.feedback) section.append(node('p', q.feedback));
      content.push(section);
    }
    holder.replaceChildren(...content);
  }

  global.TeacherTools = { preferences, list, save, remove, drawHandout };
})(globalThis);
