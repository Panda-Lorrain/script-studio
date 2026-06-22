// workspace/js/app.js
// 入口：路由、侧栏、初始化、登录、管理员权限
import * as store from './store.js';
import * as utils from './utils.js';
import { renderDashboard, renderDeskList } from './dashboard.js';
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

  // 先凭 cookie 走 /api/me 恢复登录态（server 重启后 cookie 失效→回到登录）
  let me = null;
  try {
    const res = await fetch('/api/me', { credentials: 'include' });
    if (res.ok) me = await res.json();
  } catch { /* server 未起：me 为 null，落到本地兜底 */ }

  if (me && me.ok) {
    store.setOperator(me.name);
    store.setAdminFromServer(me.isAdmin);
  } else if (!localStorage.getItem('ss_operator')) {
    applyAdminUI();   // 未登录：隐藏管理 UI 后弹登录
    openLogin({ mode: 'first' });
    return;
  }
  showOperator(store.getOperator());
  applyAdminUI();
  await preloadWithAnimation();
  route();
}

/* ---------- 预加载动画：登录通过后才加载素材（未登录不暴露资源）；设计台选图秒开 ---------- */
async function preloadWithAnimation() {
  const loader = $('preloader');
  if (!loader) return;
  loader.style.display = '';        // 显示加载层（默认 display:none）
  loader.classList.remove('hide');
  const bar = loader.querySelector('.pl-bar > i');
  const num = loader.querySelector('.pl-num');
  const total = loader.querySelector('.pl-total');

  const setProgress = (done, t) => {
    if (num) num.textContent = done;
    if (total) total.textContent = t;
    if (bar) bar.style.width = (t > 0 ? (done / t * 100) : 0) + '%';
  };

  // 超时兜底：素材多/网慢时最多等 12s，不无限卡住用户
  const timeout = new Promise(resolve => setTimeout(resolve, 12000));
  const list = await Promise.race([store.preloadAssets(setProgress), timeout]);

  // 放行前确保进度拉满（首次逐张走完；缓存命中秒 resolve 时补满，避免 0 进度闪现）
  const t = (list && list.length) || 0;
  if (t > 0) { setProgress(t, t); await new Promise(r => setTimeout(r, 150)); }

  loader.classList.add('hide');
  setTimeout(() => { loader.style.display = 'none'; }, 400);
}

// 按管理员身份显隐管理类 UI（导入/选目录/新建/后台 仅管理员可见）
function applyAdminUI() {
  const admin = store.isAdmin();
  const show = admin ? '' : 'none';
  $('importBtn').style.display = show;
  $('dirBtn').style.display = show;
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

  const ok = async () => {
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    // 走服务端 /api/login 校验白名单
    try {
      const res = await fetch('/api/login', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      if (res.status === 403) {
        sub.textContent = '未授权，无法进入工作台';
        input.select();
        return;
      }
      if (!res.ok) throw new Error('登录失败(' + res.status + ')');
      const r = await res.json();
      store.setOperator(name);
      store.setAdminFromServer(r.isAdmin);
    } catch (e) {
      sub.textContent = '登录失败：' + e.message + '（服务器是否已启动？）';
      return;
    }
    showOperator(name);
    ov.classList.remove('on');
    applyAdminUI();
    await preloadWithAnimation();   // 登录验证通过后再加载素材（未登录不暴露资源）
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
  const isTopLevel = (hash === 'dashboard' || hash === 'admin' || hash === 'review' || hash === 'design');
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
  let hash = location.hash.slice(1) || 'dashboard';
  // 非 admin 绝不进后台/总览：立即重定向到审核台（URL 也改掉），杜绝管理内容闪现
  if (!store.isAdmin() && (hash === 'admin' || hash === 'dashboard' || hash === '')) {
    hash = 'review';
    history.replaceState(null, '', '#review');
  }
  // 主区先占位清空，避免上次内容在 async 渲染期间闪现
  $('main').innerHTML = '<div style="padding:80px;text-align:center;color:#8a9099">加载中…</div>';

  const isTopLevel = (hash === 'dashboard' || hash === '' || hash === 'admin' || hash === 'review' || hash === 'design');
  if (isTopLevel) {
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
    if (!store.isAdmin()) { go('review'); return; }  // 成员看不见总览，默认进审核台
    $('subTitle').textContent = '总览';
    const projects = await store.loadProjectList();
    renderDashboard(projects, $('main'), {});
    return;
  }

  if (hash === 'review' || hash === 'design') {
    $('subTitle').textContent = hash === 'design' ? '设计台' : '审核台';
    const projects = await store.loadProjectList();
    renderDeskList(projects, $('main'), hash);
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
  const admin = store.isAdmin();
  const hash = location.hash.slice(1);
  const dashItem = admin ? `<div class="nav-item ${!currentTitle && hash !== 'admin' && hash !== 'review' && hash !== 'design' ? 'active' : ''}" data-href="dashboard">📊 总览</div>` : '';
  const adminItem = admin ? `<div class="nav-item ${hash === 'admin' ? 'active' : ''}" data-href="admin">👑 管理员后台</div>` : '';
  const newBtn = admin ? `<button class="btn new-btn" id="newProjectBtn">＋ 新建文案</button>` : '';

  $('sidebar').innerHTML = `
    ${dashItem}
    <div class="nav-item ${hash === 'review' ? 'active' : ''}" data-href="review">📝 审核台</div>
    <div class="nav-item ${hash === 'design' ? 'active' : ''}" data-href="design">🎨 设计台</div>
    ${adminItem}
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
