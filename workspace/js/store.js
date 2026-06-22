// workspace/js/store.js
// 数据层：File System Access API 读写，data/index.json 管清单，operator 身份
import { nowIso } from './utils.js';

let dirHandle = null;       // workspace/ 目录句柄
let assetsCache = null;     // assets.json 缓存
const projectCache = new Map();  // title -> data（内存缓存，让只读模式也能即时生效）
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

/* ---------- 管理员（运营者）：才有导入/选目录/新建/后台权限 ---------- */
const ADMIN_KEY = 'ss_admins';
export function getAdmins() {
  try { return JSON.parse(localStorage.getItem(ADMIN_KEY)) || ['lorrain']; }
  catch { return ['lorrain']; }
}
export function isAdmin() {
  return getAdmins().includes(getOperator());
}
export function addAdmin(name) {
  const list = getAdmins();
  if (name && !list.includes(name)) { list.push(name); localStorage.setItem(ADMIN_KEY, JSON.stringify(list)); }
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

let indexCache = null;  // 项目清单缓存，避免每次 route 都 fetch index.json（点文案卡顿主因）
export async function loadProjectList() {
  if (indexCache) return indexCache;
  try {
    const txt = await readText('data/index.json');
    indexCache = (JSON.parse(txt).projects) || [];
  } catch {
    indexCache = [];
  }
  return indexCache;
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
  if (projectCache.has(title)) return projectCache.get(title);
  // 只读模式（未授权目录）：优先读 IndexedDB 本地草稿（自己改过的），无则 fetch 服务器原始
  if (!dirHandle) {
    const draft = await idbGet('draft_' + title);
    if (draft) { projectCache.set(title, draft); return draft; }
  }
  const txt = await readText('data/' + title + '.json');
  const data = JSON.parse(txt);
  projectCache.set(title, data);
  return data;
}

export async function saveProject(data) {
  data.meta.updated = nowIso();
  const title = data.meta.title;
  projectCache.set(title, data);  // 内存缓存始终更新
  try {
    await writeText('data/' + title + '.json', JSON.stringify(data, null, 2));
    const list = await loadProjectList();
    const sum = projectSummary(data);
    const i = list.findIndex(p => p.title === title);
    if (i >= 0) list[i] = sum; else list.push(sum);
    await saveIndex(list);
  } catch (e) {
    if (e.message !== 'NO_DIR') throw e;
    // 只读模式：写 IndexedDB 本地草稿，刷新/退出都不丢（存在本机浏览器）
    await idbSet('draft_' + title, data);
  }
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
  // 预热素材图到浏览器缓存：首次加载时后台拉取，选图弹窗打开即显示，不卡
  assetsCache.forEach(a => { const img = new Image(); img.src = assetUrl(a); });
  return assetsCache;
}

/* ---------- 全局活动聚合（管理员后台用）：遍历所有项目 changelog ---------- */
export async function loadAllActivity() {
  const list = await loadProjectList();
  const all = [];
  for (const p of list) {
    let d;
    try { d = await loadProject(p.title); } catch { continue; }
    (d.changelog || []).forEach(c => all.push({ ts: c.ts, who: c.who, action: c.action, detail: c.detail, project: p.title, stage: p.stage }));
  }
  all.sort((a, b) => (b.ts || '').localeCompare(a.ts || ''));
  return all;
}

export function assetUrl(a) {
  return encodeURI('../Material Collection/' + a.folder + '/' + a.file);
}
export function assetById(assets, id) {
  return assets.find(a => a.id === id);
}
