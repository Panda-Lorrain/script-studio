// workspace/js/design.js
import * as store from './store.js';
import * as utils from './utils.js';
import { openPicker } from './picker.js';
import { exportShotList, exportCutGuide } from './export.js';

const POST_KINDS = [['text', '文字'], ['sticker', '贴纸'], ['fx', '特效'], ['anim', '动画']];
const TRANS_PRESETS = ['', '淡入淡出', '黑场', '白场', '缩放', '滑动', '运镜', '闪白', '无缝'];
const AUDIO = [['bgm', '背景音乐'], ['sfx', '音效'], ['voice', '口播'], ['voiceFx', '变声']];

export async function renderDesign(data, main) {
  const assets = await store.loadAssets();
  const design = data.design;
  if (!design.shots) design.shots = [];
  const review = data.review || {};

  // 空状态：还没有分镜（文案未审核，或审核了但没点「完成审核」生成分镜）→ 明显引导，而不是空壳
  if (design.shots.length === 0) {
    // 「已审核」= 用户在审核台对至少一条建议做过采纳/保留决定；仅有 skill 预审内容(原文/items)不算已审核
    const decided = review.decisions && Object.values(review.decisions).some(d => d.adopted || d.kept);
    const hasReviewed = !!decided;
    const title = utils.esc(data.meta.title);
    const goReviewHash = encodeURIComponent(data.meta.title) + '/review';
    main.innerHTML = `
      <div class="design-wrap">
        <div class="design-head">
          <h1>🎬 画面设计 · ${title} · 0 镜</h1>
        </div>
        <div class="design-empty">
          <div class="de-icon">${hasReviewed ? '🎬' : '📝'}</div>
          <div class="de-title">${hasReviewed ? '文案已审核，还没生成分镜' : '这篇文案还没审核'}</div>
          <div class="de-desc">${hasReviewed
            ? '画面分镜由审核后的文案自动拆分。请回到审核台点「<b>✓ 完成审核</b>」，系统会按断句生成逐句分镜，再回到这里逐镜配画面。'
            : '画面分镜需要先有审核后的文案。请到审核台对这篇文案做合规审核，完成后系统会自动生成分镜，即可在这里逐镜设计画面。'}</div>
          <button class="btn primary de-cta" id="goReviewBtn">${hasReviewed ? '✅ 去完成审核' : '📝 去审核台'}</button>
          <div class="de-hint">当前分镜数据为空（0 镜）· 审核台在左侧导航「📝 审核台」</div>
        </div>
      </div>
    `;
    const go = window.__go || (h => { location.hash = h; });
    main.querySelector('#goReviewBtn').onclick = () => go(goReviewHash);
    return;
  }

  // 旧数据兼容：逐镜音频 audio / audioTiming（旧 shot 没有这两组，渲染前补空对象，免得输入时报错）
  design.shots.forEach(s => {
    if (!s.audio) s.audio = {};
    if (!s.audioTiming) s.audioTiming = {};
  });

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
    else if (k && k.startsWith('postc.')) {
      const idx = +k.slice(6);
      if (s.post[idx]) s.post[idx].content = v;
    }
    else if (k && k.startsWith('audio.')) s.audio[k.slice(6)] = v;
    else if (k && k.startsWith('audioTiming.')) s.audioTiming[k.slice(12)] = v;
    s.lastBy = store.getOperator();
    s.lastTs = utils.nowIso();
    debounceSave(data);
  });

  shotsEl.addEventListener('change', e => {
    const el = e.target;
    if (!el.classList.contains('trans-select')) return;
    const i = +el.dataset.i;
    const s = design.shots[i];
    s.trans = el.value || null;
    s.lastBy = store.getOperator(); s.lastTs = utils.nowIso();
    debounceSave(data);
  });

  function autoGrow(el) { el.style.height = 'auto'; el.style.height = (el.scrollHeight + 2) + 'px'; }

  // 暴露给 onclick 的操作
  window.__designSetType = async (i, type) => {
    const s = design.shots[i];
    s.subject.type = type;
    if (type !== 'lib') s.subject.assetIds = [];
    if (type !== 'ai') { s.subject.refs = []; s.subject.prompt = ''; }
    s.lastBy = store.getOperator(); s.lastTs = utils.nowIso();
    renderShots();
    safeSave(data, 'design_edit', `第${i + 1}镜主体=${type || '未定'}`);
  };

  window.__designPick = (i, field) => {
    const s = design.shots[i];
    if (field === 'lib') {
      openPicker({
        assets, currentIds: (s.subject.assetIds || []).slice(), multi: true, title: '选画面主体（可多选）', sub: `第 ${i + 1} 镜`,
        onSelect: async (ids) => {
          s.subject.type = 'lib'; s.subject.assetIds = ids.slice();
          s.lastBy = store.getOperator(); s.lastTs = utils.nowIso();
          renderShots();
          safeSave(data, 'design_edit', `第${i + 1}镜选库 ${ids.join(',')}`);
        }
      });
    } else {
      openPicker({
        assets, currentIds: s.subject.refs.slice(), multi: true, title: '加参考图（可多选）', sub: `第 ${i + 1} 镜`,
        onSelect: async (ids) => {
          s.subject.refs = ids.slice();
          if (s.subject.type !== 'ai') s.subject.type = 'ai';
          s.lastBy = store.getOperator(); s.lastTs = utils.nowIso();
          renderShots();
          safeSave(data, 'design_edit', `第${i + 1}镜参考图更新`);
        }
      });
    }
  };

  window.__designRemoveRef = async (i, idx) => {
    design.shots[i].subject.refs.splice(idx, 1);
    design.shots[i].lastBy = store.getOperator();
    design.shots[i].lastTs = utils.nowIso();
    renderShots();
    safeSave(data, 'design_edit', `第${i + 1}镜删参考图`);
  };

  window.__designRemoveLib = async (i, idx) => {
    const s = design.shots[i];
    s.subject.assetIds.splice(idx, 1);
    s.lastBy = store.getOperator(); s.lastTs = utils.nowIso();
    renderShots();
    safeSave(data, 'design_edit', `第${i + 1}镜删选库图`);
  };

  window.__designAddPost = (i, kind) => {
    design.shots[i].post.push({ kind, content: '', range: null, note: '' });
    design.shots[i].lastBy = store.getOperator();
    design.shots[i].lastTs = utils.nowIso();
    renderShots();
    safeSave(data, 'design_edit', `第${i + 1}镜加${kind}`);
  };
  window.__designDelPost = (i, idx) => {
    design.shots[i].post.splice(idx, 1);
    design.shots[i].lastBy = store.getOperator();
    design.shots[i].lastTs = utils.nowIso();
    renderShots();
    safeSave(data, 'design_edit', `第${i + 1}镜删后期元素`);
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
    const html = design.shots.map((s, i) => {
      const card = shotHTML(s, i, assets);
      const trans = (i < design.shots.length - 1) ? transHTML(s, i) : '';
      return card + trans;
    }).join('');
    shotsEl.innerHTML = html;
    shotsEl.querySelectorAll('.auto-grow').forEach(autoGrow);
    updateSummary();
    bindAxis();
  }
  function transHTML(s, i) {
    const cur = s.trans || '';
    const opts = TRANS_PRESETS.map(p => `<option value="${utils.escAttr(p)}"${p === cur ? ' selected' : ''}>${p || '（无转场）'}</option>`).join('');
    return `<div class="trans-slot"><span class="trans-arrow">▶</span><label>转场到第 ${i + 2} 镜</label><select class="inp trans-select" data-i="${i}">${opts}</select></div>`;
  }

  function bindAxis() {
    shotsEl.querySelectorAll('.axis').forEach(axis => {
      if (axis.dataset.bound) return;
      axis.dataset.bound = '1';
      axis.querySelectorAll('.w').forEach(w => {
        w.addEventListener('click', () => {
          const i = +axis.dataset.i;
          const idx = axis.dataset.selIdx;
          if (idx == null) { utils.toast('先点一条元素的条段选中它'); return; }
          const end = axis.dataset.selEnd || 'a';
          const s = design.shots[i];
          const el = s.post[+idx];
          if (!el) return;
          const c = +w.dataset.c;
          if (el.range == null) el.range = [c, c + 1];
          if (end === 'a') el.range = [c, Math.max(c + 1, el.range[1])];
          else el.range = [Math.min(el.range[0], c), c + 1];
          if (el.range[0] >= el.range[1]) el.range = [el.range[0], el.range[0] + 1];
          s.lastBy = store.getOperator(); s.lastTs = utils.nowIso();
          renderShots(); bindAxis(); debounceSave(data);
        });
      });
      axis.querySelectorAll('.seg-bar').forEach(bar => {
        bar.addEventListener('click', e => {
          e.stopPropagation();
          axis.dataset.selIdx = bar.dataset.idx;
          axis.dataset.selEnd = 'a';
          axis.querySelectorAll('.track.selected').forEach(t => t.classList.remove('selected'));
          bar.closest('.track').classList.add('selected');
        });
        bar.addEventListener('mousedown', e => startDrag(axis, bar, e));
        bar.addEventListener('dblclick', e => { e.preventDefault(); resetRange(axis, bar); });
      });
    });
  }
  function resetRange(axis, bar) {
    const i = +axis.dataset.i, idx = +bar.dataset.idx;
    const s = design.shots[i];
    s.post[idx].range = null;
    s.lastBy = store.getOperator(); s.lastTs = utils.nowIso();
    renderShots(); bindAxis(); debounceSave(data);
  }
  function startDrag(axis, bar, ev) {
    ev.preventDefault();
    const i = +axis.dataset.i, idx = +bar.dataset.idx;
    axis.dataset.selIdx = idx; axis.dataset.selEnd = 'a';
    const s = design.shots[i], el = s.post[idx];
    const line = s.line || '';
    const len = [...line].length;
    if (el.range == null) el.range = [0, len];
    const axisRect = axis.getBoundingClientRect();
    const charAt = (clientX) => {
      const ratio = Math.min(1, Math.max(0, (clientX - axisRect.left) / axisRect.width));
      return Math.round(ratio * len);
    };
    let dragEnd = null;
    const onMove = (e) => {
      const x = e.clientX;
      if (dragEnd == null) {
        const aPx = axisRect.left + (el.range[0] / len) * axisRect.width;
        const bPx = axisRect.left + (el.range[1] / len) * axisRect.width;
        dragEnd = Math.abs(x - aPx) <= Math.abs(x - bPx) ? 'a' : 'b';
        axis.dataset.selEnd = dragEnd;
      }
      const c = charAt(x);
      if (dragEnd === 'a') el.range = [Math.min(c, el.range[1] - 1), el.range[1]];
      else el.range = [el.range[0], Math.max(c, el.range[0] + 1)];
      const left = (el.range[0] / len * 100).toFixed(2);
      const width = ((el.range[1] - el.range[0]) / len * 100).toFixed(2);
      bar.style.left = left + '%'; bar.style.width = width + '%';
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      s.lastBy = store.getOperator(); s.lastTs = utils.nowIso();
      renderShots(); bindAxis(); debounceSave(data);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  // 口播文字轴：line 按字切块；每条 post 元素一轨，range 映射成 % 条段
  function renderAxis(s, i) {
    const line = s.line || '';
    if (!line) return '';
    const words = [...line];
    const len = words.length;
    const wordSpans = words.map((w, ci) => `<span class="w" data-i="${i}" data-c="${ci}">${utils.esc(w)}</span>`).join('');
    const tracks = s.post.map((el, idx) => {
      const full = el.range == null ? ' full' : '';
      let bar = '';
      if (el.range != null) {
        const [a, b] = el.range;
        const left = (Math.max(0, a) / len * 100).toFixed(2);
        const width = (Math.min(len, b) - Math.max(0, a)) / len * 100;
        bar = `<div class="seg-bar k-${el.kind}" style="left:${left}%;width:${width}%" data-i="${i}" data-idx="${idx}" title="拖两端改区间·双击跟镜"></div>`;
      }
      return `<div class="track${full}" data-i="${i}" data-idx="${idx}">${bar}</div>`;
    }).join('');
    return `
      <div class="axis" data-i="${i}">
        <div class="axis-cap">口播文字轴（拖条段·点字设进/出·双击跟镜）</div>
        <div class="track track-line">${wordSpans}</div>
        ${tracks}
      </div>`;
  }

  function shotHTML(s, i, assets) {
    const t = s.subject.type;
    const cls = t === 'lib' ? 'has-lib' : t === 'ai' ? 'has-ai' : '';
    const assetIds = s.subject.assetIds || [];
    let thumb;
    if (t === 'lib' && assetIds.length) {
      const a = store.assetById(assets, assetIds[0]);
      thumb = a ? `<div class="thumb" style="background-image:url('${store.assetUrl(a)}')" onclick="window.__designPick(${i},'lib')" title="点击换图"><span class="thumb-id">${a.id}</span></div>`
        : `<div class="thumb empty" onclick="window.__designPick(${i},'lib')">+ 选图</div>`;
    } else if (t === 'ai') {
      thumb = `<div class="thumb ai-ph" onclick="document.getElementById('prompt${i}').focus()" title="AI 生成（待生图）">AI<br>待生</div>`;
    } else {
      thumb = `<div class="thumb empty" onclick="window.__designSetType(${i},'lib');window.__designPick(${i},'lib')" title="点击选图">+ 选图</div>`;
    }

    let detail = '';
    if (t === 'lib') {
      if (assetIds.length) {
        const libRefs = assetIds.map((rid, idx) => {
          const a = store.assetById(assets, rid);
          if (!a) return '';
          return `<div class="ref-thumb" style="background-image:url('${store.assetUrl(a)}')" title="${utils.escAttr(a.id + '·' + a.desc)}"><span class="x" onclick="window.__designRemoveLib(${i},${idx})">×</span></div>`;
        }).join('');
        detail = `<div class="lib-box"><div class="refs">${libRefs}<button class="add-ref" onclick="window.__designPick(${i},'lib')" title="加图">+</button></div></div>`;
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
      ${s.lastBy ? `<span class="shot-op">${utils.operatorTag(s.lastBy)}</span>` : ''}
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
        <div class="post-list">
          ${s.post.map((el, idx) => `
            <div class="post-item">
              <span class="post-kind k-${el.kind}">${(POST_KINDS.find(p => p[0] === el.kind) || ['', '?'])[1]}</span>
              <input class="inp post-content" placeholder="内容" value="${utils.escAttr(el.content)}" data-i="${i}" data-k="postc.${idx}">
              <span class="post-range-tag" title="${utils.escAttr(el.note ? '原时机备注：' + el.note : '')}">${el.range ? '⏱已设' : '⏱跟镜'}${el.note ? '·有备注' : ''}</span>
              <span class="post-x" onclick="window.__designDelPost(${i},${idx})" title="删除">×</span>
            </div>`).join('')}
          <div class="post-add">
            ${POST_KINDS.map(([k, l]) => `<button class="post-add-btn" onclick="window.__designAddPost(${i},'${k}')">＋${l}</button>`).join('')}
          </div>
        </div>
        ${renderAxis(s, i)}
      </div>
      <div class="field">
        <div class="field-label">🔊 音频</div>
        <div class="audio">
          ${AUDIO.map(([k, label]) => `<div class="cell"><label>${label}</label><input class="inp" placeholder="内容" value="${utils.escAttr(s.audio[k] || '')}" data-i="${i}" data-k="audio.${k}"><input class="inp timing" placeholder="⏱ 念到…时" value="${utils.escAttr(s.audioTiming[k] || '')}" data-i="${i}" data-k="audioTiming.${k}"></div>`).join('')}
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
