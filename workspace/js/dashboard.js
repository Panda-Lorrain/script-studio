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
        <div style="font-size:16px;margin-bottom:8px;color:#1f2329">还没有文案</div>
        <div style="font-size:13px;margin-bottom:20px">用 /script-review 生成，或点侧栏「＋ 新建文案」</div>
      </div>`;
    return;
  }

  const stat = { review: 0, design: 0, done: 0 };
  projects.forEach(p => { stat[p.stage] = (stat[p.stage] || 0) + 1; });

  const cards = await Promise.all(projects.map(p => loadCard(p)));

  main.innerHTML = `
    <div style="padding:20px 24px">
      <div style="font-size:13px;color:#8a9099;margin-bottom:16px">
        共 <b style="color:#1f2329">${projects.length}</b> 篇
        ｜ 🔵 审核中 <b>${stat.review || 0}</b>
        ｜ 🟡 设计中 <b>${stat.design || 0}</b>
        ｜ 🟢 已完成 <b>${stat.done || 0}</b>
      </div>
      <div class="project-grid" id="projectGrid">
        ${cards.join('')}
      </div>
    </div>
  `;

  main.querySelector('#projectGrid').addEventListener('click', onCardClick);
}

async function loadCard(p) {
  let progress = '';
  let lastEdit = '';
  try {
    const data = await store.loadProject(p.title);
    if (data.meta.stage === 'review' || data.review.items.length) {
      const decided = Object.values(data.review.decisions || {}).filter(d => d.adopted || d.kept).length;
      const total = data.review.items.length;
      progress = `审核 ${decided}/${total}`;
    }
    if (data.design.shots.length) {
      const designed = data.design.shots.filter(s => s.subject && s.subject.type).length;
      progress = (progress ? progress + ' · ' : '') + `设计 ${designed}/${data.design.shots.length}镜`;
    }
    const log = data.changelog && data.changelog[data.changelog.length - 1];
    if (log) lastEdit = `${utils.esc(log.who)} · ${utils.timeAgo(log.ts)}`;
  } catch (e) {
    progress = '（无法读取详情）';
  }

  return `
    <div class="proj-card panel">
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
    (window.__go || (h => { location.hash = h; }))(encodeURIComponent(title) + '/' + act);
  } else if (act === 'export') {
    try {
      const data = await store.loadProject(title);
      await exportProject(data);
    } catch (err) {
      utils.toast('导出失败：' + err.message);
    }
  }
}
