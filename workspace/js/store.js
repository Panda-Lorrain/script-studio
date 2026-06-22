// workspace/js/store.js
// 数据层：File System Access API 读写，data/index.json 管清单，operator 身份
import { nowIso } from './utils.js';

let dirHandle = null;       // workspace/ 目录句柄
let assetsCache = null;     // assets.json 缓存
const DIR_KEY = 'ss_dir_handle_v1';
const OP_KEY = 'ss_operator';

/* ---------- IndexedDB 存取句柄 ---------- */
function idbGet(key) {
  return new Promise(res => {
    const req = indexedDB.open('ss_store', 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains('kv')) req.result.createObjectStore('kv');
    };
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) { res(null); return; }
      const tx = db.transaction('kv', 'readonly').objectStore('kv').get(key);
      tx.onsuccess = () => res(tx.result || null);
      tx.onerror = () => res(null);
    };
    req.onerror = () => res(null);
  });
}
function idbSet(key, val) {
  return new Promise(res => {
    const req = indexedDB.open('ss_store', 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains('kv')) req.result.createObjectStore('kv');
    };
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('kv', 'readwrite').objectStore('kv');
      tx.put(val, key);
      tx.oncomplete = () => res(true);
      tx.onerror = () => res(false);
    };
    req.onerror = () => res(false);
  });
}

/* ---------- 操作者身份 ---------- */
export function getOperator() {
  return localStorage.getItem(OP_KEY) || '匿名';
}
export function setOperator(name) {
  localStorage.setItem(OP_KEY, name);
}

/* ---------- 目录授权 ---------- */
export function hasDir() { return !!dirHandle; }
export function isFsaSupported() {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

export async function initStore() {
  const saved = await idbGet(DIR_KEY);
  if (saved) {
    try {
      const perm = await saved.queryPermission({ mode: 'readwrite' });
      if (perm === 'granted') { dirHandle = saved; return true; }
    } catch { /* 句柄失效 */ }
  }
  return false;
}

export async function pickDirectory() {
  if (!isFsaSupported()) return false;
  dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
  await idbSet(DIR_KEY, dirHandle);
  return true;
}

/* ---------- 文件读写 ---------- */
async function resolvePath(path) {
  const parts = path.split('/').filter(Boolean);
  let h = dirHandle;
  for (let i = 0; i < parts.length - 1; i++) {
    h = await h.getDirectoryHandle(parts[i], { create: true });
  }
  return { dir: h, name: parts[parts.length - 1] };
}

async function readText(path) {
  if (dirHandle) {
    const { dir, name } = await resolvePath(path);
    const fh = await dir.getFileHandle(name);
    const f = await fh.getFile();
    return await f.text();
  }
  // 绝对路径，避免页面在 workspace/ 下时前缀重复（workspace/workspace/...）
  const res = await fetch('/workspace/' + path + '?t=' + Date.now());
  if (!res.ok) throw new Error('读取失败: ' + path + ' (' + res.status + ')');
  return await res.text();
}

async function writeText(path, content) {
  if (!dirHandle) throw new Error('NO_DIR');
  const { dir, name } = await resolvePath(path);
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(content);
  await w.close();
}

/* ---------- 项目数据 ---------- */
function emptyProject(title) {
  return {
    meta: { title, created: nowIso(), updated: nowIso(), stage: 'review', operator: getOperator() },
    review: { platform: '', verdict: '', original: '', splitOriginal: '', items: [], decisions: {}, output: '' },
    design: { shots: [] },
    changelog: [{ ts: nowIso(), who: getOperator(), action: 'created', detail: '新建项目' }]
  };
}

export async function loadProjectList() {
  try {
    const txt = await readText('data/index.json');
    const idx = JSON.parse(txt);
    return idx.projects || [];
  } catch {
    return [];
  }
}

async function saveIndex(projects) {
  await writeText('data/index.json', JSON.stringify({ projects }, null, 2));
}

function projectSummary(data) {
  return {
    title: data.meta.title,
    stage: data.meta.stage,
    updated: data.meta.updated,
    shotCount: data.design.shots.length,
    reviewItemCount: data.review.items.length
  };
}

export async function loadProject(title) {
  const txt = await readText('data/' + title + '.json');
  return JSON.parse(txt);
}

export async function saveProject(data) {
  data.meta.updated = nowIso();
  const title = data.meta.title;
  await writeText('data/' + title + '.json', JSON.stringify(data, null, 2));
  const list = await loadProjectList();
  const sum = projectSummary(data);
  const i = list.findIndex(p => p.title === title);
  if (i >= 0) list[i] = sum; else list.push(sum);
  await saveIndex(list);
  return data;
}

export async function createProject(title) {
  const data = emptyProject(title);
  await saveProject(data);
  return data;
}

export async function logAndSave(data, action, detail) {
  if (!data.changelog) data.changelog = [];
  data.changelog.push({ ts: nowIso(), who: getOperator(), action, detail });
  return await saveProject(data);
}

/* ---------- 素材 ---------- */
export async function loadAssets() {
  if (assetsCache) return assetsCache;
  try {
    const txt = await readText('assets.json');
    assetsCache = JSON.parse(txt);
  } catch {
    assetsCache = [];
  }
  return assetsCache;
}

export function assetUrl(a) {
  return encodeURI('../Material Collection/' + a.folder + '/' + a.file);
}
export function assetById(assets, id) {
  return assets.find(a => a.id === id);
}
