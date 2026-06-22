// workspace/js/admin.js
// 管理员后台：按人统计 + 项目进度 + 全局操作时间线
import * as store from './store.js';
import * as utils from './utils.js';

const ACTION_LABEL = {
  created: '创建项目',
  migrated: '迁移导入',
  review_decide: '审核采纳/保留',
  review_edit: '编辑改写',
  manual_edit: '手动改输出',
  manual_revert: '撤销手动改',
  pushed_to_design: '推入设计台',
  design_edit: '设计编辑',
  imported: '导入合并'
};

export async function renderAdmin(main) {
  main.innerHTML = '<div style="padding:60px;text-align:center;color:#8a9099">加载中…</div>';
  const [activity, projects] = await Promise.all([store.loadAllActivity(), store.loadProjectList()]);

  // 按人聚合
  const byWho = {};
  activity.forEach(a => {
    const w = a.who || '匿名';
    if (!byWho[w]) byWho[w] = { name: w, count: 0, lastTs: '', projects: new Set() };
    byWho[w].count++;
    if ((a.ts || '') > byWho[w].lastTs) byWho[w].lastTs = a.ts;
    if (a.project) byWho[w].projects.add(a.project);
  });
  const me = store.getOperator();
  const people = Object.values(byWho).sort((a, b) => b.count - a.count);
  const timeline = activity.slice(0, 80);

  const stat = `<div class="admin-stat">共 <b>${people.length}</b> 位协作者 · <b>${activity.length}</b> 条操作 · <b>${projects.length}</b> 篇文案</div>`;

  const peopleHtml = people.map(p => `
    <div class="admin-person">
      ${utils.operatorAvatar(p.name)}
      <div class="ap-info">
        <div class="ap-name">${utils.esc(p.name)}${p.name === me ? ' <span class="ap-me">（你）</span>' : ''}</div>
        <div class="ap-meta">操作 <b>${p.count}</b> 次 · 参与 <b>${p.projects.size}</b> 篇 · 最后活跃 ${utils.timeAgo(p.lastTs) || '—'}</div>
      </div>
    </div>`).join('');

  const projHtml = projects.map(p => {
    const stageLabel = { review: '🔵 审核中', design: '🟡 设计中', done: '🟢 已完成' }[p.stage] || '';
    return `<div class="admin-proj">
      <span class="apj-title">📄 ${utils.esc(p.title)}</span>
      <span class="apj-stage">${stageLabel}</span>
      <span class="apj-meta">${p.shotCount}镜 · ${p.reviewItemCount}条审核</span>
      <span class="apj-time">${utils.timeAgo(p.updated) || '—'}</span>
    </div>`;
  }).join('');

  const tlHtml = timeline.map(a => `
    <div class="admin-tl">
      ${utils.operatorAvatar(a.who || '匿名')}
      <div class="atl-body">
        <div><b>${utils.esc(a.who || '匿名')}</b> <span class="atl-act">${ACTION_LABEL[a.action] || a.action}</span> <span class="atl-proj">· ${utils.esc(a.project)}</span></div>
        <div class="atl-detail">${utils.esc(a.detail || '')} <span class="atl-time">· ${utils.timeAgo(a.ts)}</span></div>
      </div>
    </div>`).join('') || '<div class="admin-empty">暂无操作记录</div>';

  main.innerHTML = `
    <div class="admin-wrap">
      <div class="admin-head"><h1>👑 管理员后台</h1></div>
      ${stat}
      <div class="admin-section">
        <div class="admin-sec-title">👥 协作者（${people.length}）</div>
        <div class="admin-people">${peopleHtml || '<div class="admin-empty">暂无协作者</div>'}</div>
      </div>
      <div class="admin-section">
        <div class="admin-sec-title">📋 项目进度（${projects.length}）</div>
        <div class="admin-projs">${projHtml || '<div class="admin-empty">暂无文案</div>'}</div>
      </div>
      <div class="admin-section">
        <div class="admin-sec-title">🕐 操作时间线（最近 ${timeline.length}）</div>
        <div class="admin-tls">${tlHtml}</div>
      </div>
    </div>`;
}
