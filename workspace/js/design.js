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

  main.querySelector('#shotListBtn').onclick = () => exportShotList(data, assets);
  main.querySelector('#cutGuideBtn').onclick = () => exportCutGuide(data);

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

  // 暴露给 onclick 的操作
  window.__designSetType = async (i, type) => {
    const s = design.shots[i];
    s.subject.type = type;
    if (type !== 'lib') s.subject.assetId = null;
    if (type !== 'ai') { s.subject.refs = []; s.subject.prompt = ''; }
    await safeSave(data, 'design_edit', `第${i + 1}镜主体=${type || '未定'}`);
    renderShots();
  };

  window.__designPick = (i, field) => {
    const s = design.shots[i];
    if (field === 'lib') {
      openPicker({
        assets, currentId: s.subject.assetId, multi: false, title: '选画面主体（单选）', sub: `第 ${i + 1} 镜`,
        onSelect: async (id) => {
          s.subject.type = 'lib'; s.subject.assetId = id;
          await safeSave(data, 'design_edit', `第${i + 1}镜选库 ${id}`);
          renderShots();
        }
      });
    } else {
      openPicker({
        assets, currentIds: s.subject.refs.slice(), multi: true, title: '加参考图（可多选）', sub: `第 ${i + 1} 镜`,
        onSelect: async (ids) => {
          s.subject.refs = ids.slice();
          if (s.subject.type !== 'ai') s.subject.type = 'ai';
          await safeSave(data, 'design_edit', `第${i + 1}镜参考图更新`);
          renderShots();
        }
      });
    }
  };

  window.__designRemoveRef = async (i, idx) => {
    design.shots[i].subject.refs.splice(idx, 1);
    await safeSave(data, 'design_edit', `第${i + 1}镜删参考图`);
    renderShots();
  };

  let saveTimer = null;
  function debounceSave(data) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      safeSave(data, 'design_edit', '编辑后期/字幕');
    }, 1500);
  }

  async function safeSave(data, action, detail) {
    try { await store.logAndSave(data, action, detail); }
    catch (e) { utils.toast('保存失败：' + e.message); }
  }

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
      thumb = a ? `<div class="thumb" style="background-image:url('${store.assetUrl(a)}')" onclick="window.__designPick(${i},'lib')" title="点击换图"><span class="thumb-id">${a.id}</span></div>`
        : `<div class="thumb empty" onclick="window.__designPick(${i},'lib')">+ 选图</div>`;
    } else if (t === 'ai') {
      thumb = `<div class="thumb ai-ph" onclick="document.getElementById('prompt${i}').focus()" title="AI 生成（待生图）">AI<br>待生</div>`;
    } else {
      thumb = `<div class="thumb empty" onclick="window.__designSetType(${i},'lib');window.__designPick(${i},'lib')" title="点击选图">+ 选图</div>`;
    }

    let detail = '';
    if (t === 'lib') {
      if (s.subject.assetId) {
        const a = store.assetById(assets, s.subject.assetId);
        detail = a ? `<div class="lib-info">已选 <b>${a.id}·${utils.esc(a.desc)}</b> <span class="hint">[${a.cat}/${a.framing}]</span>
          <button class="btn ghost" style="padding:3px 10px;font-size:12px" onclick="window.__designPick(${i},'lib')">换图</button></div>`
          : `<div class="lib-info hint">素材不存在</div>`;
      } else {
        detail = `<div class="lib-info hint">点上方缩略图选一张</div>`;
      }
    } else if (t === 'ai') {
      const refs = s.subject.refs.map((rid, idx) => {
        const a = store.assetById(assets, rid);
        if (!a) return '';
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

  renderShots();
}
