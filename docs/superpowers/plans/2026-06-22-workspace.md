# Script Studio Workspace 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭建一个纯前端工作台网站（workspace/），融合审核台和设计台，用 JSON 数据包驱动协作，通过本地服务器+内网穿透共享。

**Architecture:** ES Modules 单页应用 + hash 路由。数据层用 File System Access API（运营者 localhost 读写全自动，协作者隧道只读+导出）。一篇文案一个 JSON，data/index.json 管理清单，assets.json 由扫描脚本生成。

**Tech Stack:** 原生 ES Modules、HTML、CSS（无框架、无构建、无 npm）、Python（仅扫描素材脚本）、File System Access API。

**关键约束：**
- 所有 JS 用 ES Modules（`import/export`），不用全局变量
- 无构建步骤，文件即代码，`file://` 不可用（需 http-server）
- 素材图路径相对 `Material Collection/`，工作台从 Script Studio 根目录起跑

**前置准备（一次性，执行计划前确认）：**
- 确认 `C:\Users\26875\Desktop\Script Studio\Material Collection\` 目录存在且包含素材（按 `编号_构图_描述.扩展名` 命名，分子文件夹）

---

## 文件结构总览

```
workspace/
├── index.html              ← 入口
├── css/
│   ├── base.css            ← 变量、reset、布局骨架、侧栏、通用组件
│   ├── review.css          ← 审核面板样式
│   └── design.css          ← 设计面板样式
├── js/
│   ├── utils.js            ← esc/escAttr/toast/download/格式化时间
│   ├── store.js            ← 数据层（FSA API 读写、index.json、operator）
│   ├── app.js              ← 路由、侧栏、初始化
│   ├── dashboard.js        ← 总览面板
│   ├── picker.js           ← 选图弹窗（共享）
│   ├── review.js           ← 审核模块
│   ├── design.js           ← 设计模块
│   └── export.js           ← 导入/导出/合并/旧HTML迁移
├── data/                   ← JSON 数据（运行时由 store 读写）
│   └── index.json          ← 项目清单
├── assets.json             ← 素材清单（scan-assets.py 生成）
└── scripts/
    └── scan-assets.py      ← 扫描 Material Collection
```

---

## Task 1: 基础骨架

**Files:**
- Create: `workspace/index.html`
- Create: `workspace/css/base.css`
- Create: `workspace/js/utils.js`

- [ ] **Step 1: 创建 utils.js**

```js
// workspace/js/utils.js
// 工具函数模块，无依赖，所有模块共享

