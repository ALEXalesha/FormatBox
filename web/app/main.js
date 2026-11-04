// Окно FormatBox: очередь файлов, наборы, панель настроек, темы и язык. Работа - в run.js.
import { t, setLang, getLang, guessLang, humanSize } from './i18n.js';
import { makePlatform } from './platform.js';
import { createQueue } from '../core/queue.js';
import { detect, targetsFor, extOf } from '../core/formats.js';
import { presetsFor, applyPreset } from '../core/presets.js';
import { runJob, runJoin, runText3d, defaultTarget, releaseJob } from './run.js';
import { renderPanel } from './panel.js';

const $ = (sel) => document.querySelector(sel);
const THEMES = ['glass', 'formal', 'light', 'night', 'warm'];
const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage off */ } },
};

const app = {
  platform: null,
  jobs: [],
  selected: new Set(),
  nextId: 1,
  queue: null,
};
window.formatboxApp = app;

function applyI18n() {
  document.documentElement.lang = getLang();
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of document.querySelectorAll('[data-i18n-title]')) { el.title = t(el.dataset.i18nTitle); el.setAttribute('aria-label', el.title); }
  const sel = $('#themeSel');
  const cur = sel.value || store.get('fb.theme', 'glass');
  sel.innerHTML = THEMES.map((th) => `<option value="${th}">${t(`theme.${th}`)}</option>`).join('');
  sel.value = THEMES.includes(cur) ? cur : 'glass';
  renderAll();
}

function setTheme(th) {
  if (th === 'glass') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = th;
  store.set('fb.theme', th);
}

export function toast(text, ms = 3200) {
  const el = $('#toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.hidden = true; }, ms);
}

async function headOf(src) {
  if (src.file) return new Uint8Array(await src.file.slice(0, 4096).arrayBuffer());
  return window.formatbox.head(src.path, 4096);
}

export async function addFiles(list) {
  for (const item of list) {
    const src = item instanceof File
      ? (app.platform.desktop ? { path: window.formatbox.pathFor(item), file: item } : { file: item })
      : { path: item.path };
    const name = item.name;
    const size = item.size;
    let head;
    try { head = await headOf(src); } catch { head = new Uint8Array(0); }
    const found = detect(head, name);
    const job = {
      id: app.nextId++, name, size, src,
      ext: found.ext || extOf(name), kind: found.kind,
      to: null, opts: {}, state: 'idle', progress: 0, error: null, result: null, info: null, view: {},
    };
    job.to = defaultTarget(job, app.platform);
    app.jobs.push(job);
    if (app.selected.size === 0) app.selected.add(job.id);
  }
  renderAll();
}

function selectedJobs() { return app.jobs.filter((j) => app.selected.has(j.id)); }

function renderQueue() {
  const ul = $('#queue');
  ul.innerHTML = '';
  $('#queueEmpty').hidden = app.jobs.length > 0;
  $('#drop').classList.toggle('small', app.jobs.length > 0);
  $('#drop span').textContent = t(app.jobs.length ? 'drop.short' : 'drop');
  for (const job of app.jobs) {
    const li = document.createElement('li');
    li.className = `job ${job.state}${app.selected.has(job.id) ? ' sel' : ''}`;
    li.dataset.id = job.id;
    li.tabIndex = 0;
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = job.name;
    name.title = job.name;
    const acts = document.createElement('span');
    acts.className = 'acts';
    const state = document.createElement('span');
    state.className = 'state';
    state.textContent = t(`state.${job.state}`);
    acts.append(state);
    if (job.state === 'running' || job.state === 'waiting') acts.append(button('cancel', () => app.queue.cancel(job.qid), 'job-cancel'));
    if (job.state === 'done' && job.result) {
      if (job.result.url) {
        const a = document.createElement('a');
        a.className = 'save';
        a.href = job.result.url;
        a.download = job.result.name;
        a.textContent = t('save');
        acts.append(a);
      } else if (job.result.path && app.platform.show) acts.append(button('show', () => app.platform.show(job.result.path), 'job-show'));
    }
    if (!['running', 'waiting'].includes(job.state)) acts.append(button('remove', () => removeJob(job.id), 'job-remove'));
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = metaText(job);
    li.append(name, acts, meta);
    if (job.state === 'running') {
      const bar = document.createElement('progress');
      bar.max = 1; bar.value = job.progress || 0;
      li.append(bar);
    }
    li.addEventListener('click', (e) => {
      if (e.target.closest('button, a')) return;
      if (e.ctrlKey || e.metaKey) { if (app.selected.has(job.id)) app.selected.delete(job.id); else app.selected.add(job.id); }
      else { app.selected.clear(); app.selected.add(job.id); }
      renderAll();
    });
    li.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); li.click(); } });
    ul.append(li);
  }
}

