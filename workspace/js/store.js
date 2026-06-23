// workspace/js/store.js
// 数据层：File System Access API 读写，data/index.json 管清单，operator 身份
import { nowIso, toast } from './utils.js';

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
// 删除所有指定前缀的 key（只读 key、不读 value，避免把大 blob 读进内存）。用于清理旧版原图缓存。
function idbDeletePrefix(prefix) {
  return new Promise(res => {
    const req = indexedDB.open('ss_store', 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains('kv')) req.result.createObjectStore('kv');
    };
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) { res(0); return; }
      const store = db.transaction('kv', 'readwrite').objectStore('kv');
      let n = 0;
      const open = store.openKeyCursor ? store.openKeyCursor() : store.openCursor();
      open.onsuccess = (e) => {
        const cur = e.target.result;
        if (!cur) return;
        const k = typeof cur.key === 'string' ? cur.key : (cur.primaryKey != null ? String(cur.primaryKey) : '');
        if (k.startsWith(prefix)) { store.delete(k); n++; }
        cur.continue();
      };
      store.transaction.oncomplete = () => res(n);
      store.transaction.onerror = () => res(n);
    };
    req.onerror = () => res(0);
  });
}

/* ---------- 操作者身份 ---------- */
export function getOperator() {
  return localStorage.getItem(OP_KEY) || '匿名';
}
export function setOperator(name) {
  localStorage.setItem(OP_KEY, name);
}