export function esc(s) {
  return String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

export function escAttr(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

let toastTimer = null;
export function toast(msg) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

export function download(name, content, type = 'text/plain') {
  const blob = new Blob([content], { type: type + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// 相对时间：几分钟前/几小时前/几天前
export function timeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return min + ' 分钟前';
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr + ' 小时前';
  const day = Math.floor(hr / 24);
  if (day < 30) return day + ' 天前';
  return new Date(iso).toLocaleDateString('zh-CN');
}

export function nowIso() {
  return new Date().toISOString();
}
```

- [ ] **Step 2: 创建 base.css**

```css
/* workspace/css/base.css */
:root {
  --bg: #f5f6f8;
  --card: #fff;
  --border: #e4e7eb;
  --text: #1f2329;
  --muted: #8a9099;
  --accent: #3370ff;
  --accent-bg: #eaf1ff;
  --ok: #00a870;
  --ok-bg: #e6f9f0;
  --warn: #d87a00;
  --warn-bg: #fff7e6;
  --high: #e34d53;
  --high-bg: #fff0f0;
  --ai: #8b5cf6;
  --ai-bg: #f3effe;
}

* { box-sizing: border-box; margin: 0; padding: 0; }

html, body { height: 100%; }

body {
  font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
  background: var(--bg);
  color: var(--text);
  line-height: 1.5;
  -webkit-tap-highlight-color: transparent;
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}

/* 顶栏 */
.topbar {
  background: var(--card);
  border-bottom: 1px solid var(--border);
  padding: 10px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-shrink: 0;
}
.topbar .brand { font-size: 16px; font-weight: 600; }
.topbar .brand .sub { font-size: 12px; color: var(--muted); font-weight: 400; margin-left: 6px; }
.topbar .right { display: flex; gap: 8px; align-items: center; }
.topbar .operator { font-size: 12px; color: var(--muted); }
.topbar .operator b { color: var(--accent); }

/* 布局 */
.layout { display: flex; flex: 1; min-height: 0; }
.sidebar {
  width: 200px;
  background: var(--card);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  overflow-y: auto;
}
.sidebar .nav-item {
  padding: 10px 16px;
  font-size: 14px;
  cursor: pointer;
  border-left: 3px solid transparent;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.sidebar .nav-item:hover { background: #f2f3f5; }
.sidebar .nav-item.active { background: var(--accent-bg); border-left-color: var(--accent); color: var(--accent); font-weight: 600; }
.sidebar .nav-item .stage-dot { font-size: 11px; }
.sidebar .nav-section { padding: 8px 16px 4px; font-size: 11px; color: var(--muted); font-weight: 600; }
.sidebar .new-btn { margin: 12px 16px; }

.main { flex: 1; min-width: 0; overflow-y: auto; }

/* 通用按钮 */
.btn {
  border: 1px solid var(--border);
  background: #fff;
  padding: 6px 13px;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  color: var(--text);
  font-family: inherit;
}
.btn:hover { background: #f2f3f5; }
.btn.primary { background: var(--accent); color: #fff; border-color: var(--accent); }
.btn.primary:hover { opacity: 0.92; }
.btn.ghost { color: var(--muted); }
.btn.ok { color: var(--ok); border-color: var(--ok); }

/* 通用面板 */
.panel { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 16px; }

/* tag / 标签 */
.tag { display: inline-block; font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 10px; }
.tag.high { background: var(--high-bg); color: var(--high); }
.tag.medium { background: var(--warn-bg); color: var(--warn); }
.tag.low { background: var(--ok-bg); color: var(--ok); }

/* stage 标签 */
.stage-tag { font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 10px; }
.stage-tag.review { background: var(--accent-bg); color: var(--accent); }
.stage-tag.design { background: var(--warn-bg); color: var(--warn); }
.stage-tag.done { background: var(--ok-bg); color: var(--ok); }

/* toast */
.toast {
  position: fixed; bottom: 28px; left: 50%; transform: translateX(-50%);
  background: #1f2329; color: #fff; padding: 9px 20px; border-radius: 20px;
  font-size: 13px; opacity: 0; transition: 0.2s; pointer-events: none; z-index: 100;
  max-width: 90vw; text-align: center;
}
.toast.show { opacity: 0.95; }

/* 手机适配 */
@media (max-width: 768px) {
  body { display: block; height: auto; overflow: auto; }
  .topbar { padding: 8px 12px; flex-wrap: wrap; }
  .topbar .brand { font-size: 15px; }
  .layout { flex-direction: column; }
  .sidebar {
    width: 100%;
    border-right: none;
    border-bottom: 1px solid var(--border);
    flex-direction: row;
    overflow-x: auto;
    overflow-y: hidden;
    padding: 8px;
    gap: 6px;
    order: 2;
  }
  .sidebar .nav-section { display: none; }
  .sidebar .nav-item {
    flex-shrink: 0;
    border-left: none;
    border-bottom: 3px solid transparent;
    padding: 6px 12px;
    border-radius: 6px;
  }
  .sidebar .nav-item.active { border-left: none; border-bottom-color: var(--accent); }
  .sidebar .new-btn { margin: 0; flex-shrink: 0; }
  .main { overflow: visible; order: 1; }
}
```

- [ ] **Step 3: 创建 index.html**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Script Studio · 工作台</title>
<link rel="stylesheet" href="css/base.css">
<link rel="stylesheet" href="css/review.css">
<link rel="stylesheet" href="css/design.css">
</head>
<body>
<div class="topbar">
  <div class="brand">🎬 Script Studio <span class="sub" id="subTitle">工作台</span></div>
  <div class="right">
    <span class="operator" id="operatorLabel" style="display:none">操作者：<b id="operatorName"></b></span>
    <button class="btn ghost" id="importBtn">📂 导入</button>
    <button class="btn" id="dirBtn">📁 选择工作目录</button>
  </div>
</div>
<div class="layout">
  <aside class="sidebar" id="sidebar"></aside>
  <main class="main" id="main"></main>
</div>
<div id="modalRoot"></div>
<input type="file" id="fileIn" accept=".json" style="display:none">
<script type="module" src="js/app.js"></script>
</body>
</html>
```

- [ ] **Step 4: 提交**

```bash
cd "C:/Users/26875/Desktop/Script Studio"
git add workspace/index.html workspace/css/base.css workspace/js/utils.js
git commit -m "feat(workspace): 基础骨架——index.html、base.css、utils.js"
```

---

## Task 2: 数据层 store.js

**Files:**
- Create: `workspace/js/store.js`

**说明：** 用 File System Access API 读写。运营者授权 workspace/ 目录后读写全自动；未授权时读用 fetch、写降级为下载。目录句柄存 IndexedDB 以跨会话保留。

- [ ] **Step 1: 创建 store.js（完整实现）**

```js
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
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
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
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
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
  return typeof window.showDirectoryPicker === 'function';
}

export async function initStore() {
  // 恢复句柄
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

// 请求已存句柄的写权限（用户交互后调用）
export async function ensurePermission() {
  if (!dirHandle) return false;
  const perm = await dirHandle.requestPermission({ mode: 'readwrite' });
  return perm === 'granted';
}

/* ---------- 文件读写 ---------- */
async function resolvePath(path) {
  // path 形如 "data/index.json"，从 dirHandle 逐级解析
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
  const res = await fetch('workspace/' + path + '?t=' + Date.now());
  if (!res.ok) throw new Error('读取失败: ' + path);
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
    return [];  // 无 index.json 视为空
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
  // 更新 index
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

// 追加 changelog 并保存（模块调用此函数记录操作）
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

// 素材图 URL（相对 Script Studio 根目录）
export function assetUrl(a) {
  // workspace/ 在根目录下，素材在 ../Material Collection/
  return encodeURI('../Material Collection/' + a.folder + '/' + a.file);
}
export function assetById(assets, id) {
  return assets.find(a => a.id === id);
}
```

- [ ] **Step 2: 提交**

```bash
git add workspace/js/store.js
git commit -m "feat(workspace): 数据层 store.js——FSA API 读写、index.json、operator"
```

---

## Task 3: 应用主框架 app.js

**Files:**
- Create: `workspace/js/app.js`

**说明：** 路由、侧栏渲染、初始化（operator 弹窗、目录授权）、导入按钮接线。dashboard/review/design/export 模块在后续 Task 创建，这里先写骨架并 import，未完成的模块先返回占位。

- [ ] **Step 1: 创建 app.js（完整实现）**

```js
// workspace/js/app.js
// 入口：路由、侧栏、初始化
import * as store from './store.js';
import * as utils from './utils.js';
import { renderDashboard } from './dashboard.js';
import { renderReview } from './review.js';
import { renderDesign } from './design.js';
import { importJSONFile } from './export.js';

const $ = id => document.getElementById(id);
let currentTitle = null;  // 当前打开的项目标题（侧栏高亮）

/* ---------- 初始化 ---------- */
async function boot() {
  setupOperator();
  setupDirButton();
  setupImport();
  window.addEventListener('hashchange', route);
  route();
}

function setupOperator() {
  const name = store.getOperator();
  if (name === '匿名' || !localStorage.getItem('ss_operator')) {
    promptOperator();
  } else {
    showOperator(name);
  }
}

function promptOperator() {
  const name = prompt('请输入你的昵称（用于记录操作）', '');
  if (name && name.trim()) {
    store.setOperator(name.trim());
    showOperator(name.trim());
  }
}

function showOperator(name) {
  $('operatorLabel').style.display = '';
  $('operatorName').textContent = name;
}

async function setupDirButton() {
  const btn = $('dirBtn');
  const hasFsa = store.isFsaSupported();
  const restored = hasFsa && await store.initStore();

  function refreshBtn() {
    if (!hasFsa) {
      btn.textContent = '📡 只读模式';
      btn.disabled = true;
      btn.title = '当前浏览器/环境不支持写入，仅浏览+导出';
    } else if (store.hasDir()) {
      btn.textContent = '✓ 已授权';
      btn.disabled = true;
    } else {
      btn.textContent = '📁 选择工作目录';
      btn.disabled = false;
    }
  }
  refreshBtn();

  btn.addEventListener('click', async () => {
    if (!hasFsa) return;
    try {
      await store.pickDirectory();
      refreshBtn();
      utils.toast('已授权，可读写 data/');
      route();  // 重新渲染
    } catch (e) {
      if (e.name !== 'AbortError') utils.toast('授权失败：' + e.message);
    }
  });
}

function setupImport() {
  $('importBtn').addEventListener('click', () => $('fileIn').click());
  $('fileIn').addEventListener('change', async e => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      await importJSONFile(f);
      utils.toast('导入成功');
      route();
    } catch (err) {
      utils.toast('导入失败：' + err.message);
    }
    e.target.value = '';
  });
}

/* ---------- 路由 ---------- */
async function route() {
  const hash = location.hash.slice(1) || 'dashboard';
  await renderSidebar();

  if (hash === 'dashboard' || hash === '') {
    currentTitle = null;
    $('subTitle').textContent = '总览';
    const projects = await store.loadProjectList();
    renderDashboard(projects, $('main'), { onOpen: openProject, onNew: newProject });
    return;
  }

  // #标题/review 或 #标题/design
  const slashIdx = hash.lastIndexOf('/');
  const mode = slashIdx >= 0 ? hash.slice(slashIdx + 1) : '';
  const title = slashIdx >= 0 ? hash.slice(0, slashIdx) : hash;
  currentTitle = title;

  // URL 中的中文标题需解码
  const decodedTitle = decodeURIComponent(title);
  try {
    const data = await store.loadProject(decodedTitle);
    if (mode === 'review') {
      $('subTitle').textContent = '审核 · ' + decodedTitle;
      renderReview(data, $('main'));
    } else if (mode === 'design') {
      $('subTitle').textContent = '设计 · ' + decodedTitle;
      renderDesign(data, $('main'));
    } else {
      // 无 mode，按 stage 跳转
      const m = data.meta.stage === 'design' || data.meta.stage === 'done' ? 'design' : 'review';
      location.hash = encodeURIComponent(decodedTitle) + '/' + m;
    }
  } catch (err) {
    $('main').innerHTML = '<div style="padding:40px;text-align:center;color:#8a9099">加载失败：' + utils.esc(err.message) + '<br><br>提示：需先「选择工作目录」授权，且 data/' + utils.esc(decodedTitle) + '.json 存在</div>';
  }
}

/* ---------- 侧栏 ---------- */
async function renderSidebar() {
  const projects = await store.loadProjectList();
  const stageLabel = { review: '🔵', design: '🟡', done: '🟢' };
  const stageText = { review: '审核中', design: '设计中', done: '已完成' };

  const items = projects.map(p => {
    const active = currentTitle === p.title ? 'active' : '';
    const stage = encodeURIComponent(p.title) + (p.stage === 'design' || p.stage === 'done' ? '/design' : '/review');
    return `<div class="nav-item ${active}" onclick="location.hash='${stage}'">
      <span>📄 ${utils.esc(p.title)}</span>
      <span class="stage-dot" title="${stageText[p.stage]||''}">${stageLabel[p.stage]||''}</span>
    </div>`;
  }).join('');

  $('sidebar').innerHTML = `
    <div class="nav-item ${!currentTitle ? 'active' : ''}" onclick="location.hash='dashboard'">📊 总览</div>
    <div class="nav-section">文案 (${projects.length})</div>
    ${items || '<div class="nav-section" style="padding-top:0">暂无文案</div>'}
    <button class="btn new-btn" onclick="window.__newProject()">＋ 新建文案</button>
  `;
}

window.__newProject = newProject;

async function newProject() {
  const title = prompt('输入文案标题', '');
  if (!title || !title.trim()) return;
  const t = title.trim();
  if (!store.hasDir()) {
    utils.toast('请先「选择工作目录」授权后再新建');
    return;
  }
  try {
    await store.createProject(t);
    utils.toast('已创建：' + t);
    location.hash = encodeURIComponent(t) + '/review';
  } catch (err) {
    utils.toast('创建失败：' + err.message);
  }
}

function openProject(title, mode) {
  location.hash = encodeURIComponent(title) + '/' + mode;
}

boot();
```

- [ ] **Step 2: 创建后续模块的占位文件（避免 import 报错）**

为了本 Task 结束时 app.js 能跑通，先创建 dashboard/review/design/export 的最小占位实现。后续 Task 会替换它们。

创建 `workspace/js/dashboard.js`：
```js
// workspace/js/dashboard.js（占位，Task 5 替换）
import * as utils from './utils.js';
export function renderDashboard(projects, main, handlers) {
  main.innerHTML = '<div style="padding:40px;text-align:center;color:#8a9099">总览面板待实现（Task 5）</div>';
}
```

创建 `workspace/js/review.js`：
```js
// workspace/js/review.js（占位，Task 7 替换）
export function renderReview(data, main) {
  main.innerHTML = '<div style="padding:40px;text-align:center;color:#8a9099">审核模块待实现（Task 7）</div>';
}
```

创建 `workspace/js/design.js`：
```js
// workspace/js/design.js（占位，Task 8 替换）
export function renderDesign(data, main) {
  main.innerHTML = '<div style="padding:40px;text-align:center;color:#8a9099">设计模块待实现（Task 8）</div>';
}
```

创建 `workspace/js/export.js`：
```js
// workspace/js/export.js（占位，Task 9 替换）
export async function importJSONFile(file) {
  throw new Error('导入功能待实现（Task 9）');
}
```

- [ ] **Step 3: 启动服务器验证骨架**

```bash
cd "C:/Users/26875/Desktop/Script Studio"
python -m http.server 8080
```

浏览器打开 `http://localhost:8080/workspace/`：
- 顶栏显示标题、导入按钮、目录按钮
- 点「选择工作目录」应弹出目录选择器（选 workspace/ 文件夹）
- 授权后按钮变「✓ 已授权」
- 侧栏显示「📊 总览」+「暂无文案」+「＋ 新建文案」
- 主区域显示「总览面板待实现」
- 点「＋ 新建文案」输入标题 → 提示授权 → 创建成功 → 跳转审核页（显示占位）
- 首次访问应弹出输入昵称的 prompt

Expected: 上述行为均正常，无 console 报错。

- [ ] **Step 4: 提交**

```bash
git add workspace/js/app.js workspace/js/dashboard.js workspace/js/review.js workspace/js/design.js workspace/js/export.js
git commit -m "feat(workspace): 应用主框架 app.js——路由、侧栏、初始化（含占位模块）"
```

---

## Task 4: 素材扫描脚本 scan-assets.py

**Files:**
- Create: `workspace/scripts/scan-assets.py`

**说明：** 扫描 `Material Collection/` 各子文件夹，按文件名 `编号_构图_描述.扩展名` 解析，生成 `workspace/assets.json`。命名规则与现有 storyboard HTML 的 ASSETS 一致。

- [ ] **Step 1: 确认 Material Collection 结构**

```bash
ls "C:/Users/26875/Desktop/Script Studio/Material Collection/"
```

确认有按情绪分类的子文件夹（如 `01_悲伤`、`02_愤怒` 等），文件名形如 `01_全身_哭.png`。

- [ ] **Step 2: 创建 scan-assets.py**

```python
# workspace/scripts/scan-assets.py
# 扫描 ../../Material Collection/ 生成 ../assets.json
# 文件名格式：编号_构图_描述.扩展名  （如 01_全身_哭.png）
# 文件夹名格式：编号_分类  （如 01_悲伤）
import os
import json
import sys

CAT_MAP = {
    '01': '悲伤', '02': '愤怒', '03': '懵圈无力',
    '04': '打工人', '05': '开心', '06': '转场特效'
}

def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    workspace_dir = os.path.dirname(script_dir)
    repo_root = os.path.dirname(workspace_dir)
    mat_dir = os.path.join(repo_root, 'Material Collection')

    if not os.path.isdir(mat_dir):
        print('错误：找不到 Material Collection 目录：' + mat_dir, file=sys.stderr)
        sys.exit(1)

    assets = []
    for folder in sorted(os.listdir(mat_dir)):
        folder_path = os.path.join(mat_dir, folder)
        if not os.path.isdir(folder_path):
            continue
        # 文件夹名解析：编号_分类
        folder_parts = folder.split('_', 1)
        cat = folder_parts[1] if len(folder_parts) > 1 else CAT_MAP.get(folder_parts[0], folder)

        for fname in sorted(os.listdir(folder_path)):
            if not fname.lower().endswith(('.png', '.jpg', '.jpeg', '.webp')):
                continue
            # 文件名解析：编号_构图_描述.扩展名
            name_no_ext = os.path.splitext(fname)[0]
            parts = name_no_ext.split('_', 2)
            if len(parts) < 3:
                print('跳过（命名不符）：' + fname, file=sys.stderr)
                continue
            aid, framing, desc = parts[0], parts[1], parts[2]
            assets.append({
                'id': aid,
                'file': fname,
                'folder': folder,
                'cat': cat,
                'action': '',
                'framing': framing,
                'state': '',
                'prop': '',
                'desc': desc
            })

    out_path = os.path.join(workspace_dir, 'assets.json')
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(assets, f, ensure_ascii=False, indent=2)

    print('已生成 ' + out_path)
    print('共 ' + str(len(assets)) + ' 个素材')

if __name__ == '__main__':
    main()
```

- [ ] **Step 3: 运行脚本生成 assets.json**

```bash
cd "C:/Users/26875/Desktop/Script Studio"
python workspace/scripts/scan-assets.py
```

Expected: 输出「已生成 ...assets.json」「共 N 个素材」，`workspace/assets.json` 生成，内容为数组，每项含 id/file/folder/cat/framing/desc 等字段。

- [ ] **Step 4: 提交**

```bash
git add workspace/scripts/scan-assets.py workspace/assets.json
git commit -m "feat(workspace): 素材扫描脚本 scan-assets.py + 生成 assets.json"
```

---

## Task 5: 总览面板 dashboard.js

**Files:**
- Modify: `workspace/js/dashboard.js`（替换占位）

**说明：** 项目卡片网格 + 统计栏。卡片显示标题、阶段、进度、最后编辑。按钮：查看审核/进入设计/导出。加载项目详情算进度（需读完整 JSON）。

- [ ] **Step 1: 替换 dashboard.js（完整实现）**

```js
// workspace/js/dashboard.js
import * as store from './store.js';
import * as utils from './utils.js';
import { exportProject } from './export.js';

const STAGE_LABEL = { review: '🔵 审核中', design: '🟡 设计中', done: '🟢 已完成' };

export async function renderDashboard(projects, main, handlers) {
  if (!projects.length) {
    main.innerHTML = `
      <div style="padding:60px 24px;text-align:center;color:#8a9099">
        <div style="font-size:48px;margin-bottom:16px">🎬</div>
        <div style="font-size:16px;margin-bottom:8px">还没有文案</div>
        <div style="font-size:13px;margin-bottom:20px">用 /script-review 生成，或点侧栏「＋ 新建文案」</div>
        <button class="btn primary" onclick="window.__newProject()">＋ 新建文案</button>
      </div>`;
    return;
  }

  // 统计
  const stat = { review: 0, design: 0, done: 0 };
  projects.forEach(p => { stat[p.stage] = (stat[p.stage] || 0) + 1; });

  // 加载每个项目的详情算进度
  const cards = await Promise.all(projects.map(p => loadCard(p)));

  main.innerHTML = `
    <div style="padding:20px 24px">
      <div class="dash-stat" style="font-size:13px;color:#8a9099;margin-bottom:16px">
        共 <b style="color:#1f2329">${projects.length}</b> 篇
        ｜ 🔵 审核中 <b>${stat.review||0}</b>
        ｜ 🟡 设计中 <b>${stat.design||0}</b>
        ｜ 🟢 已完成 <b>${stat.done||0}</b>
      </div>
      <div class="project-grid">
        ${cards.join('')}
      </div>
    </div>
  `;

  // 绑定按钮（事件委托）
  main.querySelector('.project-grid').addEventListener('click', onCardClick);
}

async function loadCard(p) {
  let progress = '';
  let lastEdit = '';
  try {
    const data = await store.loadProject(p.title);
    // 进度
    if (data.meta.stage === 'review' || data.review.items.length) {
      const decided = Object.keys(data.review.decisions).length;
      const total = data.review.items.length;
      progress = `审核 ${decided}/${total}`;
    }
    if (data.design.shots.length) {
      const designed = data.design.shots.filter(s => s.subject && s.subject.type).length;
      progress = (progress ? progress + ' · ' : '') + `设计 ${designed}/${data.design.shots.length}镜`;
    }
    // 最后编辑
    const log = data.changelog && data.changelog[data.changelog.length - 1];
    if (log) lastEdit = `${utils.esc(log.who)} · ${utils.timeAgo(log.ts)}`;
  } catch (e) {
    progress = '（无法读取）';
  }

  return `
    <div class="proj-card panel" data-title="${utils.escAttr(p.title)}">
      <div class="proj-head">
        <span class="proj-title">📄 ${utils.esc(p.title)}</span>
        <span class="stage-tag ${p.stage}">${STAGE_LABEL[p.stage] || ''}</span>
      </div>
      <div class="proj-progress">${progress || '（空）'}</div>
      <div class="proj-last">${lastEdit}</div>
      <div class="proj-actions">
        <button class="btn" data-act="review" data-title="${utils.escAttr(p.title)}">查看审核</button>
        <button class="btn" data-act="design" data-title="${utils.escAttr(p.title)}">进入设计</button>
        <button class="btn ghost" data-act="export" data-title="${utils.escAttr(p.title)}">导出</button>
      </div>
    </div>
  `;
}

async function onCardClick(e) {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;
  const title = btn.dataset.title;
  if (act === 'review' || act === 'design') {
    location.hash = encodeURIComponent(title) + '/' + act;
  } else if (act === 'export') {
    try {
      const data = await store.loadProject(title);
      await exportProject(data);
    } catch (err) {
      utils.toast('导出失败：' + err.message);
    }
  }
}
```

- [ ] **Step 2: 追加 dashboard 样式到 base.css**

在 `workspace/css/base.css` 末尾（手机适配之前）追加：

```css
/* dashboard */
.project-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 14px;
}
.proj-card { display: flex; flex-direction: column; gap: 8px; }
.proj-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.proj-title { font-size: 15px; font-weight: 600; }
.proj-progress { font-size: 13px; color: var(--accent); }
.proj-last { font-size: 12px; color: var(--muted); }
.proj-actions { display: flex; gap: 6px; margin-top: 6px; flex-wrap: wrap; }
.proj-actions .btn { padding: 5px 11px; font-size: 12px; }
```

- [ ] **Step 3: 验证**

```bash
cd "C:/Users/26875/Desktop/Script Studio"
python -m http.server 8080
```

浏览器打开 `http://localhost:8080/workspace/#dashboard`：
- 若有项目，显示卡片网格、统计栏
- 卡片显示标题、阶段标签、进度、最后编辑
- 点「查看审核」/「进入设计」跳转对应页（仍为占位）
- 点「导出」提示「导出功能待实现」（Task 9 前会报错，正常）

- [ ] **Step 4: 提交**

```bash
git add workspace/js/dashboard.js workspace/css/base.css
git commit -m "feat(workspace): 总览面板 dashboard.js——项目卡片、统计、进度"
```

---

## Task 6: 选图弹窗 picker.js

**Files:**
- Create: `workspace/js/picker.js`
- Modify: `workspace/css/base.css`（追加弹窗样式）

**说明：** 共享选图弹窗。搜索 + 情绪分类 + 构图筛选 + 缩略图网格。单选/多选通过 `multi` 控制，选中后回调 `onSelect`。

- [ ] **Step 1: 创建 picker.js（完整实现）**

```js
// workspace/js/picker.js
import * as store from './store.js';
import * as utils from './utils.js';

const CATS = ['全部', '悲伤', '愤怒', '懵圈无力', '打工人', '开心', '转场特效'];
const FRAMINGS = ['全部', '全身', '上半身', '转场'];

let modalState = null;  // { assets, currentId, multi, onSelect, filterCat, filterFrm, query }

export function openPicker(opts) {
  modalState = {
    assets: opts.assets || [],
    currentId: opts.currentId,
    currentIds: opts.currentIds || [],
    multi: opts.multi || false,
    onSelect: opts.onSelect,
    title: opts.title || '选图',
    sub: opts.sub || '',
    filterCat: '全部',
    filterFrm: '全部',
    query: ''
  };
  renderModal();
}

export function closePicker() {
  modalState = null;
  const root = document.getElementById('modalRoot');
  if (root) root.innerHTML = '';
}

function renderModal() {
  const root = document.getElementById('modalRoot');
  root.innerHTML = `
    <div class="modal on" id="pickerModal">
      <div class="modal-box">
        <div class="modal-head">
          <div>
            <div class="t">${utils.esc(modalState.title)}</div>
            <div class="s">${utils.esc(modalState.sub)}</div>
          </div>
          <button class="btn ghost" id="pickerClose">✕ 完成</button>
        </div>
        <div class="filters">
          <input class="search" id="pickerSearch" placeholder="🔍 搜索：存钱罐 / 背身 / 墨镜 / 推车 …" value="${utils.escAttr(modalState.query)}">
          <div class="chips" id="pickerCatChips"></div>
          <div class="chips" id="pickerFrmChips"></div>
        </div>
        <div class="grid" id="pickerGrid"></div>
      </div>
    </div>
  `;

  // 绑定
  document.getElementById('pickerClose').onclick = closePicker;
  document.getElementById('pickerModal').addEventListener('click', e => {
    if (e.target.id === 'pickerModal') closePicker();
  });
  document.getElementById('pickerSearch').oninput = e => {
    modalState.query = e.target.value;
    renderGrid();
  };

  renderChips();
  renderGrid();
}

function renderChips() {
  document.getElementById('pickerCatChips').innerHTML = CATS.map(c =>
    `<button class="chip ${c === modalState.filterCat ? 'on' : ''}" data-cat="${utils.escAttr(c)}">${c}</button>`
  ).join('');
  document.getElementById('pickerFrmChips').innerHTML = FRAMINGS.map(f =>
    `<button class="chip ${f === modalState.filterFrm ? 'on' : ''}" data-frm="${utils.escAttr(f)}">${f}</button>`
  ).join('');

  document.getElementById('pickerCatChips').onclick = e => {
    const b = e.target.closest('button[data-cat]');
    if (!b) return;
    modalState.filterCat = b.dataset.cat;
    renderChips(); renderGrid();
  };
  document.getElementById('pickerFrmChips').onclick = e => {
    const b = e.target.closest('button[data-frm]');
    if (!b) return;
    modalState.filterFrm = b.dataset.frm;
    renderChips(); renderGrid();
  };
}

function getSelected() {
  if (modalState.multi) return modalState.currentIds.slice();
  return modalState.currentId ? [modalState.currentId] : [];
}

function renderGrid() {
  const q = modalState.query.trim().toLowerCase();
  const list = modalState.assets.filter(a => {
    if (modalState.filterCat !== '全部' && a.cat !== modalState.filterCat) return false;
    if (modalState.filterFrm !== '全部' && a.framing !== modalState.filterFrm) return false;
    if (q) {
      const hay = (a.id + ' ' + a.desc + ' ' + a.action + ' ' + a.state + ' ' + a.prop + ' ' + a.cat).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const grid = document.getElementById('pickerGrid');
  if (!list.length) {
    grid.innerHTML = '<div class="empty-grid">没找到匹配的素材</div>';
    return;
  }
  const selected = getSelected();
  grid.innerHTML = list.map(a => {
    const sel = selected.includes(a.id) ? 'sel' : '';
    return `<div class="asset ${sel}" data-id="${utils.escAttr(a.id)}">
      <img src="${store.assetUrl(a)}" loading="lazy" onerror="this.style.background='#fee'">
      <div class="cap"><b>${utils.esc(a.id)}</b> ${utils.esc(a.desc)}<br><span style="opacity:.7">${utils.esc(a.cat)}/${utils.esc(a.framing)}</span></div>
    </div>`;
  }).join('');

  grid.onclick = e => {
    const el = e.target.closest('.asset');
    if (!el) return;
    pick(el.dataset.id);
  };
}

function pick(id) {
  if (!modalState) return;
  if (modalState.multi) {
    const idx = modalState.currentIds.indexOf(id);
    if (idx === -1) modalState.currentIds.push(id);
    else modalState.currentIds.splice(idx, 1);
    modalState.onSelect(modalState.currentIds.slice());
    renderGrid();
  } else {
    modalState.currentId = id;
    modalState.onSelect(id);
    closePicker();
  }
}
```

- [ ] **Step 2: 追加弹窗样式到 base.css**

在 `workspace/css/base.css` 追加：

```css
/* 选图弹窗 */
.modal { position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 50; display: none; }
.modal.on { display: block; }
.modal-box { background: var(--card); max-width: 880px; margin: 4vh auto 0; border-radius: 12px; height: 92vh; display: flex; flex-direction: column; overflow: hidden; }
.modal-head { padding: 14px 18px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; gap: 10px; }
.modal-head .t { font-weight: 600; font-size: 15px; }
.modal-head .s { font-size: 12px; color: var(--muted); margin-top: 2px; }
.filters { padding: 12px 18px; border-bottom: 1px solid var(--border); display: flex; flex-direction: column; gap: 9px; background: #fafbfc; }
.search { width: 100%; border: 1px solid var(--border); border-radius: 6px; padding: 8px 11px; font-size: 13px; font-family: inherit; outline: none; }
.search:focus { border-color: var(--accent); }
.chips { display: flex; gap: 6px; flex-wrap: wrap; }
.chip { border: 1px solid var(--border); background: #fff; padding: 4px 11px; border-radius: 14px; font-size: 12px; cursor: pointer; color: var(--muted); font-family: inherit; }
.chip:hover { background: #f2f3f5; }
.chip.on { background: var(--accent); color: #fff; border-color: var(--accent); }
.grid { flex: 1; overflow: auto; padding: 14px 18px; display: grid; grid-template-columns: repeat(auto-fill, minmax(108px, 1fr)); gap: 12px; align-content: start; }
.asset { cursor: pointer; border: 2px solid transparent; border-radius: 8px; overflow: hidden; background: #fff; display: flex; flex-direction: column; }
.asset img { width: 100%; aspect-ratio: 1; object-fit: contain; background: #fff; display: block; }
.asset .cap { font-size: 11px; color: var(--muted); padding: 5px 6px 6px; line-height: 1.3; background: #fff; }
.asset .cap b { color: var(--text); font-weight: 600; font-size: 12px; }
.asset:hover { border-color: var(--accent); }
.asset.sel { border-color: var(--ok); box-shadow: 0 0 0 1px var(--ok) inset; }
.asset.sel .cap { background: var(--ok-bg); }
.empty-grid { grid-column: 1/-1; text-align: center; color: var(--muted); padding: 40px 0; font-size: 13px; }

@media (max-width: 768px) {
  .modal-box { margin: 0; height: 100vh; border-radius: 0; max-width: 100%; }
  .grid { grid-template-columns: repeat(2, 1fr); padding: 12px; }
}
```

- [ ] **Step 3: 验证**

弹窗需要从 design 模块触发，Task 8 会完整验证。本 Task 只确认 picker.js 无语法错误：

```bash
cd "C:/Users/26875/Desktop/Script Studio"
python -m http.server 8080
```

浏览器 console 无 import 报错即可。

- [ ] **Step 4: 提交**

```bash
git add workspace/js/picker.js workspace/css/base.css
git commit -m "feat(workspace): 选图弹窗 picker.js——搜索、分类、构图筛选、单/多选"
```

---

## Task 7: 审核模块 review.js + review.css

**Files:**
- Modify: `workspace/js/review.js`（替换占位）
- Modify: `workspace/css/review.css`

**说明：** 从 `审核台/_template.html` 迁移逻辑为 ES Module。核心：原文高亮、问题卡片、采纳/保留、输出拼合、字幕断句切换。新增「推入设计台」按钮。每次操作调 store.saveProject。

- [ ] **Step 1: 创建 review.css**

```css
/* workspace/css/review.css */
.review-wrap { padding: 16px 24px 80px; max-width: 1500px; margin: 0 auto; }
.review-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 8px; }
.review-head h1 { font-size: 17px; font-weight: 600; }
.review-head .verdict { font-size: 13px; color: var(--muted); }

.review-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
  grid-template-areas: "original items" "output items";
  gap: 14px;
}
.review-grid .panel-original { grid-area: original; }
.review-grid .panel-output { grid-area: output; }
.review-grid .panel-items { grid-area: items; }

.rev-panel { display: flex; flex-direction: column; min-height: 300px; max-height: 70vh; overflow: hidden; }
.rev-panel h2 { font-size: 13px; margin: 0 0 10px; color: var(--muted); font-weight: 500; display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; }
.sort-bar { display: flex; gap: 6px; }
.sort-btn { border: 1px solid var(--border); background: #fff; color: var(--muted); padding: 3px 11px; border-radius: 14px; font-size: 11px; cursor: pointer; font-weight: 500; white-space: nowrap; }
.sort-btn:hover { background: #f2f3f5; }
.sort-btn.on { background: var(--accent); color: #fff; border-color: var(--accent); }

#revOriginal { font-size: 14px; line-height: 2.1; white-space: pre-wrap; word-break: break-word; flex: 1; overflow: auto; padding: 12px; border: 1px solid var(--border); border-radius: 8px; }
mark.h { background: var(--high-bg); color: var(--high); border-bottom: 2px solid var(--high); padding: 0 2px; border-radius: 2px; }
mark.m { background: var(--warn-bg); color: var(--warn); border-bottom: 2px solid var(--warn); padding: 0 2px; border-radius: 2px; }
mark.l { background: var(--ok-bg); color: var(--ok); border-bottom: 2px dashed var(--ok); padding: 0 2px; border-radius: 2px; }

#revItems { display: flex; flex-direction: column; gap: 10px; flex: 1; overflow: auto; padding-right: 4px; }
.rev-card { border: 1px solid var(--border); border-radius: 8px; padding: 12px; transition: .15s; }
.rev-card.adopted { border-color: var(--ok); background: #f5fcf8; }
.rev-card .cat { font-size: 12px; color: var(--muted); margin-left: 6px; }
.rev-line { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 14px; margin: 8px 0; }
.rev-line .from { text-decoration: line-through; color: var(--muted); }
.rev-line .arrow { color: var(--muted); }
.edit-sug { flex: 1; min-width: 140px; font-size: 14px; font-family: inherit; color: var(--ok); font-weight: 600; border: 1px dashed var(--ok); background: #f5fcf8; border-radius: 5px; padding: 5px 8px; outline: none; }
.edit-sug:focus { border-style: solid; background: #fff; }
.rev-reason { font-size: 12px; color: var(--muted); margin: 6px 0 10px; line-height: 1.6; }
.rev-actions { display: flex; gap: 8px; }
.rev-actions .btn.yes { color: var(--ok); border-color: var(--ok); }
.rev-actions .btn.yes.on { background: var(--ok); color: #fff; }
.rev-actions .btn.no.on { background: #e4e7eb; color: var(--text); border-color: #c9cdd4; }

.out-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; gap: 10px; flex-wrap: wrap; }
.out-head .btns { display: flex; gap: 8px; }
#revOutput { width: 100%; flex: 1; min-height: 120px; border: 1px solid var(--border); border-radius: 8px; padding: 12px; font-size: 14px; line-height: 1.9; font-family: inherit; resize: none; color: var(--text); }
#revOutput:focus { border-color: var(--accent); }
.split-btn { background: #fff; border: 1px solid var(--border); color: var(--muted); padding: 5px 12px; border-radius: 6px; font-size: 13px; cursor: pointer; }
.split-btn:hover { background: #f2f3f5; }
.split-btn.active { background: var(--ok-bg); border-color: var(--ok); color: var(--ok); font-weight: 600; }

@media (max-width: 768px) {
  .review-wrap { padding: 12px; }
  .review-grid { grid-template-columns: 1fr; grid-template-areas: "original" "items" "output"; }
  .rev-panel { max-height: none; }
  #revOriginal { font-size: 15px; line-height: 1.95; }
  .rev-line { flex-direction: column; align-items: stretch; gap: 5px; }
  .edit-sug { min-width: 100%; font-size: 15px; padding: 9px 10px; }
  .rev-actions .btn { flex: 1; padding: 10px; font-size: 14px; min-height: 42px; }
}
```

- [ ] **Step 2: 替换 review.js（完整实现，迁移自 _template.html）**

```js
// workspace/js/review.js
import * as store from './store.js';
import * as utils from './utils.js';

const LEVEL_RANK = { high: 3, medium: 2, low: 1 };
const LEVEL_LABEL = { high: '🔴 高危', medium: '🟡 中危', low: '🟢 低危' };
const LEVEL_CLS = { high: 'h', medium: 'm', low: 'l' };

export async function renderReview(data, main) {
  // 本地状态：基于 data.review
  const review = data.review;
  if (!review.decisions) review.decisions = {};
  if (!review.items) review.items = [];

  // 初始化 decisions（沿用现有 suggestion 作为 editedSuggestion）
  review.items.forEach(it => {
    if (!review.decisions[it.id]) review.decisions[it.id] = { adopted: false, editedSuggestion: it.suggestion };
  });

  let sortOrder = 'risk';
  let splitMode = false;
  let origSplitMode = false;

  main.innerHTML = `
    <div class="review-wrap">
      <div class="review-head">
        <h1>🛡️ 文案审核 · ${utils.esc(data.meta.title)}</h1>
        <div class="verdict">${utils.esc(review.platform || '')} ${review.verdict ? '· ' + utils.esc(review.verdict) : ''}</div>
      </div>
      <div class="review-grid">
        <section class="panel rev-panel panel-original">
          <h2><span>原文</span><button class="split-btn" id="origSplitBtn">✂️ 字幕断句</button></h2>
          <div id="revOriginal"></div>
        </section>
        <section class="panel rev-panel panel-items">
          <h2><span>采纳区</span>
            <span class="sort-bar">
              <button class="sort-btn on" data-sort="risk">⚠️ 危险程度</button>
              <button class="sort-btn" data-sort="text">📜 文案顺序</button>
            </span>
          </h2>
          <div id="revItems"></div>
        </section>
        <section class="panel rev-panel panel-output">
          <div class="out-head">
            <h2 style="margin:0">输出</h2>
            <div class="btns">
              <button class="split-btn" id="splitBtn">✂️ 字幕断句</button>
              <button class="btn primary" id="copyBtn">📋 复制</button>
              <button class="btn ok" id="pushDesignBtn">→ 推入设计台</button>
            </div>
          </div>
          <textarea id="revOutput" placeholder="实时拼合修改后的文案"></textarea>
        </section>
      </div>
    </div>
  `;

  // 排序
  main.querySelectorAll('.sort-btn').forEach(b => {
    b.onclick = () => {
      sortOrder = b.dataset.sort;
      main.querySelectorAll('.sort-btn').forEach(x => x.classList.toggle('on', x.dataset.sort === sortOrder));
      renderItems();
    };
  });

  // 断句切换
  main.querySelector('#origSplitBtn').onclick = () => {
    origSplitMode = !origSplitMode;
    const btn = main.querySelector('#origSplitBtn');
    btn.classList.toggle('active', origSplitMode);
    btn.textContent = origSplitMode ? '↩️ 连续原文' : '✂️ 字幕断句';
    renderOriginal();
  };
  main.querySelector('#splitBtn').onclick = () => {
    splitMode = !splitMode;
    const btn = main.querySelector('#splitBtn');
    btn.classList.toggle('active', splitMode);
    btn.textContent = splitMode ? '↩️ 连续原文' : '✂️ 字幕断句';
    compose();
  };

  // 复制
  main.querySelector('#copyBtn').onclick = async () => {
    const t = main.querySelector('#revOutput').value;
    try {
      await navigator.clipboard.writeText(t);
      utils.toast('已复制');
    } catch {
      const ta = main.querySelector('#revOutput');
      ta.focus(); ta.select(); document.execCommand('copy');
      utils.toast('已复制');
    }
  };

  // 推入设计台
  main.querySelector('#pushDesignBtn').onclick = () => pushToDesign(data, main);

  function posOf(it) { return it.original ? review.original.indexOf(it.original) : 999999; }
  function sortedItems() {
    const arr = review.items.slice();
    if (sortOrder === 'risk') arr.sort((a, b) => (LEVEL_RANK[b.level] - LEVEL_RANK[a.level]) || (posOf(a) - posOf(b)));
    else arr.sort((a, b) => posOf(a) - posOf(b));
    return arr;
  }

  function renderOriginal() {
    const rawText = origSplitMode && review.splitOriginal ? review.splitOriginal : review.original;
    const NL = '\x00';
    const text = origSplitMode ? rawText.replace(/\n/g, NL) : rawText;
    const marks = [];
    review.items.forEach(it => {
      if (!it.original) return;
      let idx = text.indexOf(it.original);
      while (idx !== -1) { marks.push({ s: idx, e: idx + it.original.length, level: it.level }); idx = text.indexOf(it.original, idx + 1); }
    });
    marks.sort((a, b) => a.s - b.s || b.e - a.e);
    const merged = [];
    for (const m of marks) {
      const last = merged[merged.length - 1];
      if (last && m.s < last.e) { last.e = Math.max(last.e, m.e); last.level = topRank(last.level, m.level); }
      else merged.push({ ...m });
    }
    let html = '', cur = 0;
    for (const m of merged) {
      if (m.s > cur) html += utils.esc(text.slice(cur, m.s));
      html += `<mark class="${LEVEL_CLS[m.level]}">${utils.esc(text.slice(m.s, m.e))}</mark>`;
      cur = m.e;
    }
    if (cur < text.length) html += utils.esc(text.slice(cur));
    main.querySelector('#revOriginal').innerHTML = origSplitMode ? html.replace(/\x00/g, '\n') : html;
  }

  function topRank(a, b) { return LEVEL_RANK[a] >= LEVEL_RANK[b] ? a : b; }

  function renderItems() {
    const box = main.querySelector('#revItems');
    box.innerHTML = sortedItems().map(it => {
      const d = review.decisions[it.id] || { adopted: false, editedSuggestion: it.suggestion };
      return `<div class="rev-card ${d.adopted ? 'adopted' : ''}">
        <div><span class="tag ${it.level}">${LEVEL_LABEL[it.level]}</span><span class="cat">${utils.esc(it.category || '')}</span></div>
        <div class="rev-line">
          <span class="from">${utils.esc(it.original)}</span>
          <span class="arrow">→</span>
          <input class="edit-sug" data-id="${it.id}" value="${utils.escAttr(d.editedSuggestion)}" title="可直接修改改写内容">
        </div>
        <div class="rev-reason">${utils.esc(it.reason || '')}</div>
        <div class="rev-actions">
          <button class="btn yes ${d.adopted ? 'on' : ''}" data-id="${it.id}" data-act="1">✓ 采纳</button>
          <button class="btn no ${!d.adopted ? 'on' : ''}" data-id="${it.id}" data-act="0">✗ 保留原文</button>
        </div>
      </div>`;
    }).join('');

    box.querySelectorAll('button[data-act]').forEach(b => {
      b.onclick = async () => {
        const id = +b.dataset.id;
        review.decisions[id].adopted = (b.dataset.act === '1');
        await store.logAndSave(data, 'review_decide', `第${id}条 ${review.decisions[id].adopted ? '采纳' : '保留'}`);
        renderItems();
        compose();
      };
    });
    box.querySelectorAll('input.edit-sug').forEach(inp => {
      inp.oninput = async () => {
        const id = +inp.dataset.id;
        review.decisions[id].editedSuggestion = inp.value;
        review.decisions[id]._dirty = true;
      };
      inp.onblur = async () => {
        await store.logAndSave(data, 'review_edit', `第${inp.dataset.id}条改写`);
      };
    });
  }

  function compose() {
    let text = splitMode && review.splitOriginal ? review.splitOriginal : review.original;
    const adopted = review.items
      .filter(it => review.decisions[it.id] && review.decisions[it.id].adopted && it.original)
      .sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level]);
    const NL = '\x00';
    if (splitMode) text = text.replace(/\n/g, NL);
    for (const it of adopted) {
      let sug = review.decisions[it.id].editedSuggestion;
      if (!sug || sug === it.original) continue;
      if (splitMode && it.splitSuggestion && sug === it.suggestion) sug = it.splitSuggestion;
      const ph = '\x01' + it.id + '\x01';
      text = text.split(it.original).join(ph);
      text = text.split(ph).join(sug);
    }
    if (splitMode) text = text.replace(/\x00/g, '\n');
    const cleaned = cleanText(text);
    main.querySelector('#revOutput').value = cleaned;
    review.output = cleaned;  // 同步到数据
  }

  function cleanText(text) {
    return text
      .replace(/【[^】]*】/g, '')
      .replace(/（[^）]*）/g, '')
      .replace(/\([^)]*\)/g, '')
      .split('\n')
      .map(l => l.replace(/^[\s　]+/, '').replace(/[\s　]+$/, ''))
      .filter(l => l.length > 0)
      .join('\n');
  }

  async function pushToDesign(data, main) {
    compose();  // 先同步 output
    if (!review.output || !review.output.trim()) {
      utils.toast('输出为空，无法推入');
      return;
    }
    // 按换行拆分成 shots
    const lines = review.output.split('\n').map(l => l.trim()).filter(Boolean);
    data.design.shots = lines.map((line, i) => ({
      line, subtitle: '',
      subject: { type: null, assetId: null, refs: [], prompt: '' },
      post: { text: '', sticker: '', fx: '', anim: '', trans: '' },
      timing: { text: '', sticker: '', fx: '', anim: '', trans: '' }
    }));
    data.meta.stage = 'design';
    await store.logAndSave(data, 'pushed_to_design', `生成 ${lines.length} 镜`);
    utils.toast(`已推入设计台（${lines.length} 镜）`);
    location.hash = encodeURIComponent(data.meta.title) + '/design';
  }

  renderOriginal();
  renderItems();
  compose();
}
```

- [ ] **Step 3: 验证**

```bash
cd "C:/Users/26875/Desktop/Script Studio"
python -m http.server 8080
```

需要一个有审核数据的项目。手动创建测试数据：先在工作台点「＋ 新建文案」创建「测试」，然后用文本编辑器在 `workspace/data/测试.json` 的 `review` 里填入 original、items（参照 _template.html 的 REVIEW_DATA 格式）。

刷新 `http://localhost:8080/workspace/#测试/review`：
- 原文面板显示文案，问题处高亮
- 问题卡片按危险程度排序，显示级别/分类/原文→改写/原因/按钮
- 点「采纳」卡片变绿，输出面板实时更新
- 编辑改写内容，输出同步变化
- 切「字幕断句」，原文和输出切换断句版
- 点「复制」提示已复制
- 点「推入设计台」→ 生成 shots → 跳转设计页（仍为占位）

- [ ] **Step 4: 提交**

```bash
git add workspace/js/review.js workspace/css/review.css
git commit -m "feat(workspace): 审核模块 review.js——迁移自 _template.html + 推入设计台"
```

---

## Task 8: 设计模块 design.js + design.css

**Files:**
- Modify: `workspace/js/design.js`（替换占位）
- Modify: `workspace/css/design.css`

**说明：** 从 `output/storyboard-吃苦卖命.html` 迁移。核心：分镜卡片、画面主体三态、选库/AI生成、剪映后期五格、汇总条、导出生图清单/剪辑指引。数据从 data.design.shots 读，素材从 store.loadAssets() 读。

- [ ] **Step 1: 创建 design.css**

```css
/* workspace/css/design.css */
.design-wrap { padding: 16px 24px 90px; max-width: 1100px; margin: 0 auto; }
.design-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; flex-wrap: wrap; gap: 8px; }
.design-head h1 { font-size: 17px; font-weight: 600; }
.design-head .toolbar { display: flex; gap: 8px; flex-wrap: wrap; }

.dash-summary { font-size: 12px; color: var(--muted); margin-bottom: 12px; display: flex; gap: 14px; flex-wrap: wrap; }
.dash-summary b { color: var(--text); font-weight: 600; }

.shots { display: flex; flex-direction: column; gap: 12px; }
.shot .card-inner { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 14px; border-left: 3px solid var(--border); }
.shot .card-inner.has-lib { border-left-color: var(--ok); }
.shot .card-inner.has-ai { border-left-color: var(--ai); }
.shot-head { display: flex; align-items: flex-start; gap: 12px; padding-bottom: 12px; border-bottom: 1px solid var(--border); margin-bottom: 4px; }
.shot-no { font-size: 12px; font-weight: 700; color: #fff; background: var(--muted); border-radius: 6px; padding: 3px 9px; flex-shrink: 0; }
.shot.has-lib .shot-no { background: var(--ok); }
.shot.has-ai .shot-no { background: var(--ai); }
.thumb { width: 76px; height: 76px; border: 1px solid var(--border); border-radius: 8px; background: #f2f3f5 center/contain no-repeat; flex-shrink: 0; cursor: pointer; overflow: hidden; position: relative; }
.thumb-id { position: absolute; bottom: 3px; right: 3px; background: rgba(0,0,0,.55); color: #fff; font-size: 10px; font-weight: 700; padding: 1px 5px; border-radius: 3px; }
.thumb.empty { display: flex; align-items: center; justify-content: center; color: var(--muted); font-size: 11px; text-align: center; background: var(--bg); }
.thumb.ai-ph { display: flex; align-items: center; justify-content: center; color: var(--ai); font-size: 11px; font-weight: 600; background: var(--ai-bg); }
.shot-main { flex: 1; min-width: 0; }
.shot-line { font-size: 15px; font-weight: 600; line-height: 1.55; word-break: break-word; }

.field { margin-top: 14px; }
.field-label { font-size: 12px; color: var(--accent); font-weight: 600; margin-bottom: 8px; display: inline-flex; align-items: center; gap: 6px; background: var(--accent-bg); padding: 4px 10px; border-radius: 5px; }
.inp { width: 100%; border: 1px solid var(--border); border-radius: 6px; padding: 7px 10px; font-size: 14px; font-family: inherit; color: var(--text); outline: none; background: #fff; }
.inp:focus { border-color: var(--accent); }
textarea.inp { resize: vertical; line-height: 1.6; min-height: 38px; }
textarea.auto-grow { resize: none; overflow: hidden; }

.seg { display: inline-flex; border: 1px solid var(--border); border-radius: 7px; overflow: hidden; }
.seg button { border: none; background: #fff; padding: 6px 14px; font-size: 13px; cursor: pointer; color: var(--muted); font-family: inherit; }
.seg button:hover { background: #f2f3f5; }
.seg button.on { background: var(--accent); color: #fff; }

.lib-info { font-size: 13px; color: var(--ok); margin-top: 6px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.lib-info .hint { color: var(--muted); }
.ai-box { margin-top: 8px; display: flex; flex-direction: column; gap: 7px; }
.refs { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.ref-thumb { width: 46px; height: 46px; border: 1px solid var(--border); border-radius: 6px; background: center/contain no-repeat #fff; position: relative; }
.ref-thumb .x { position: absolute; top: -6px; right: -6px; background: var(--text); color: #fff; border-radius: 50%; width: 16px; height: 16px; font-size: 11px; line-height: 15px; text-align: center; cursor: pointer; border: 1px solid #fff; }
.add-ref { width: 46px; height: 46px; border: 1px dashed var(--ai); background: var(--ai-bg); color: var(--ai); border-radius: 6px; font-size: 18px; cursor: pointer; display: flex; align-items: center; justify-content: center; }

.post { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; }
.cell { display: flex; flex-direction: column; gap: 4px; }
.cell label { font-size: 11px; color: var(--muted); font-weight: 600; }
.cell .inp { font-size: 13px; padding: 5px 8px; }
.cell .timing { color: var(--accent); font-size: 12px; border-color: #dbe4ff; background: #fbfcff; }

@media (max-width: 768px) {
  .design-wrap { padding: 12px; }
  .post { display: flex; flex-direction: column; gap: 10px; }
  .post .cell { background: #fafbfc; padding: 8px 10px; border-radius: 7px; }
  .cell .inp { width: 100%; }
}
```

- [ ] **Step 2: 替换 design.js（完整实现，迁移自 storyboard HTML）**

```js
// workspace/js/design.js
import * as store from './store.js';
import * as utils from './utils.js';
import { openPicker } from './picker.js';
import { exportShotList, exportCutGuide } from './export.js';

const POST = [['text', '文字'], ['sticker', '贴纸'], ['fx', '特效'], ['anim', '动画'], ['trans', '转场']];

export async function renderDesign(data, main) {
  const assets = await store.loadAssets();
  const design = data.design;
  if (!design.shots) design.shots = [];

  main.innerHTML = `
    <div class="design-wrap">
      <div class="design-head">
        <h1>🎬 画面设计 · ${utils.esc(data.meta.title)} · ${design.shots.length} 镜</h1>
        <div class="toolbar">
          <button class="btn ghost" id="shotListBtn">🧾 生图清单</button>
          <button class="btn primary" id="cutGuideBtn">🎬 剪辑指引</button>
        </div>
      </div>
      <div class="dash-summary" id="designSummary"></div>
      <div class="shots" id="shots"></div>
    </div>
  `;

  main.querySelector('#shotListBtn').onclick = () => exportShotList(data);
  main.querySelector('#cutGuideBtn').onclick = () => exportCutGuide(data);

  // 输入事件委托
  const shotsEl = main.querySelector('#shots');
  shotsEl.addEventListener('input', e => {
    const el = e.target;
    if (el.classList.contains('auto-grow')) autoGrow(el);
    const i = el.dataset.i, k = el.dataset.k;
    if (i === undefined) return;
    const s = design.shots[+i];
    if (!s) return;
    const v = el.value;
    if (k === 'subtitle') s.subtitle = v;
    else if (k === 'prompt') s.subject.prompt = v;
    else if (k && k.startsWith('post.')) s.post[k.slice(5)] = v;
    else if (k && k.startsWith('timing.')) s.timing[k.slice(7)] = v;
    debounceSave(data);
  });

  function autoGrow(el) { el.style.height = 'auto'; el.style.height = (el.scrollHeight + 2) + 'px'; }

  renderShots();

  function renderShots() {
    shotsEl.innerHTML = design.shots.map((s, i) => shotHTML(s, i, assets)).join('');
    shotsEl.querySelectorAll('.auto-grow').forEach(autoGrow);
    updateSummary();
  }

  function shotHTML(s, i, assets) {
    const t = s.subject.type;
    const cls = t === 'lib' ? 'has-lib' : t === 'ai' ? 'has-ai' : '';
    let thumb;
    if (t === 'lib' && s.subject.assetId) {
      const a = store.assetById(assets, s.subject.assetId);
      thumb = `<div class="thumb" style="background-image:url('${store.assetUrl(a)}')" onclick="window.__designPick(${i},'lib')" title="点击换图"><span class="thumb-id">${a.id}</span></div>`;
    } else if (t === 'ai') {
      thumb = `<div class="thumb ai-ph" onclick="document.getElementById('prompt${i}').focus()" title="AI 生成（待生图）">AI<br>待生</div>`;
    } else {
      thumb = `<div class="thumb empty" onclick="window.__designSetType(${i},'lib');window.__designPick(${i},'lib')" title="点击选图">+ 选图</div>`;
    }

    let detail = '';
    if (t === 'lib') {
      if (s.subject.assetId) {
        const a = store.assetById(assets, s.subject.assetId);
        detail = `<div class="lib-info">已选 <b>${a.id}·${utils.esc(a.desc)}</b> <span class="hint">[${a.cat}/${a.framing}]</span>
          <button class="btn ghost" style="padding:3px 10px;font-size:12px" onclick="window.__designPick(${i},'lib')">换图</button></div>`;
      } else {
        detail = `<div class="lib-info hint">点上方缩略图选一张</div>`;
      }
    } else if (t === 'ai') {
      const refs = s.subject.refs.map((rid, idx) => {
        const a = store.assetById(assets, rid);
        return `<div class="ref-thumb" style="background-image:url('${store.assetUrl(a)}')" title="${utils.esc(a.desc)}"><span class="x" onclick="window.__designRemoveRef(${i},${idx})">×</span></div>`;
      }).join('');
      detail = `<div class="ai-box">
        <div class="refs">${refs}<button class="add-ref" onclick="window.__designPick(${i},'ref')" title="加参考图">+</button></div>
        <textarea class="inp auto-grow" id="prompt${i}" placeholder="提示词：要生成什么（如：同角色抱存钱罐，但改成愤怒表情、红色背景）" data-i="${i}" data-k="prompt">${utils.esc(s.subject.prompt)}</textarea>
      </div>`;
    }

    return `<div class="shot ${cls}"><div class="card-inner ${cls}">
      <div class="shot-head">
        <div class="shot-no">${String(i + 1).padStart(2, '0')}</div>
        ${thumb}
        <div class="shot-main">
          <div class="shot-line">${utils.esc(s.line)}</div>
          <div class="field" style="margin-top:7px">
            <textarea class="inp auto-grow" rows="1" placeholder="字幕（可空，默认同口播）" data-i="${i}" data-k="subtitle">${utils.esc(s.subtitle)}</textarea>
          </div>
        </div>
      </div>
      <div class="field">
        <div class="field-label">🖼 画面主体（导入剪映的图）</div>
        <div class="seg">
          <button class="${t === null ? 'on' : ''}" onclick="window.__designSetType(${i},null)">未定</button>
          <button class="${t === 'lib' ? 'on' : ''}" onclick="window.__designSetType(${i},'lib')">选库</button>
          <button class="${t === 'ai' ? 'on' : ''}" onclick="window.__designSetType(${i},'ai')">AI 生成</button>
        </div>
        ${detail}
      </div>
      <div class="field">
        <div class="field-label">✂️ 剪映后期（在剪映里加）</div>
        <div class="post">
          ${POST.map(([k, label]) => `<div class="cell"><label>${label}</label><input class="inp" placeholder="内容" value="${utils.escAttr(s.post[k])}" data-i="${i}" data-k="post.${k}"><input class="inp timing" placeholder="⏱ 念到…时出现" value="${utils.escAttr(s.timing[k])}" data-i="${i}" data-k="timing.${k}"></div>`).join('')}
        </div>
      </div>
    </div></div>`;
  }

  function updateSummary() {
    const lib = design.shots.filter(s => s.subject.type === 'lib').length;
    const ai = design.shots.filter(s => s.subject.type === 'ai').length;
    const done = design.shots.filter(s => s.subject.type !== null).length;
    main.querySelector('#designSummary').innerHTML = `共 <b>${design.shots.length}</b> 镜 ｜ 已设计 <b>${done}</b> ｜ 选库 <b>${lib}</b> ｜ AI生成 <b>${ai}</b> ｜ 待定 <b>${design.shots.length - done}</b>`;
  }

  // ---- 暴露给 onclick 的操作函数 ----
  window.__designSetType = async (i, type) => {
    const s = design.shots[i];
    s.subject.type = type;
    if (type !== 'lib') s.subject.assetId = null;
    if (type !== 'ai') { s.subject.refs = []; s.subject.prompt = ''; }
    await store.logAndSave(data, 'design_edit', `第${i + 1}镜主体=${type || '未定'}`);
    renderShots();
  };

  window.__designPick = (i, field) => {
    const s = design.shots[i];
    if (field === 'lib') {
      openPicker({
        assets, currentId: s.subject.assetId, multi: false, title: '选画面主体（单选）', sub: `第 ${i + 1} 镜`,
        onSelect: async (id) => {
          s.subject.type = 'lib'; s.subject.assetId = id;
          await store.logAndSave(data, 'design_edit', `第${i + 1}镜选库 ${id}`);
          renderShots();
        }
      });
    } else {
      openPicker({
        assets, currentIds: s.subject.refs.slice(), multi: true, title: '加参考图（可多选）', sub: `第 ${i + 1} 镜`,
        onSelect: (ids) => { s.subject.refs = ids.slice(); if (s.subject.type !== 'ai') s.subject.type = 'ai'; }
      });
    }
  };

  window.__designRemoveRef = async (i, idx) => {
    design.shots[i].subject.refs.splice(idx, 1);
    await store.logAndSave(data, 'design_edit', `第${i + 1}镜删参考图`);
    renderShots();
  };

  // 防抖保存
  let saveTimer = null;
  function debounceSave(data) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      store.logAndSave(data, 'design_edit', '编辑后期/字幕');
    }, 1500);
  }
}
```

- [ ] **Step 3: 验证**

```bash
cd "C:/Users/26875/Desktop/Script Studio"
python -m http.server 8080
```

打开一个已推入设计台的项目（或手动在 data JSON 的 design.shots 填几条 line）：
`http://localhost:8080/workspace/#吃苦卖命/design`：
- 显示分镜卡片列表，每卡显示镜号、缩略图（空）、口播文案、字幕框、主体三态按钮、后期五格
- 点「选库」→ 弹出选图弹窗 → 搜索/筛选 → 点选 → 缩略图显示该素材，卡片左边框变绿
- 点「AI 生成」→ 显示参考图区+提示词框 → 点「+」加参考图（多选）→ 输入提示词
- 汇总条实时更新
- 后期五格输入内容，1.5秒后自动保存
- 点「生图清单」/「剪辑指引」→ Task 9 实现后导出

- [ ] **Step 4: 提交**

```bash
git add workspace/js/design.js workspace/css/design.css
git commit -m "feat(workspace): 设计模块 design.js——迁移自 storyboard + 事件委托 + 防抖保存"
```

---

## Task 9: 导入导出 export.js

**Files:**
- Modify: `workspace/js/export.js`（替换占位）

**说明：** 导出项目 JSON、生图清单、剪辑指引；导入 JSON 并合并；旧 HTML 迁移。

- [ ] **Step 1: 替换 export.js（完整实现）**

```js
// workspace/js/export.js
import * as store from './store.js';
import * as utils from './utils.js';

const POST = [['text', '文字'], ['sticker', '贴纸'], ['fx', '特效'], ['anim', '动画'], ['trans', '转场']];

/* ---------- 项目 JSON 导出/导入 ---------- */
export async function exportProject(data) {
  const name = (data.meta.title || '项目') + '.json';
  utils.download(name, JSON.stringify(data, null, 2), 'application/json');
  utils.toast('已导出 ' + name);
}

// 导入文件（来自 app.js 的导入按钮）：解析 JSON，写入 data/
export async function importJSONFile(file) {
  const text = await file.text();
  let data;
  if (file.name.endsWith('.html')) {
    data = parseLegacyReview(text);  // 旧 HTML
  } else {
    data = JSON.parse(text);
  }
  if (!data.meta || !data.meta.title) throw new Error('JSON 格式不符（缺 meta.title）');
  await store.saveProject(data);
  await store.logAndSave(data, 'imported', `从 ${file.name} 导入`);
  utils.toast('已导入：' + data.meta.title);
}

/* ---------- 合并 ---------- */
// 以 base 为基础，把 incoming 的设计改动合并进来，返回 { merged, conflicts }
export function mergeData(base, incoming) {
  const merged = JSON.parse(JSON.stringify(base));
  const conflicts = [];
  // 设计部分：按镜号逐条比对
  const bShots = merged.design.shots;
  const iShots = incoming.design ? incoming.design.shots : [];
  const maxLen = Math.max(bShots.length, iShots.length);
  for (let i = 0; i < maxLen; i++) {
    if (!iShots[i]) continue;
    if (!bShots[i]) { bShots[i] = iShots[i]; continue; }
    const bSub = bShots[i].subject || {};
    const iSub = iShots[i].subject || {};
    // incoming 有设计、base 无设计 → 直接采纳
    if (iSub.type && !bSub.type) {
      bShots[i].subject = JSON.parse(JSON.stringify(iSub));
    }
    // 两边都有且不同 → 冲突
    else if (iSub.type && bSub.type && JSON.stringify(iSub) !== JSON.stringify(bSub)) {
      conflicts.push({ shot: i, base: bSub, incoming: iSub });
    }
    // 后期字段：incoming 非空且 base 空 → 采纳
    ['post', 'timing'].forEach(field => {
      if (iShots[i][field]) {
        Object.keys(iShots[i][field]).forEach(k => {
          if (iShots[i][field][k] && !bShots[i][field][k]) bShots[i][field][k] = iShots[i][field][k];
        });
      }
    });
  }
  // changelog 合并（去重按 ts+who+action）
  const logKeys = new Set((merged.changelog || []).map(c => c.ts + c.who + c.action));
  (incoming.changelog || []).forEach(c => {
    const key = c.ts + c.who + c.action;
    if (!logKeys.has(key)) { merged.changelog.push(c); logKeys.add(key); }
  });
  return { merged, conflicts };
}

/* ---------- 生图清单 ---------- */
export function exportShotList(data) {
  const assets = store.assetById;  // 占位，实际在 design 里调
  const ai = data.design.shots.filter(s => s.subject.type === 'ai');
  if (!ai.length) { utils.toast('没有 AI 生成的镜'); return; }
  const lines = ai.map((s, idx) => {
    const realIdx = data.design.shots.indexOf(s);
    const refs = s.subject.refs.map(id => { const a = store.assetById([], id); return ''; }).join('、') || '（无）';
    return `【第${String(realIdx + 1).padStart(2, '0')}镜】${s.line}\n  参考图：${refs}\n  提示词：${s.subject.prompt || '（空）'}`;
  });
  // 参考图描述需异步加载 assets，这里同步简化：仅列 id
  const txt = `生图清单 · ${data.meta.title} · 共 ${ai.length} 张待生成\n${'='.repeat(40)}\n\n${lines.join('\n\n')}`;
  utils.download(`生图清单-${data.meta.title}.txt`, txt);
  utils.toast(`已导出生图清单（${ai.length} 张）`);
}

/* ---------- 剪辑指引 ---------- */
export function exportCutGuide(data) {
  const lines = data.design.shots.map((s, i) => {
    const t = s.subject.type;
    let pic;
    if (t === 'lib') pic = `选库 ${s.subject.assetId}`;
    else if (t === 'ai') pic = `AI生成（待生）`;
    else pic = `未定`;
    const sub = s.subtitle || '（同口播/不打）';
    const p = POST.map(([k, l]) => {
      if (!s.post[k]) return '';
      const tm = s.timing[k] ? `（念到"${s.timing[k]}"时）` : '';
      return `${l}:${s.post[k]}${tm}`;
    }).filter(Boolean).join('  ');
    return `【${String(i + 1).padStart(2, '0')}】${s.line}\n  画面：${pic} ｜ 字幕：${sub}\n  ${p ? '后期：' + p : '（后期空）'}`;
  });
  const txt = `剪辑指引 · ${data.meta.title} · 共 ${data.design.shots.length} 镜\n${'='.repeat(40)}\n\n${lines.join('\n\n')}`;
  utils.download(`剪辑指引-${data.meta.title}.txt`, txt);
  utils.toast('已导出剪辑指引');
}

/* ---------- 旧 HTML 迁移 ---------- */
export function parseLegacyReview(htmlText) {
  // 提取 var REVIEW_DATA = {...};
  const m = htmlText.match(/var\s+REVIEW_DATA\s*=\s*(\{[\s\S]*?\});\s*<\/script>/);
  if (!m) throw new Error('未找到 REVIEW_DATA');
  // 用 Function 求值（数据对象，非代码执行风险可控，来自本地文件）
  const rd = new Function('return ' + m[1])();
  return {
    meta: { title: rd.original.slice(0, 12).replace(/\s/g, ''), created: utils.nowIso(), updated: utils.nowIso(), stage: 'review', operator: store.getOperator() },
    review: {
      platform: rd.platform || '', verdict: rd.verdict || '',
      original: rd.original || '', splitOriginal: rd.splitOriginal || '',
      items: rd.items || [], decisions: {}, output: ''
    },
    design: { shots: [] },
    changelog: [{ ts: utils.nowIso(), who: store.getOperator(), action: 'migrated', detail: '从旧 HTML 迁移' }]
  };
}
```

**注意：** `exportShotList` 里参考图描述需要 assets，但 assets 是异步加载的。Task 8 调用 `exportShotList(data)` 时 assets 未传入。修正：让 design.js 调用时传入 assets，或 export.js 内部加载。采用后者更简单——在 Task 8 的 design.js 里调用改为 `exportShotList(data, assets)`。**修正 Task 8 的 design.js 调用：**

- [ ] **Step 2: 修正 design.js 的导出调用（传入 assets）**

修改 `workspace/js/design.js` 中：

```js
main.querySelector('#shotListBtn').onclick = () => exportShotList(data);
```
改为：
```js
main.querySelector('#shotListBtn').onclick = () => exportShotList(data, assets);
```

并修改 `workspace/js/export.js` 的 `exportShotList` 签名：

```js
export function exportShotList(data, assets = []) {
  const ai = data.design.shots.filter(s => s.subject.type === 'ai');
  if (!ai.length) { utils.toast('没有 AI 生成的镜'); return; }
  const lines = ai.map(s => {
    const realIdx = data.design.shots.indexOf(s);
    const refs = s.subject.refs.map(id => {
      const a = store.assetById(assets, id);
      return a ? `${a.id}·${a.desc}` : id;
    }).join('、') || '（无）';
    return `【第${String(realIdx + 1).padStart(2, '0')}镜】${s.line}\n  参考图：${refs}\n  提示词：${s.subject.prompt || '（空）'}`;
  });
  const txt = `生图清单 · ${data.meta.title} · 共 ${ai.length} 张待生成\n${'='.repeat(40)}\n\n${lines.join('\n\n')}`;
  utils.download(`生图清单-${data.meta.title}.txt`, txt);
  utils.toast(`已导出生图清单（${ai.length} 张）`);
}
```

- [ ] **Step 3: 验证**

```bash
cd "C:/Users/26875/Desktop/Script Studio"
python -m http.server 8080
```

- 在设计台设几镜为 AI 生成并填提示词 → 点「生图清单」→ 下载 txt，内容正确
- 在设计台填几镜后期 → 点「剪辑指引」→ 下载 txt，内容正确
- 总览页点某项目「导出」→ 下载 项目.json
- 点顶栏「导入」→ 选刚导出的 json → 提示导入成功
- 导入一个旧 `output/review-*.html` → 解析成功，项目出现在侧栏

- [ ] **Step 4: 提交**

```bash
git add workspace/js/export.js workspace/js/design.js
git commit -m "feat(workspace): 导入导出 export.js——项目JSON/生图清单/剪辑指引/合并/旧HTML迁移"
```

---

## Task 10: 端到端验证 + 示例数据 + skill 集成

**Files:**
- Create: `workspace/data/吃苦卖命.json`（示例数据）
- Modify: `CLAUDE.md`（更新运行方式说明）

**说明：** 跑通完整链路，迁移「吃苦卖命」作为示例数据，更新文档。

- [ ] **Step 1: 生成「吃苦卖命」示例数据**

从 `output/storyboard-吃苦卖命.html` 提取 SCRIPT 数据，结合审核数据，构造完整的 `workspace/data/吃苦卖命.json`。

用工作台创建：点「＋ 新建文案」→ 输入「吃苦卖命」→ 在审核页手动粘贴原文（从 storyboard 的 SCRIPT 拼接）→ 推入设计台 → 验证 38 镜生成。

或直接写文件 `workspace/data/吃苦卖命.json`：

```json
{
  "meta": { "title": "吃苦卖命", "created": "2026-06-22T10:00:00Z", "updated": "2026-06-22T10:00:00Z", "stage": "design", "operator": "lorrain" },
  "review": {
    "platform": "抖音 · 小红书",
    "verdict": "示例数据",
    "original": "从小家里都说：勤快饿不死，别人能出头，就是比你更能吃苦。",
    "splitOriginal": "从小家里都说：\n勤快饿不死，\n别人能出头，",
    "items": [
      { "id": 1, "level": "high", "category": "消极价值观", "original": "吃苦", "suggestion": "努力", "splitSuggestion": "努力", "reason": "示例" }
    ],
    "decisions": { "1": { "adopted": true, "editedSuggestion": "努力" } },
    "output": "从小家里都说：\n勤快饿不死，\n别人能出头，\n就是比你更能努力。"
  },
  "design": {
    "shots": [
      { "line": "从小家里都说：", "subtitle": "", "subject": { "type": null, "assetId": null, "refs": [], "prompt": "" }, "post": { "text": "", "sticker": "", "fx": "", "anim": "", "trans": "" }, "timing": { "text": "", "sticker": "", "fx": "", "anim": "", "trans": "" } },
      { "line": "勤快饿不死，", "subtitle": "", "subject": { "type": null, "assetId": null, "refs": [], "prompt": "" }, "post": { "text": "", "sticker": "", "fx": "", "anim": "", "trans": "" }, "timing": { "text": "", "sticker": "", "fx": "", "anim": "", "trans": "" } }
    ]
  },
  "changelog": [
    { "ts": "2026-06-22T10:00:00Z", "who": "lorrain", "action": "created", "detail": "示例数据" }
  ]
}
```

（实际实现时可推入完整 38 镜，上面是简化示例。）

确保 `workspace/data/index.json` 包含该条目：

```json
{ "projects": [ { "title": "吃苦卖命", "stage": "design", "updated": "2026-06-22T10:00:00Z", "shotCount": 2, "reviewItemCount": 1 } ] }
```

- [ ] **Step 2: 端到端跑通**

```bash
cd "C:/Users/26875/Desktop/Script Studio"
python -m http.server 8080
```

完整走一遍：
1. 打开 `http://localhost:8080/workspace/` → 弹昵称 → 输「lorrain」
2. 点「选择工作目录」→ 选 workspace/ 文件夹 → 授权
3. 总览显示「吃苦卖命」卡片
4. 进审核页 → 高亮/采纳/断句/复制 正常 → 推入设计台
5. 进设计页 → 选库/AI生成/后期/汇总 正常 → 导出生图清单/剪辑指引
6. 总览点导出 → 下载 JSON → 顶栏导入回来 → 正常
7. 手机尺寸（DevTools 切换）→ 布局自适应

- [ ] **Step 3: 更新 CLAUDE.md 的运行方式**

在 `CLAUDE.md` 的「## 运行方式」节追加工作台说明：

```markdown
## 运行方式

### 工作台（推荐，主入口）

`workspace/` 是融合了审核+设计的纯前端工作台：

```bash
cd "C:\Users\26875\Desktop\Script Studio"
python -m http.server 8080
```
浏览器打开 `http://localhost:8080/workspace/`。

- 首次访问输入昵称、点「选择工作目录」授权 `workspace/` 文件夹（Chrome/Edge）
- 数据在 `workspace/data/*.json`，读写全自动（File System Access API）
- 内网穿透后，协作者访问同一 URL 只读浏览，改完导出 JSON 发回，运营者导入合并

### 单文件产物（旧，兼容）

审核台产物直接双击 `output/review-*.html`（file:// 可用，离线）。
```

- [ ] **Step 4: 提交**

```bash
git add workspace/data/吃苦卖命.json workspace/data/index.json CLAUDE.md
git commit -m "feat(workspace): 示例数据「吃苦卖命」+ 端到端验证 + 文档更新"
```

- [ ] **Step 5: 更新 /script-review skill（产出改为 JSON）**

打开 skill 文件（通常在 `~/.claude/commands/` 或插件目录），把产出从「生成 review-*.html」改为「生成 workspace/data/<标题>.json」。具体修改依 skill 现状，核心改动：
- 产物路径：`workspace/data/<标题>.json`
- 产物内容：按 spec 的数据架构构造 `{ meta, review, design:{shots:[]}, changelog }`
- `meta.stage = "review"`
- 删除 HTML 模板替换逻辑，改为写 JSON 文件
- 更新 skill 说明里「自包含 HTML」相关描述

（此步在 skill 文件中操作，不在 workspace/ 内。）

---

## Self-Review（写完后自查）

**Spec 覆盖：**
- ✅ 目录结构 → Task 1
- ✅ 数据架构（JSON 格式）→ Task 2 store.js
- ✅ data/index.json → Task 2
- ✅ assets.json → Task 4
- ✅ 操作者身份 → Task 2 + Task 3
- ✅ 模块架构 + 接口 → 各 Task
- ✅ 路由导航 → Task 3
- ✅ 审核模块（含推入设计台）→ Task 7
- ✅ 设计模块 → Task 8
- ✅ 选图弹窗 → Task 6
- ✅ 进度总览 → Task 5
- ✅ 导入导出合并 → Task 9
- ✅ 内网穿透部署 → Task 10 文档
- ✅ skill 集成 → Task 10 Step 5
- ⚠️ 旧 HTML 迁移 → Task 9 parseLegacyReview（基本覆盖）

**类型一致性：**
- `renderDashboard(projects, main, handlers)` — Task 3/5 调用一致 ✅
- `renderReview(data, main)` / `renderDesign(data, main)` — 一致 ✅
- `store.logAndSave(data, action, detail)` — Task 2 定义，Task 7/8 调用一致 ✅
- `openPicker({assets, currentId/currentIds, multi, onSelect, title, sub})` — Task 6 定义，Task 8 调用一致 ✅
- `exportShotList(data, assets)` / `exportCutGuide(data)` — Task 9 定义，Task 8 调用一致 ✅
- `importJSONFile(file)` — Task 9 定义，Task 3 调用一致 ✅

**已知简化：**
- `parseLegacyReview` 的 title 从原文截取，可能需手动改（spec 未严格定义标题来源）
- 合并的「逐条对比 UI」spec 描述了交互，但 Task 9 只实现了 mergeData 函数，未做完整对比面板 UI——作为留接口，当前用「直接合并+冲突列出」即可，完整 UI 后续补
