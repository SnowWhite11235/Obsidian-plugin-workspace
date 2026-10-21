const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildSync } = require('esbuild');
const { parseHTML } = require('linkedom');
const { resolve } = require('node:path');

const { window, document } = parseHTML('<html><body></body></html>');
global.document = document;
global.Node = window.Node;
// LinkeDOM exposes select.value as read-only; emulate the browser's setter.
Object.defineProperty(window.HTMLSelectElement.prototype, 'value', {
  get() { return this.querySelector('option[selected]')?.value || this.querySelector('option')?.value || ''; },
  set(value) {
    for (const option of this.querySelectorAll('option')) {
      option.toggleAttribute('selected', option.value === value);
    }
  },
});
Object.assign(window.HTMLElement.prototype, {
  createEl(tag, options = {}) {
    const el = document.createElement(tag);
    if (options.cls) el.className = options.cls;
    if (options.text) el.textContent = options.text;
    for (const key of ['type', 'value', 'placeholder']) {
      if (options[key] !== undefined) el.setAttribute(key, options[key]);
    }
    for (const [key, value] of Object.entries(options.attr || {})) el.setAttribute(key, value);
    this.appendChild(el);
    return el;
  },
  createDiv(options) { return this.createEl('div', options); },
  empty() { this.replaceChildren(); },
  addClass(cls) { this.classList.add(cls); },
  removeClass(cls) { this.classList.remove(cls); },
  setText(text) { this.textContent = text; },
});

class TFile {
  constructor(path) { this.path = path; this.basename = path.split('/').pop().replace(/\.md$/, ''); }
}
const notices = [];
class Notice { constructor(message) { notices.push(message); } }
class Modal {
  static latest;
  constructor() {
    Modal.latest = this;
    this.titleEl = document.createElement('div');
    this.contentEl = document.createElement('div');
  }
  open() {}
  close() { this.closed = true; }
}
class ItemView {
  constructor(leaf) { this.app = leaf.app; }
  registerEvent() {}
}
const obsidian = { TFile, Notice, Modal, ItemView, normalizePath: (path) => path.replace(/\/{2,}/g, '/') };
const bundled = buildSync({
  stdin: {
    contents: `export { DataStore } from './src/core/DataStore'; export { WeekCalendarModule } from './src/view/WeekCalendarModule'; export { PanelView } from './src/PanelView'; export { bus } from './src/core/EventBus';`,
    resolveDir: resolve(__dirname, '..'),
  },
  bundle: true, platform: 'node', format: 'cjs', write: false, external: ['obsidian'],
}).outputFiles[0].text;
const exportsObject = { exports: {} };
new Function('require', 'module', 'exports', bundled)(
  (name) => name === 'obsidian' ? obsidian : require(name), exportsObject, exportsObject.exports,
);
const { DataStore, WeekCalendarModule, PanelView, bus } = exportsObject.exports;

