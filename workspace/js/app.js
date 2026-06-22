// workspace/js/app.js
// 入口：路由、侧栏、初始化
import * as store from './store.js';
import * as utils from './utils.js';
import { renderDashboard } from './dashboard.js';
import { renderReview } from './review.js';
import { renderDesign } from './design.js';
import { importJSONFile } from './export.js';

const $ = id => document.getElementById(id);
let currentTitle = null;

/* ---------- 初始化 ---------- */
async function boot() {
  setupOperator();
  await setupDirButton();
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

  const slashIdx = hash.lastIndexOf('/');
  const mode = slashIdx >= 0 ? hash.slice(slashIdx + 1) : '';
  const title = slashIdx >= 0 ? hash.slice(0, slashIdx) : hash;
  const decodedTitle = decodeURIComponent(title);
  currentTitle = decodedTitle;

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
    return `<div class="nav-item ${active}" data-href="${stage}">
      <span>📄 ${utils.esc(p.title)}</span>
      <span class="stage-dot" title="${stageText[p.stage] || ''}">${stageLabel[p.stage] || ''}</span>
    </div>`;
  }).join('');

  $('sidebar').innerHTML = `
    <div class="nav-item ${!currentTitle ? 'active' : ''}" data-href="dashboard">📊 总览</div>
    <div class="nav-section">文案 (${projects.length})</div>
    ${items || '<div class="nav-section" style="padding-top:0">暂无文案</div>'}
    <button class="btn new-btn" id="newProjectBtn">＋ 新建文案</button>
  `;

  // 绑定侧栏点击（事件委托）
  $('sidebar').onclick = e => {
    const item = e.target.closest('[data-href]');
    if (item) location.hash = item.dataset.href;
  };
  const newBtn = $('newProjectBtn');
  if (newBtn) newBtn.onclick = newProject;
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
    location.hash = encodeURIComponent(t) + '/review';
  } catch (err) {
    utils.toast('创建失败：' + err.message);
  }
}

function openProject(title, mode) {
  location.hash = encodeURIComponent(title) + '/' + mode;
}

boot();