function metaText(job) {
  const parts = [`${job.ext.toUpperCase() || '?'} · ${humanSize(job.size)}`];
  if (job.to) parts.push(`→ ${job.to.toUpperCase()}`);
  if (job.state === 'failed') parts.push(t(`err.${job.error}`) === `err.${job.error}` ? job.error : t(`err.${job.error}`));
  if (job.state === 'done' && job.result) {
    parts.push(job.result.name);
    if (job.result.bytes != null) parts.push(t('size.result', { size: humanSize(job.result.bytes), orig: humanSize(job.size) }));
  }
  return parts.join(' · ');
}

function button(key, fn, cls = '') {
  const b = document.createElement('button');
  b.textContent = t(key);
  b.className = cls;
  b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
  return b;
}

function removeJob(id) {
  const i = app.jobs.findIndex((j) => j.id === id);
  if (i < 0) return;
  app.platform.revoke(app.jobs[i].result);
  releaseJob(app.jobs[i]);
  app.jobs.splice(i, 1);
  app.selected.delete(id);
  renderAll();
}

function renderPresets() {
  const sel = selectedJobs();
  const kinds = new Set(sel.map((j) => j.kind));
  const bar = $('#presetsBar');
  const box = $('#presets');
  box.innerHTML = '';
  if (kinds.size !== 1) { bar.hidden = true; return; }
  const list = presetsFor([...kinds][0]);
  bar.hidden = list.length === 0;
  for (const p of list) {
    const b = document.createElement('button');
    b.textContent = t(`preset.${p.id}`);
    b.dataset.preset = p.id;
    b.classList.toggle('on', sel.every((j) => j.preset === p.id));
    b.addEventListener('click', () => {
      for (const j of sel) if (j.state !== 'running') Object.assign(j, applyPreset(j, p.id), { state: 'idle', result: null });
      renderAll();
    });
    box.append(b);
  }
}

export function renderAll() {
  renderQueue();
  renderPresets();
  const sel = selectedJobs();
  $('#panelNone').hidden = sel.length > 0;
  $('#panelBody').hidden = sel.length === 0;
  if (sel.length) renderPanel($('#panelBody'), sel, { app, t, toast, rerender: renderAll, targetsFor: (j) => targetsFor(j.ext, { desktop: app.platform.desktop }).filter((x) => x !== 'avif' || app.caps.avif) });
  const out = app.platform.outLabel();
  $('#outInfo').textContent = t(out.key, { name: out.name });
  $('#outPick').hidden = !app.platform.canPickFolder;
  $('#outReset').hidden = out.key !== 'out.folder';
  $('#startAll').disabled = !app.jobs.some((j) => ['idle', 'failed', 'canceled'].includes(j.state) && j.to);
}

let renderPending = false;
function softRender() {
  if (renderPending) return;
  renderPending = true;
  requestAnimationFrame(() => { renderPending = false; renderQueue(); });
}

function startJobs(list) {
  for (const job of list) {
    if (!job.to || ['running', 'waiting'].includes(job.state)) continue;
    app.platform.revoke(job.result);
    Object.assign(job, { state: 'waiting', progress: 0, error: null, result: null });
    job.qid = app.queue.add(job);
  }
  renderAll();
}

