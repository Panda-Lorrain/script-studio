// workspace/js/dashboard.js
import * as store from './store.js';
import * as utils from './utils.js';
import { exportProject } from './export.js';

const STAGE_LABEL = { review: '🔵 审核中', design: '🟡 设计中', done: '🟢 已完成' };
const go = (h) => (window.__go || ((x) => { location.hash = x; }))(h);

// 总览：两个工作台入口 + 全部文案状态
export async function renderDashboard(projects, main, handlers) {
  const stat = { review: 0, design: 0, done: 0 };
  projects.forEach(p => { stat[p.stage] = (stat[p.stage] || 0) + 1; });
  const cards = await Promise.all(projects.map(p => loadCard(p)));

  main.innerHTML = `
    <div style="padding:20px 24px">
      <div class="desk-entries">
        <div class="desk-entry review" data-href="review">
          <div class="de-icon">📝</div>
          <div class="de-body"><div class="de-title">审核台</div><div class="de-desc">审核文案风险，逐条采纳 / 改写</div></div>
          <div class="de-arrow">›</div>
        </div>
        <div class="desk-entry design" data-href="design">
          <div class="de-icon">🎨</div>
          <div class="de-body"><div class="de-title">设计台</div><div class="de-desc">分镜画面设计，剪映后期</div></div>
          <div class="de-arrow">›</div>
        </div>
      </div>
      <div style="font-size:13px;color:#8a9099;margin:22px 0 14px">
        全部文案（${projects.length}）｜ 🔵 审核中 <b>${stat.review || 0}</b> · 🟡 设计中 <b>${stat.design || 0}</b> · 🟢 已完成 <b>${stat.done || 0}</b>
      </div>
      <div class="project-grid" id="projectGrid">${cards.join('') || '<div class="admin-empty">还没有文案，用 /script-review 生成，或点侧栏「＋ 新建文案」</div>'}</div>
    </div>`;

  main.querySelectorAll('.desk-entry').forEach(el => { el.onclick = () => go(el.dataset.href); });
  main.querySelector('#projectGrid').addEventListener('click', onCardClick);
}

// 工作台文案列表（#review 审核台 / #design 设计台）
export async function renderDeskList(projects, main, mode) {
  const label = mode === 'design' ? '🎨 设计台' : '📝 审核台';
  const action = mode === 'design' ? '设计' : '审核';
  if (!projects.length) {
    main.innerHTML = `<div style="padding:60px;text-align:center;color:#8a9099"><div style="font-size:32px;margin-bottom:12px">${mode === 'design' ? '🎨' : '📝'}</div>${label}<br><br>暂无文案</div>`;
    return;
  }
  const cards = await Promise.all(projects.map(p => loadCard(p, mode)));
  main.innerHTML = `
    <div style="padding:20px 24px">
      <div style="font-size:18px;font-weight:600;margin-bottom:4px">${label}</div>
      <div style="font-size:13px;color:#8a9099;margin-bottom:16px">选择要${action}的文案</div>
      <div class="project-grid" id="deskGrid">${cards.join('')}</div>
    </div>`;
  main.querySelector('#deskGrid').addEventListener('click', onCardClick);
}

async function loadCard(p, mode) {
  let progress = '';
  let lastEdit = '';
  try {
    const data = await store.loadProject(p.title);
    if (data.meta.stage === 'review' || data.review.items.length) {
      const decided = Object.values(data.review.decisions || {}).filter(d => d.adopted || d.kept).length;
      progress = `审核 ${decided}/${data.review.items.length}`;
    }
    if (data.design.shots.length) {
      const designed = data.design.shots.filter(s => s.subject && s.subject.type).length;
      progress = (progress ? progress + ' · ' : '') + `设计 ${designed}/${data.design.shots.length}镜`;
    }
    const log = data.changelog && data.changelog[data.changelog.length - 1];
    if (log) lastEdit = `${utils.esc(log.who)} · ${utils.timeAgo(log.ts)}`;
  } catch (e) {
    progress = '（无法读取）';
  }

  // mode 决定主操作按钮：审核台只进审核，设计台只进设计；总览（无 mode）两个都给
  const enterBtn = mode === 'review'
    ? `<button class="btn primary" data-act="review" data-title="${utils.escAttr(p.title)}">打开审核 →</button>`
    : mode === 'design'
      ? `<button class="btn primary" data-act="design" data-title="${utils.escAttr(p.title)}">进入设计 →</button>`
      : `<button class="btn" data-act="review" data-title="${utils.escAttr(p.title)}">查看审核</button><button class="btn" data-act="design" data-title="${utils.escAttr(p.title)}">进入设计</button>`;

  return `
    <div class="proj-card panel">
      <div class="proj-head">
        <span class="proj-title">📄 ${utils.esc(p.title)}</span>
        <span class="stage-tag ${p.stage}">${STAGE_LABEL[p.stage] || ''}</span>
      </div>
      <div class="proj-progress">${progress || '（空）'}</div>
      <div class="proj-last">${lastEdit}</div>
      <div class="proj-actions">
        ${enterBtn}
        <button class="btn ghost" data-act="export" data-title="${utils.escAttr(p.title)}">导出</button>
      </div>
    </div>`;
}

async function onCardClick(e) {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;
  const title = btn.dataset.title;
  if (act === 'review' || act === 'design') {
    go(encodeURIComponent(title) + '/' + act);
  } else if (act === 'export') {
    try {
      const data = await store.loadProject(title);
      await exportProject(data);
    } catch (err) {
      utils.toast('导出失败：' + err.message);
    }
  }
}
