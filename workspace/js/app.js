// workspace/js/app.js
// 入口：路由、侧栏、初始化、登录、管理员权限
import * as store from './store.js';
import * as utils from './utils.js';
import { renderDashboard } from './dashboard.js';
import { renderReview } from './review.js';
import { renderDesign } from './design.js';
import { renderAdmin } from './admin.js';
import { importJSONFile } from './export.js';

const $ = id => document.getElementById(id);
let currentTitle = null;

/* ---------- 初始化 ---------- */
async function boot() {
  await setupDirButton();
  setupImport();
  window.addEventListener('hashchange', route);

  const label = $('operatorLabel');
  label.style.cursor = 'pointer';
  label.title = '点击切换操作者 / 退出登录';
  label.onclick = () => openLogin({ mode: 'switch' });

  applyAdminUI();

  if (localStorage.getItem('ss_operator')) {
    showOperator(store.getOperator());
    route();
  } else {
    openLogin({ mode: 'first' });
  }
}

// 按管理员身份显隐管理类 UI（导入/选目录/新建/后台 仅管理员可见）
function applyAdminUI() {
  const admin = store.isAdmin();
  $('importBtn').style.display = admin ? '' : 'none';
  if (!admin) $('dirBtn').style.display = 'none';
}

/* ---------- 操作者身份（自定义登录浮层，不用浏览器 prompt） ---------- */
function showOperator(name) {
  $('operatorLabel').style.display = '';
  $('operatorName').textContent = name;
}

function openLogin({ mode }) {
  const ov = $('loginOverlay');
  const input = $('loginInput');
  const exitBtn = $('loginExit');
  const sub = $('loginSub');
  const cur = store.getOperator();
  if (mode === 'switch') {
    input.value = cur !== '匿名' ? cur : '';
    sub.textContent = '切换操作者：输入新昵称确认；或点「退出登录」';
    exitBtn.style.display = '';
  } else {
    input.value = '';
    sub.textContent = '输入你的昵称，开始协作';
    exitBtn.style.display = 'none';
  }
  ov.classList.add('on');
  setTimeout(() => input.focus(), 50);

  const ok = () => {
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    store.setOperator(name);
    showOperator(name);
    ov.classList.remove('on');
    applyAdminUI();
    utils.toast(mode === 'first' ? '欢迎，' + name : '已切换为 ' + name);
    route();
  };
  $('loginOk').onclick = ok;
  input.onkeydown = e => { if (e.key === 'Enter') ok(); };
  exitBtn.onclick = () => {
    localStorage.removeItem('ss_operator');
    ov.classList.remove('on');
    utils.toast('已退出，正在刷新…');
    setTimeout(() => location.reload(), 500);
  };
}

async function setupDirButton() {
  const btn = $('dirBtn');
  const hasFsa = store.isFsaSupported();
  const restored = hasFsa && await store.initStore();

  function refreshBtn() {
    if (!store.isAdmin()) { btn.style.display = 'none'; return; }
    if (!hasFsa) {
      btn.textContent = '📡 只读模式'; btn.disabled = true;
      btn.title = '当前浏览器/环境不支持写入，仅浏览';
    } else if (store.hasDir()) {
      btn.textContent = '✓ 已授权'; btn.disabled = true;
    } else {
      btn.textContent = '📁 选择工作目录'; btn.disabled = false;
    }
  }
  refreshBtn();

  btn.addEventListener('click', async () => {
    if (!hasFsa) return;
    try {
      await store.pickDirectory();
      refreshBtn();
      utils.toast('已授权，可读写 data/');
      route();
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
      route();
    } catch (err) {
      utils.toast('导入失败：' + err.message);
    }
    e.target.value = '';
  });
}

/* ---------- 导航 ---------- */
// 从总览/admin 进入文案 = push（返回键回总览）；其余切换 = replace（返回键不在文案间跳）
function go(hash) {
  const isTopLevel = (hash === 'dashboard' || hash === 'admin');
  if (currentTitle === null && !isTopLevel) {
    location.hash = hash;
  } else {
    history.replaceState(null, '', '#' + hash);
    route();
  }
}
window.__go = go;

/* ---------- 路由 ---------- */
async function route() {
  const hash = location.hash.slice(1) || 'dashboard';

  if (hash === 'dashboard' || hash === '') {
    currentTitle = null;
  } else if (hash === 'admin') {
    currentTitle = null;
  } else {
    const si = hash.lastIndexOf('/');
    const t = si >= 0 ? hash.slice(0, si) : hash;
    currentTitle = decodeURIComponent(t);
  }
  await renderSidebar();

  if (hash === 'admin') {
    if (!store.isAdmin()) {
      $('main').innerHTML = '<div style="padding:60px;text-align:center;color:#8a9099">仅管理员可查看后台</div>';
      return;
    }
    $('subTitle').textContent = '管理员后台';
    renderAdmin($('main'));
    return;
  }

  if (hash === 'dashboard' || hash === '') {
    $('subTitle').textContent = '总览';
    const projects = await store.loadProjectList();
    renderDashboard(projects, $('main'), { onOpen: openProject, onNew: newProject });
    return;
  }

  const slashIdx = hash.lastIndexOf('/');
  const mode = slashIdx >= 0 ? hash.slice(slashIdx + 1) : '';
  const decodedTitle = currentTitle;

  try {
    const data = await store.loadProject(decodedTitle);
    if (mode === 'review') {
      $('subTitle').textContent = '审核 · ' + decodedTitle;
      renderReview(data, $('main'));
    } else if (mode === 'design') {
      $('subTitle').textContent = '设计 · ' + decodedTitle;
      renderDesign(data, $('main'));
    } else {
      const m = data.meta.stage === 'design' || data.meta.stage === 'done' ? 'design' : 'review';
      go(encodeURIComponent(decodedTitle) + '/' + m);
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
  const admin = store.isAdmin();
  const hash = location.hash.slice(1);

  const items = projects.map(p => {
    const active = currentTitle === p.title ? 'active' : '';
    const stage = encodeURIComponent(p.title) + (p.stage === 'design' || p.stage === 'done' ? '/design' : '/review');
    return `<div class="nav-item ${active}" data-href="${stage}">
      <span>📄 ${utils.esc(p.title)}</span>
      <span class="stage-dot" title="${stageText[p.stage] || ''}">${stageLabel[p.stage] || ''}</span>
    </div>`;
  }).join('');

  const adminItem = admin ? `<div class="nav-item ${hash === 'admin' ? 'active' : ''}" data-href="admin">👑 管理员后台</div>` : '';
  const newBtn = admin ? `<button class="btn new-btn" id="newProjectBtn">＋ 新建文案</button>` : '';

  $('sidebar').innerHTML = `
    <div class="nav-item ${!currentTitle && hash !== 'admin' ? 'active' : ''}" data-href="dashboard">📊 总览</div>
    ${adminItem}
    <div class="nav-section">文案 (${projects.length})</div>
    ${items || '<div class="nav-section" style="padding-top:0">暂无文案</div>'}
    ${newBtn}
  `;

  $('sidebar').onclick = e => {
    const item = e.target.closest('[data-href]');
    if (item) go(item.dataset.href);
  };
  const newB = $('newProjectBtn');
  if (newB) newB.onclick = newProject;
}

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
    go(encodeURIComponent(t) + '/review');
  } catch (err) {
    utils.toast('创建失败：' + err.message);
  }
}

function openProject(title, mode) {
  go(encodeURIComponent(title) + '/' + mode);
}

boot();