function wire() {
  $('#addFiles').addEventListener('click', async () => {
    if (app.platform.desktop) { const files = await window.formatbox.pickFiles(); if (files.length) addFiles(files); }
    else $('#fileInput').click();
  });
  $('#fileInput').addEventListener('change', (e) => { addFiles([...e.target.files]); e.target.value = ''; });
  const drop = $('#drop');
  drop.addEventListener('click', () => $('#addFiles').click());
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#addFiles').click(); });
  for (const target of [drop, document.body]) {
    target.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    target.addEventListener('dragleave', () => drop.classList.remove('over'));
    target.addEventListener('drop', (e) => {
      e.preventDefault(); e.stopPropagation();
      drop.classList.remove('over');
      if (e.dataTransfer?.files?.length) addFiles([...e.dataTransfer.files]);
    });
  }
  $('#themeSel').addEventListener('change', (e) => setTheme(e.target.value));
  $('#langSel').addEventListener('change', (e) => { setLang(e.target.value); store.set('fb.lang', e.target.value); applyI18n(); });
  $('#startAll').addEventListener('click', () => startJobs(app.jobs.filter((j) => ['idle', 'failed', 'canceled'].includes(j.state))));
  $('#cancelAll').addEventListener('click', () => app.queue.cancelAll());
  $('#clearDone').addEventListener('click', () => {
    for (const j of app.jobs.filter((x) => ['done', 'canceled', 'failed'].includes(x.state))) removeJob(j.id);
    app.queue.clearFinished();
  });
  $('#outPick').addEventListener('click', async () => { try { await app.platform.pickFolder(); } catch { /* отказ */ } renderAll(); });
  $('#outReset').addEventListener('click', () => { app.platform.resetFolder(); renderAll(); });
  const menu = $('#toolsMenu');
  $('#toolsBtn').addEventListener('click', (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; });
  document.addEventListener('click', () => { menu.hidden = true; });
  $('#toolJoin').addEventListener('click', () => {
    const vids = selectedJobs().filter((j) => j.kind === 'video');
    if (vids.length < 2) { toast(t('join.need')); return; }
    const job = { id: app.nextId++, name: vids[0].name, size: vids.reduce((s, j) => s + j.size, 0), src: vids[0].src, ext: vids[0].ext, kind: 'join', parts: vids, to: 'mp4', opts: {}, state: 'idle', progress: 0, view: {} };
    app.jobs.push(job);
    app.selected = new Set([job.id]);
    renderAll();
  });
  $('#toolText3d').addEventListener('click', () => $('#text3dDlg').showModal());
  $('#text3dDlg').addEventListener('close', () => {
    if ($('#text3dDlg').returnValue !== 'ok') return;
    const text = $('#text3dText').value.trim();
    if (!text) return;
    const job = { id: app.nextId++, name: `${text.slice(0, 40)}.txt`, size: text.length, src: {}, ext: 'txt', kind: 'text3d', text, to: 'stl', opts: { heightMm: +$('#text3dHeight').value || 10 }, state: 'idle', progress: 0, view: {} };
    app.jobs.push(job);
    app.selected = new Set([job.id]);
    renderAll();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Delete' && document.activeElement?.closest?.('#queue')) for (const j of selectedJobs()) if (!['running', 'waiting'].includes(j.state)) removeJob(j.id);
  });
}

async function boot() {
  app.platform = await makePlatform();
  // AVIF в списке только там, где canvas умеет его кодировать (Chromium и Electron - нет)
  app.caps = { avif: document.createElement('canvas').toDataURL('image/avif').startsWith('data:image/avif') };
  setLang(store.get('fb.lang', guessLang(navigator.languages)));
  $('#langSel').value = getLang();
  const th = store.get('fb.theme', 'glass');
  $('#themeSel').value = th;
  setTheme(THEMES.includes(th) ? th : 'glass');
  app.queue = createQueue({
    concurrency: 1,
    run: (job, ctl) => {
      const real = job.input;
      const runner = real.kind === 'join' ? runJoin : real.kind === 'text3d' ? runText3d : runJob;
      return runner(real, { ...ctl, platform: app.platform, progress: (p) => { real.progress = p; ctl.progress(p); } });
    },
    onChange: (q) => {
      const job = q.input;
      if (q.state === 'running' && job.state !== 'running') job.runs = (job.runs || 0) + 1;
      job.state = q.state === 'failed' ? 'failed' : q.state;
      if (q.state === 'done') { job.result = q.result; }
      if (q.state === 'failed') job.error = q.error;
      if (q.state === 'running' || q.state === 'waiting') softRender();
      else renderAll();
    },
  });
  app.startSelected = startJobs;
  wire();
  applyI18n();
  document.body.dataset.ready = '1';
}

boot();
