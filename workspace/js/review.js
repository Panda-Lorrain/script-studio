// workspace/js/review.js
import * as store from './store.js';
import * as utils from './utils.js';

const LEVEL_RANK = { high: 3, medium: 2, low: 1 };
const LEVEL_LABEL = { high: '🔴 高危', medium: '🟡 中危', low: '🟢 低危' };
const LEVEL_CLS = { high: 'h', medium: 'm', low: 'l' };

const LONG_PRESS_MS = 500;      // 长按触发阈值
const MOVE_TOLERANCE_PX = 10;   // 按住期间位移超过此值视为滚动，取消长按

export async function renderReview(data, main) {
  const review = data.review;
  if (!review.decisions) review.decisions = {};
  if (!review.items) review.items = [];

  review.items.forEach(it => {
    if (!review.decisions[it.id]) review.decisions[it.id] = { adopted: false, kept: false, editedSuggestion: it.suggestion, lastBy: null, lastTs: null };
  });

  let sortOrder = 'risk';
  let splitMode = false;
  let origSplitMode = false;
  let autoOutput = '';  // 基于采纳 items 算出的建议输出（不含手动改），用于 diff 手动修改
  let activeTimers = new Set();  // 长按定时器集合，重渲前清空防 pending 误触发

  main.innerHTML = `
    <div class="review-wrap">
      <div class="review-head">
        <h1>🛡️ 文案审核 · ${utils.esc(data.meta.title)}</h1>
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
            <h2 style="margin:0">输出 <span style="font-size:11px;color:#8a9099;font-weight:400">（可手动编辑，改动的行会记录到上方「手动修改」）</span></h2>
            <div class="btns">
              <button class="split-btn" id="splitBtn">✂️ 字幕断句</button>
              <button class="btn primary" id="copyBtn">📋 复制</button>
              <button class="btn ok" id="pushDesignBtn">✓ 完成审核</button>
              <button class="btn" id="unpushBtn" style="display:none">↩ 撤销完成</button>
              <button class="btn" id="restoreBtn" style="display:none">♻️ 恢复分镜</button>
              <button class="btn primary" id="goDesignBtn" style="display:none">🎨 去设计台 →</button>
            </div>
          </div>
          <textarea id="revOutput" placeholder="实时拼合修改后的文案，可手动编辑"></textarea>
        </section>
      </div>
    </div>
  `;

  main.querySelectorAll('.sort-btn').forEach(b => {
    b.onclick = () => {
      sortOrder = b.dataset.sort;
      main.querySelectorAll('.sort-btn').forEach(x => x.classList.toggle('on', x.dataset.sort === sortOrder));
      renderItems();
    };
  });

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

  // 「完成审核」/「撤销完成」/「恢复分镜」/「去设计台」按钮 + 按当前状态显示对应入口
  const pushBtn = main.querySelector('#pushDesignBtn');
  const unpushBtn = main.querySelector('#unpushBtn');
  const restoreBtn = main.querySelector('#restoreBtn');
  const goBtn = main.querySelector('#goDesignBtn');
  pushBtn.onclick = () => pushToDesign(data);
  unpushBtn.onclick = () => unpushDesign(data);
  restoreBtn.onclick = () => restoreDesign(data);
  goBtn.onclick = () => (window.__go || (h => { location.hash = h; }))(encodeURIComponent(data.meta.title) + '/design');
  if (data.meta.stage === 'design' || data.meta.stage === 'done') {
    // 完成态
    pushBtn.textContent = '✓ 已完成';
    pushBtn.classList.add('done');
    pushBtn.disabled = true;
    unpushBtn.style.display = '';
    goBtn.style.display = '';
  } else if (data.design._trash && data.design._trash.shots && data.design._trash.shots.length) {
    // 撤销态：分镜在回收站，可一键恢复
    restoreBtn.style.display = '';
  }

  // 用户手动编辑输出框：记录到 review.output，debounce 后重渲采纳区（显示手动修改条目）
  let manualTimer = null;
  main.querySelector('#revOutput').addEventListener('input', () => {
    const ta = main.querySelector('#revOutput');
    review.output = ta.value;
    autoResize(ta);
    clearTimeout(manualTimer);
    manualTimer = setTimeout(() => {
      review.outputLastBy = store.getOperator();
      review.outputLastTs = utils.nowIso();
      renderItems();
      safeSave(data, 'manual_edit', '手动编辑输出');
    }, 800);
  });

  function posOf(it) { return it.original ? review.original.indexOf(it.original) : 999999; }
  // sub 所在行号（1-based，基准与 autoOutput 的行号一致）；找不到返回 Infinity 兜底排序
  function linePos(text, sub) {
    if (!sub) return Infinity;
    const i = text.indexOf(sub);
    return i < 0 ? Infinity : text.slice(0, i).split('\n').length;
  }
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
    clearAllLongPressTimers();
    const manuals = diffManuals();

    const manualCard = m => `
      <div class="rev-card manual">
        <div><span class="tag manual-tag">✏️ 第${m.line}行</span>${review.outputLastBy ? ' ' + utils.operatorTag(review.outputLastBy) : ''}</div>
        <div class="rev-line">
          <span class="from">${utils.esc(m.auto)}</span>
          <span class="arrow">→</span>
          <span class="manual-to">${utils.esc(m.manual)}</span>
        </div>
        <div class="rev-actions">
          <button class="btn" data-revert="${m.line}">↩️ 撤销该行</button>
        </div>
      </div>`;

    const itemCard = it => {
      const d = review.decisions[it.id] || { adopted: false, kept: false, editedSuggestion: it.suggestion };
      const decided = d.adopted || d.kept;
      return `<div class="rev-card ${d.adopted ? 'adopted' : ''} ${d.kept ? 'kept' : ''}" data-id="${it.id}">
        ${decided ? `<button class="rev-undo" data-undo="${it.id}" title="取消这个决定">↩ 撤销</button>` : ''}
        <div><span class="tag ${it.level}">${LEVEL_LABEL[it.level]}</span><span class="cat">${utils.esc(it.category || '')}</span>${decided ? '<span class="rev-reviewed">已审核</span>' : ''}${d.lastBy ? ' ' + utils.operatorTag(d.lastBy) : ''}</div>
        <div class="rev-line">
          <span class="from">${utils.esc(it.original)}</span>
          <span class="arrow">→</span>
          <input class="edit-sug" data-id="${it.id}" value="${utils.escAttr(d.editedSuggestion)}" title="可直接修改改写内容">
        </div>
        <div class="rev-reason">${utils.esc(it.reason || '')}</div>
        <div class="rev-actions">
          <button class="btn yes ${d.adopted ? 'on' : ''}" data-id="${it.id}" data-act="1">✓ 采纳</button>
          <button class="btn no ${d.kept ? 'on' : ''}" data-id="${it.id}" data-act="0">✗ 保留原文</button>
        </div>
      </div>`;
    };

    if (sortOrder === 'text') {
      // 文案顺序：手动修改卡片按行号混入审核项，一起按文案顺序排列，不再单独置顶
      const baseText = splitMode && review.splitOriginal ? review.splitOriginal : review.original;
      const merged = review.items.slice()
        .map(it => ({ card: itemCard(it), pos: linePos(baseText, it.original) }))
        .concat(manuals.map(m => ({ card: manualCard(m), pos: m.line })))
        .sort((a, b) => a.pos - b.pos);
      box.innerHTML = merged.map(x => x.card).join('');
    } else {
      // 危险程度（默认）：手动修改单独分组置顶 + 审核项按危险程度排序
      const manualHtml = manuals.length ? `
        <div class="manual-section">
          <div class="manual-head">✏️ 手动修改 · ${manuals.length} 处 <span class="manual-hint">（你在输出框里改的行，按文案顺序排列，可逐行撤销）</span></div>
          ${manuals.map(manualCard).join('')}
        </div>` : '';
      box.innerHTML = manualHtml + sortedItems().map(itemCard).join('');
    }

    box.querySelectorAll('button[data-revert]').forEach(b => {
      b.onclick = () => revertManual(+b.dataset.revert);
    });
    box.querySelectorAll('button[data-act]').forEach(b => {
      b.onclick = async () => {
        const id = +b.dataset.id;
        const adopt = (b.dataset.act === '1');
        review.decisions[id].adopted = adopt;
        review.decisions[id].kept = !adopt;
        review.decisions[id].lastBy = store.getOperator();
        review.decisions[id].lastTs = utils.nowIso();
        compose();
        safeSave(data, 'review_decide', `第${id}条 ${adopt ? '采纳' : '保留'}`);
      };
    });
    box.querySelectorAll('button[data-undo]').forEach(b => {
      b.onclick = () => {
        const id = +b.dataset.undo;
        review.decisions[id].adopted = false;
        review.decisions[id].kept = false;
        review.decisions[id].lastBy = null;
        review.decisions[id].lastTs = null;
        compose();
        safeSave(data, 'review_undo', `第${id}条撤销决定`);
      };
    });
    box.querySelectorAll('input.edit-sug').forEach(inp => {
      inp.oninput = () => {
        const id = +inp.dataset.id;
        review.decisions[id].editedSuggestion = inp.value;
      };
      inp.onblur = () => {
        const id = +inp.dataset.id;
        review.decisions[id].lastBy = store.getOperator();
        review.decisions[id].lastTs = utils.nowIso();
        compose();
        safeSave(data, 'review_edit', `第${id}条改写`);
      };
    });

    // 长按审核卡片（手动卡 .manual 不带 data-id，天然排除）→ 输出框选区高亮
    box.querySelectorAll('.rev-card[data-id]').forEach(card => bindLongPress(card, +card.dataset.id));
  }

  // —— 长按卡片：在输出框 #revOutput 里选区高亮对应文本 ——
  function clearAllLongPressTimers() {
    activeTimers.forEach(t => clearTimeout(t));
    activeTimers.clear();
  }

  // 长按触发后吞掉 pointerup 衍生的一次 click，避免误触卡片内按钮（capture 阶段先于 onclick）
  function swallowNextClick(scope) {
    const handler = ev => {
      ev.stopPropagation();
      ev.preventDefault();
      scope.removeEventListener('click', handler, true);
    };
    scope.addEventListener('click', handler, true);
  }

  // 长按卡片 → 输出框选区高亮：未采纳找 original，已采纳找改写后文本（对齐 computeAuto 的 splitMode 逻辑）
  function highlightInOutput(id) {
    const it = review.items.find(x => x.id === id);
    if (!it) return;
    const ta = main.querySelector('#revOutput');
    if (!ta) return;
    const text = ta.value;
    const d = review.decisions[id] || {};

    let needle = it.original;
    if (d.adopted) {
      let sug = d.editedSuggestion;
      if (splitMode && it.splitSuggestion && sug === it.suggestion) sug = it.splitSuggestion;
      if (sug && sug !== it.original) needle = sug;
    }
    if (!needle) { utils.toast('输出框中未找到对应文本'); return; }

    const start = text.indexOf(needle);
    if (start < 0) { utils.toast('输出框中未找到对应文本'); return; }

    ta.focus({ preventScroll: true });
    ta.setSelectionRange(start, start + needle.length);
    scrollTextareaToSelection(ta, start);
  }

  // 估行号 × 行高，把选区所在行滚到输出框可见区中央
  function scrollTextareaToSelection(ta, charOffset) {
    const cs = getComputedStyle(ta);
    const lineHeight = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.9;
    const lineIdx = ta.value.slice(0, charOffset).split('\n').length - 1;
    const paddingTop = parseFloat(cs.paddingTop) || 0;
    const targetTop = lineIdx * lineHeight + paddingTop - ta.clientHeight / 2 + lineHeight / 2;
    ta.scrollTop = Math.max(0, targetTop);
  }

  function bindLongPress(card, id) {
    let timer = null;
    let triggered = false;
    let startX = 0, startY = 0;

    const clear = () => {
      if (timer) { clearTimeout(timer); activeTimers.delete(timer); timer = null; }
    };
    const reset = () => { clear(); card.classList.remove('longpress-active'); };

    card.addEventListener('pointerdown', e => {
      // 落在交互元素上不启动长按（避免与采纳/撤销/改写冲突，保住 input 聚焦）
      if (e.target.closest('button, input, .rev-undo')) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      triggered = false;
      startX = e.clientX; startY = e.clientY;
      timer = setTimeout(() => {
        triggered = true;
        card.classList.add('longpress-active');
        highlightInOutput(id);
        if (navigator.vibrate) navigator.vibrate(10);
      }, LONG_PRESS_MS);
      activeTimers.add(timer);
    });

    card.addEventListener('pointermove', e => {
      if (!timer) return;
      const dx = e.clientX - startX, dy = e.clientY - startY;
      if (dx * dx + dy * dy > MOVE_TOLERANCE_PX * MOVE_TOLERANCE_PX) reset();
    });

    card.addEventListener('pointerup', () => {
      const wasTriggered = triggered;
      reset();
      if (wasTriggered) swallowNextClick(card);
    });
    card.addEventListener('pointercancel', reset);
    card.addEventListener('pointerleave', reset);
  }

  // 基于采纳 items 算出建议输出（不含手动改），纯函数不碰输出框
  function computeAuto() {
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
    return cleanText(text);
  }

  function compose() {
    const prevAuto = autoOutput;
    autoOutput = computeAuto();
    const ta = main.querySelector('#revOutput');
    // 输出框未被手动改（== 上次自动值 或 空）→ 跟随新自动值；否则保留用户手动值
    if (ta.value === prevAuto || ta.value === '') {
      ta.value = autoOutput;
      review.output = autoOutput;
    }
    autoResize(ta);
    renderItems();
  }

  // 输出框自动增高：仅手机端（整页滚动）撑高；电脑端用固定高度 + 内部滚动，不撑高
  function autoResize(ta) {
    if (!ta) return;
    if (window.matchMedia('(min-width: 769px)').matches) return;  // 电脑端：不撑高，靠 CSS flex:1 + overflow:auto 内部滚动
    ta.style.height = 'auto';
    ta.style.height = (ta.scrollHeight + 2) + 'px';
  }

  // diff 建议输出(autoOutput) 与 用户输出(review.output) 的逐行差异 = 手动修改
  function diffManuals() {
    if (!autoOutput || review.output === autoOutput) return [];
    const a = autoOutput.split('\n'), m = (review.output || '').split('\n');
    const edits = [];
    const max = Math.max(a.length, m.length);
    for (let i = 0; i < max; i++) {
      if (a[i] !== m[i]) {
        edits.push({ line: i + 1, auto: a[i] !== undefined ? a[i] : '(无此行)', manual: m[i] !== undefined ? m[i] : '(已删除)' });
      }
    }
    return edits;
  }

  function revertManual(line) {
    const m = (review.output || '').split('\n');
    const a = autoOutput.split('\n');
    if (line >= 1 && line <= m.length && a[line - 1] !== undefined) {
      m[line - 1] = a[line - 1];
      review.output = m.join('\n');
      main.querySelector('#revOutput').value = review.output;
      renderItems();
      safeSave(data, 'manual_revert', `撤销第${line}行手动修改`);
      utils.toast('已撤销第' + line + '行');
    }
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

  // shots 是否已配过内容（字幕/素材/文案），用于「完成审核」覆盖与「撤销完成」清空前确认
  function shotsHasContent(shots) {
    return (shots || []).some(s =>
      (s.subtitle || '').trim() ||
      (s.subject && s.subject.assetIds && s.subject.assetIds.length) ||
      (s.post && (s.post.text || '').trim())
    );
  }

  async function pushToDesign(data) {
    review.output = main.querySelector('#revOutput').value;
    if (!review.output || !review.output.trim()) {
      utils.toast('输出为空，无法推入');
      return;
    }
    // 设计台已有配好镜头（或在回收站 _trash 里）时二次确认：完成审核会按新文案重生成、覆盖现有镜头并清空回收站，不可恢复
    // ★必须同时看 _trash：撤销完成后 shots 已是 []，内容全在 _trash，漏看会导致重新完成时静默清空回收站
    const trashShots = data.design._trash && data.design._trash.shots ? data.design._trash.shots : [];
    if ((shotsHasContent(data.design.shots) || shotsHasContent(trashShots)) && !confirm('设计台已有配好的镜头内容（或暂存在回收站）。再次「完成审核」会按新文案重新生成分镜、覆盖现有镜头并清空回收站（无历史快照，无法恢复）。确定继续吗？')) return;
    const lines = review.output.split('\n').map(l => l.trim()).filter(Boolean);
    const pushBy = store.getOperator(), pushTs = utils.nowIso();
    data.design.shots = lines.map(line => ({
      line, subtitle: '',
      subject: { type: null, assetIds: [], refs: [], prompt: '' },
      post: { text: '', sticker: '', fx: '', anim: '', trans: '' },
      timing: { text: '', sticker: '', fx: '', anim: '', trans: '' },
      lastBy: pushBy, lastTs: pushTs
    }));
    data.meta.stage = 'design';
    data.design._trash = null;  // 重新完成审核，回收站里旧的作废
    const btn = main.querySelector('#pushDesignBtn');
    btn.textContent = '✓ 已完成';
    btn.classList.add('done');
    btn.disabled = true;
    main.querySelector('#unpushBtn').style.display = '';
    main.querySelector('#restoreBtn').style.display = 'none';
    main.querySelector('#goDesignBtn').style.display = '';
    utils.toast(`审核完成，已生成 ${lines.length} 镜`);
    safeSave(data, 'pushed_to_design', `生成 ${lines.length} 镜`);
  }

  // 撤销「完成审核」：流程回到 review，分镜移入回收站（design._trash），可点「♻️ 恢复分镜」一键找回
  async function unpushDesign(data) {
    const shots = data.design.shots || [];
    if (shotsHasContent(shots) && !confirm(`将清空 ${shots.length} 镜分镜并回到「未完成审核」状态。分镜会暂存到回收站，仍可「恢复分镜」找回。确定撤销吗？`)) return;
    data.design._trash = { shots, ts: utils.nowIso(), by: store.getOperator() };  // 软删除：留一次反悔机会
    data.design.shots = [];
    data.meta.stage = 'review';
    const btn = main.querySelector('#pushDesignBtn');
    btn.textContent = '✓ 完成审核';
    btn.classList.remove('done');
    btn.disabled = false;
    main.querySelector('#unpushBtn').style.display = 'none';
    main.querySelector('#restoreBtn').style.display = '';
    main.querySelector('#goDesignBtn').style.display = 'none';
    utils.toast('已撤销完成审核（分镜进了回收站，可点「♻️ 恢复分镜」找回）');
    safeSave(data, 'unpush_design', '撤销完成审核，分镜移入回收站');
  }

  // 从回收站恢复分镜：把 design._trash 里的 shots 取回，流程回到 design 完成态
  async function restoreDesign(data) {
    const trash = data.design._trash;
    if (!trash || !trash.shots || !trash.shots.length) { utils.toast('回收站是空的'); return; }
    data.design.shots = trash.shots;
    data.design._trash = null;
    data.meta.stage = 'design';
    const btn = main.querySelector('#pushDesignBtn');
    btn.textContent = '✓ 已完成';
    btn.classList.add('done');
    btn.disabled = true;
    main.querySelector('#unpushBtn').style.display = '';
    main.querySelector('#restoreBtn').style.display = 'none';
    main.querySelector('#goDesignBtn').style.display = '';
    utils.toast(`已恢复 ${trash.shots.length} 镜分镜`);
    safeSave(data, 'restore_design', '从回收站恢复分镜');
  }

  async function safeSave(data, action, detail) {
    try { await store.logAndSave(data, action, detail); }
    catch (e) { utils.toast('保存失败：' + e.message); }
  }

  renderOriginal();
  renderItems();
  compose();
}