/* ---------- 管理员身份：服务端 /api/login 下发 isAdmin，存 localStorage ---------- */
const ADMIN_KEY = 'ss_is_admin';
export function isAdmin() {
  // lorrain 兜底：未登录过且昵称是 lorrain 时视为 admin（保证 server 未起时的本地可用性）
  const op = getOperator();
  if (op === 'lorrain' && localStorage.getItem(ADMIN_KEY) === null) return true;
  return localStorage.getItem(ADMIN_KEY) === '1';
}
export function setAdminFromServer(v) {
  localStorage.setItem(ADMIN_KEY, v ? '1' : '0');
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
  // 多人同步场景要新鲜度，每次都读（readText 已带 ?t= 防缓存）；数据小，无性能问题
  try {
    const txt = await readText('data/index.json');
    return (JSON.parse(txt).projects) || [];
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

// 向后兼容迁移：
//  ① 旧 shot.subject.assetId(单值) → assetIds(数组)
//  ② 旧 flat post/timing 单值格 → post 元素数组 + 独立 trans（design.schemaVer=2）
function migrateData(data) {
  const shots = (data.design && data.design.shots) || [];
  const last = shots.length - 1;
  shots.forEach((s, i) => {
    if (s.subject && !Array.isArray(s.subject.assetIds)) {
      s.subject.assetIds = s.subject.assetId ? [s.subject.assetId] : [];
      delete s.subject.assetId;
    }
    if (!Array.isArray(s.post)) {
      const oldPost = s.post || {};
      const oldTiming = s.timing || {};
      const KINDS = ['text', 'sticker', 'fx', 'anim'];
      const post = [];
      KINDS.forEach(k => {
        if (oldPost[k]) post.push({ kind: k, content: oldPost[k], range: null, note: oldTiming[k] || '' });
      });
      s.post = post;
      let tr = oldPost.trans;
      s.trans = (i < last && tr) ? tr : null;
      delete s.timing;
    }
  });
  if (data.design) data.design.schemaVer = 2;
  return data;
}

export async function loadProject(title) {
  if (projectCache.has(title)) return projectCache.get(title);
  // 无 FSA 时 readText 走 fetch（已带 ?t= 防缓存），以服务器为准（API 同步模式）
  const txt = await readText('data/' + title + '.json');
  const data = migrateData(JSON.parse(txt));
  projectCache.set(title, data);
  return data;
}

export async function saveProject(data) {
  data.meta.updated = nowIso();
  const title = data.meta.title;
  projectCache.set(title, data);  // 内存缓存始终更新
  if (dirHandle) {
    // localhost 运营者：FSA 直写（不变）
    try {
      await writeText('data/' + title + '.json', JSON.stringify(data, null, 2));
      const list = await loadProjectList();
      const sum = projectSummary(data);
      const i = list.findIndex(p => p.title === title);
      if (i >= 0) list[i] = sum; else list.push(sum);
      await saveIndex(list);
    } catch (e) {
      if (e.message !== 'NO_DIR') throw e;
      await idbSet('draft_' + title, data);  // FSA 句柄突然失效的兜底
    }
  } else {
    // 手机/成员：走 /api/save 同步
    const res = await fetch('/api/save', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (res.status === 409) {
      const r = await res.json().catch(() => ({}));
      if (r.server) projectCache.set(title, r.server);  // 用服务器版刷新缓存
      toast('该文案已被别人更新，正在刷新…');
      setTimeout(() => location.reload(), 900);
      return r.server || data;
    }
    if (res.status === 401) {
      toast('登录已过期，请重新登录');
      setTimeout(() => location.reload(), 900);  // reload 后 boot 的 /api/me 失败→弹登录
      return data;
    }
    if (!res.ok) throw new Error('保存失败(' + res.status + ')');
    const r = await res.json();
    data.meta.updated = r.updated;  // 用服务器接管后的时间
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
  // 注：图片的本地缓存 + 预加载由 preloadAssets 负责（落盘 IndexedDB，刷新/离线复用）
  return assetsCache;
}

// 登录后预加载：每张图优先读 IndexedDB 本地缓存（零下载），未命中才联网 fetch 并落盘；
// 生成的 blob URL 存进内存 Map，assetUrl 据此返回，设计台/选图台都直接用本地图。
let preloadPromise = null;
const blobUrlCache = new Map();   // assetId -> blob:URL（页面级内存，刷新后由 preload 重建）
export function preloadAssets(onProgress) {
  if (preloadPromise) return preloadPromise;
  preloadPromise = (async () => {
    const list = await loadAssets();
    if (!list.length) { if (onProgress) onProgress(0, 0); return list; }
    // 一次性迁移：清理旧版预加载残留的「原图」缓存（img_ 前缀，单条 2MB+），换成缩略图（thumb_ 前缀）
    if (!window.__ss_thumb_migrated) {
      window.__ss_thumb_migrated = true;
      idbDeletePrefix('img_').then(n => { if (n) console.log('[ss] 清理旧原图缓存', n, '条'); });
    }
    let done = 0;
    if (onProgress) onProgress(0, list.length);
    await Promise.all(list.map(async (a) => {
      try {
        if (!blobUrlCache.has(a.id)) {
          // key 带 mtime：图被替换(mtime 变) → key 变 → 自动重新下载，不命中旧缓存
          const cacheKey = 'thumb_' + a.id + '_' + (a.mtime || 0);
          let blob = await idbGet(cacheKey);                  // 1. 先查本地持久缓存
          if (!blob) {
            const res = await fetch(assetThumbUrl(a));        // 2. 未命中才联网下载（缩略图，~35KB/张）
            if (!res.ok) throw new Error(res.status);
            blob = await res.blob();
            await idbSet(cacheKey, blob);                     // 3. 落盘，下次刷新/离线直接用
          }
          blobUrlCache.set(a.id, URL.createObjectURL(blob));
        }
      } catch { /* 单张失败不卡整体，assetUrl 会回退 HTTP */ }
      done++;
      if (onProgress) onProgress(done, list.length);
    }));
    return list;
  })();
  return preloadPromise;
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

// 优先返回本地缓存的 blob URL（preload 命中后）；未预加载/未命中时回退【缩略图】HTTP（~15KB/张），
// 而非原图（2MB+）——否则预加载未跑完时开选图会直接拉原图、明显卡顿。
export function assetUrl(a) {
  const cached = blobUrlCache.get(a.id);
  return cached || assetThumbUrl(a);
}
// 素材图的原始 HTTP 路径（回退兜底 / 原图用；预加载不再下载它）
export function assetHttpUrl(a) {
  return encodeURI('../Material Collection/' + a.folder + '/' + a.file);
}
// 缩略图 HTTP 路径（预加载只下这个，~35KB/张；无 thumb 字段时回退原图）
export function assetThumbUrl(a) {
  return a.thumb ? encodeURI(a.thumb) : assetHttpUrl(a);
}
export function assetById(assets, id) {
  return assets.find(a => a.id === id);
}