function fixture(entries = {}) {
  notices.length = 0;
  const files = new Map(Object.entries(entries).map(([date, tasks]) => {
    const file = new TFile(`LifePanel/daily/${date}.md`);
    return [file.path, { file, content: `## 今日任务\n\n${tasks}\n\n## 灵感\n保留内容\n` }];
  }));
  const vault = {
    getAbstractFileByPath: (path) => files.get(path)?.file,
    getMarkdownFiles: () => [...files.values()].map(({ file }) => file),
    read: async (file) => files.get(file.path).content,
    process: async (file, fn) => { files.get(file.path).content = fn(files.get(file.path).content); },
  };
  const app = { vault };
  const store = new DataStore(app, { folder: 'LifePanel' });
  store.getActiveHabitsForDate = () => [];
  store.getHabits = async () => ({});
  const container = document.createElement('div');
  const view = new WeekCalendarModule(app, { store }, container, '2026-10-21');
  return { files, store, view, container };
}
function row(f, date) { return f.container.querySelector(`[data-date="${date}"]`); }
function tasks(f, date) { return [...row(f, date).querySelectorAll('.lp-week-cal-task-text')].map((el) => el.textContent); }
function transfer() {
  const data = new Map();
  return { types: [], setData(type, value) { data.set(type, value); this.types.push(type); }, getData(type) { return data.get(type) || ''; } };
}
function dragEvent(el, type, dataTransfer) {
  const e = new window.Event(type, { bubbles: true, cancelable: true });
  e.dataTransfer = dataTransfer;
  el.dispatchEvent(e);
  return e;
}
async function settled(check) {
  for (let i = 0; i < 50; i++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.ok(check(), 'async action completed');
}
async function move(f, from, to) {
  const item = row(f, from).querySelector('.lp-week-cal-task-item');
  const data = transfer();
  dragEvent(item, 'dragstart', data);
  dragEvent(row(f, to), 'dragover', data);
  dragEvent(row(f, to), 'drop', data);
  dragEvent(item, 'dragend', data);
  await settled(() => !f.view.savingTask && row(f, '2026-10-25'));
}

test('display range finds old and future source notes by due date, with undated fallback', async () => {
  const f = fixture({
    '2026-01-01': '- [ ] 旧任务 📅 2026-10-20',
    '2026-12-01': '- [ ] 提前处理 📅 2026-10-21',
    '2026-10-22': '- [ ] 无截止日\n- [ ] 其他周 📅 2026-11-01',
  });
  await f.view.render();
  assert.deepEqual(tasks(f, '2026-10-20'), ['旧任务']);
  assert.deepEqual(tasks(f, '2026-10-21'), ['提前处理']);
  assert.deepEqual(tasks(f, '2026-10-22'), ['无截止日']);
  assert.equal(f.files.size, 3, 'read does not create notes');
});

test('drag to an empty date persists due date in original note and keeps other fields', async () => {
  const f = fixture({ '2026-01-01': '- [x] 报告 ❗ ⭐ #工作 ⏫ ⏰ 09:30 📅 2026-10-20 ⏳ 2026-10-19 🛫 2026-10-18 ➕ 2026-01-01 ✅ 2026-10-20 🍅 25m' });
  await f.view.render();
  await move(f, '2026-10-20', '2026-10-23');
  assert.deepEqual(tasks(f, '2026-10-20'), []);
  assert.deepEqual(tasks(f, '2026-10-23'), ['报告']);
  const [task] = await f.store.getTasksSafe('2026-01-01');
  assert.equal(task.dueDate, '2026-10-23');
  for (const [key, value] of Object.entries({ checked: true, urgent: true, important: true, priority: 'high', time: '09:30', scheduledDate: '2026-10-19', startDate: '2026-10-18', createdDate: '2026-01-01', doneDate: '2026-10-20', focusMinutes: 25 })) {
    assert.equal(task[key], value, key);
  }
  assert.deepEqual(task.tags, ['#工作']);
  assert.match([...f.files.values()][0].content, /## 灵感\n保留内容/);
  assert.equal(f.files.size, 1);
});

test('undated task acquires due date; dropping on same day does not write', async () => {
  const f = fixture({ '2026-10-21': '- [ ] 未安排' });
  await f.view.render();
  let writes = 0;
  const process = f.store.app.vault.process;
  f.store.app.vault.process = (...args) => { writes++; return process(...args); };
  await move(f, '2026-10-21', '2026-10-21');
  assert.equal(writes, 0);
  await move(f, '2026-10-21', '2026-10-22');
  assert.equal(writes, 1);
  assert.equal((await f.store.getTasksSafe('2026-10-21'))[0].dueDate, '2026-10-22');
});

test('editing due date regroups immediately; clearing it returns task to source day', async () => {
  const f = fixture({ '2026-10-20': '- [ ] 编辑任务 📅 2026-10-21' });
  await f.view.render();
  row(f, '2026-10-21').querySelector('.lp-week-cal-task-text').click();
  let modal = Modal.latest;
  modal.contentEl.querySelector('input[type=date]').value = '2026-10-23';
  modal.contentEl.querySelector('.lp-modal-save-btn').click();
  await settled(() => modal.closed && row(f, '2026-10-25'));
  assert.deepEqual(tasks(f, '2026-10-21'), []);
  assert.deepEqual(tasks(f, '2026-10-23'), ['编辑任务']);
  row(f, '2026-10-23').querySelector('.lp-week-cal-task-text').click();
  modal = Modal.latest;
  modal.contentEl.querySelector('input[type=date]').value = '';
  modal.contentEl.querySelector('.lp-modal-save-btn').click();
  await settled(() => modal.closed && row(f, '2026-10-25'));
  assert.deepEqual(tasks(f, '2026-10-23'), []);
  assert.deepEqual(tasks(f, '2026-10-20'), ['编辑任务']);
});

test('due-date edit across weeks removes task from old week and shows it in new week', async () => {
  const f = fixture({ '2026-01-01': '- [ ] 跨周 📅 2026-10-21' });
  await f.view.render();
  row(f, '2026-10-21').querySelector('.lp-week-cal-task-text').click();
  const modal = Modal.latest;
  modal.contentEl.querySelector('input[type=date]').value = '2026-11-03';
  modal.contentEl.querySelector('.lp-modal-save-btn').click();
  await settled(() => modal.closed && row(f, '2026-10-25'));
  assert.deepEqual(tasks(f, '2026-10-21'), []);
  f.view.weekStartDate = new Date(2026, 10, 2);
  await f.view.render();
  assert.deepEqual(tasks(f, '2026-11-03'), ['跨周']);
});

test('stale dragged task cannot overwrite a different task after note changes', async () => {
  const f = fixture({ '2026-10-21': '- [ ] 原任务' });
  await f.view.render();
  const note = [...f.files.values()][0];
  note.content = note.content.replace('原任务', '不同任务');
  const before = note.content;
  await move(f, '2026-10-21', '2026-10-22');
  assert.equal(note.content, before);
  assert.match(notices.at(-1), /移动任务失败.*内容已变化/);
  assert.deepEqual(tasks(f, '2026-10-21'), ['不同任务']);
});

test('failed write leaves task on original date and reports error', async () => {
  const f = fixture({ '2026-10-21': '- [ ] 任务' });
  await f.view.render();
  f.store.app.vault.process = async () => { throw new Error('只读文件'); };
  await move(f, '2026-10-21', '2026-10-22');
  assert.deepEqual(tasks(f, '2026-10-21'), ['任务']);
  assert.deepEqual(tasks(f, '2026-10-22'), []);
  assert.match(notices.at(-1), /只读文件/);
});

test('task drag is isolated from module drag; unrelated drops are ignored', async () => {
  const f = fixture({ '2026-10-21': '- [ ] 任务' });
  await f.view.render();
  let outerDrops = 0;
  f.container.addEventListener('drop', () => outerDrops++);
  const item = row(f, '2026-10-21').querySelector('.lp-week-cal-task-item');
  const data = transfer();
  dragEvent(item, 'dragstart', data);
  assert.equal(data.getData('text/plain'), '');
  dragEvent(row(f, '2026-10-22'), 'dragover', data);
  assert.ok(row(f, '2026-10-22').classList.contains('lp-week-cal-drop-target'));
  dragEvent(item, 'dragend', data);
  assert.equal(f.container.querySelector('.lp-week-cal-drop-target'), null);
  const unrelated = transfer();
  unrelated.setData('text/plain', 'calendar');
  const event = dragEvent(row(f, '2026-10-22'), 'drop', unrelated);
  assert.equal(event.defaultPrevented, false);
  assert.equal(outerDrops, 1);
  await move(f, '2026-10-21', '2026-10-22');
  assert.equal(outerDrops, 1, 'task drop must not reach module reorder');
});

test('task updates reject a line outside the task section', async () => {
  const f = fixture({ '2026-10-21': '- [ ] 任务' });
  const note = [...f.files.values()][0];
  note.content += '- [ ] 灵感中的任务\n';
  const before = note.content;
  const outside = note.content.split('\n').findIndex((line) => line.includes('灵感中的任务')) - 1;
  await assert.rejects(f.store.updateTask('2026-10-21', outside, { dueDate: '2026-10-22' }), /位置已变化/);
  assert.equal(note.content, before);
});

test('editor changes and task events refresh the displayed week without resetting navigation', async () => {
  const f = fixture({ '2026-01-01': '- [ ] 外部编辑 📅 2026-11-03' });
  f.view.weekStartDate = new Date(2026, 10, 2);
  await f.view.render();
  assert.deepEqual(tasks(f, '2026-11-03'), ['外部编辑']);
  const listeners = new Map();
  f.store.app.vault.on = (type, fn) => { listeners.set(type, fn); };
  const panel = new PanelView({ app: f.store.app }, { settings: { folder: 'LifePanel' } });
  panel.render = () => {};
  panel.weekCalendar = f.view;
  await panel.onOpen();
  const note = [...f.files.values()][0];
  note.content = note.content.replace('2026-11-03', '2026-11-05');
  listeners.get('modify')(note.file);
  await settled(() => row(f, '2026-11-08') && tasks(f, '2026-11-05').length === 1);
  assert.deepEqual(tasks(f, '2026-11-03'), []);
  note.content = note.content.replace('2026-11-05', '2026-11-06');
  bus.emit({ type: 'data-updated', scope: 'day', date: '2026-01-01' });
  await settled(() => row(f, '2026-11-08') && tasks(f, '2026-11-06').length === 1);
  await panel.onClose();
  bus.emit({ type: 'data-updated', scope: 'all' });
  assert.equal(panel.weekCalendar, undefined);
});
